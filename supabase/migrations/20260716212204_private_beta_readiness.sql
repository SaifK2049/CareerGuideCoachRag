alter table public.career_profiles
  add column beta_terms_accepted_at timestamptz,
  add column privacy_notice_version text
    check (privacy_notice_version is null or char_length(privacy_notice_version) <= 40);

create table public.career_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  path_id uuid,
  target_role text not null default '' check (char_length(target_role) <= 200),
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  summary text not null default '' check (char_length(summary) <= 20000),
  findings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(findings) = 'array'),
  sources jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sources) = 'array'),
  model text not null default '' check (char_length(model) <= 120),
  schema_version text not null default '1.0' check (char_length(schema_version) <= 24),
  failure_code text check (failure_code is null or char_length(failure_code) <= 80),
  document_count integer not null default 0 check (document_count between 0 and 250),
  usage_period_start date,
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);

alter table public.career_analyses
  add constraint career_analyses_path_owner_fk
  foreign key (path_id, user_id)
  references public.career_paths(id, user_id)
  on delete cascade;

create index career_analyses_user_path_created_idx
  on public.career_analyses(user_id, path_id, created_at desc);

create table public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null
    check (category in ('bug', 'analysis', 'idea', 'privacy', 'other')),
  message text not null check (char_length(message) between 5 and 5000),
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object'),
  created_at timestamptz not null default now()
);

create index beta_feedback_user_created_idx
  on public.beta_feedback(user_id, created_at desc);

alter table public.career_analyses enable row level security;
alter table public.beta_feedback enable row level security;

create policy "analysis owner read"
  on public.career_analyses for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "analysis owner delete"
  on public.career_analyses for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy "feedback owner read"
  on public.beta_feedback for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "feedback owner insert"
  on public.beta_feedback for insert to authenticated
  with check ((select auth.uid()) = user_id);

grant select, delete on public.career_analyses to authenticated;
grant select, insert on public.beta_feedback to authenticated;
grant select, insert, update, delete on
  public.career_analyses, public.beta_feedback
  to service_role;

update public.plan_feature_limits
set quota = case feature_key
  when 'job_paths' then 3
  when 'job_descriptions' then 20
  when 'knowledge_evidence' then 50
  when 'rag_analysis' then 10
  else quota
end
where plan_code = 'free'
  and feature_key in ('job_paths', 'job_descriptions', 'knowledge_evidence', 'rag_analysis');

revoke execute on function public.consume_feature_usage(text) from authenticated;
revoke execute on function private.consume_feature_usage_internal(uuid, text) from authenticated;

create or replace function private.reserve_career_analysis_internal(
  p_user_id uuid,
  p_request_id uuid,
  p_path_id uuid,
  p_target_role text,
  p_document_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_analysis public.career_analyses%rowtype;
  v_plan text;
  v_enabled boolean;
  v_quota integer;
  v_used integer;
  v_period date := date_trunc('month', now())::date;
begin
  if p_user_id is null
    or p_request_id is null
    or p_document_count not between 1 and 250
    or char_length(coalesce(p_target_role, '')) > 200
  then
    raise exception 'Invalid analysis reservation';
  end if;

  if p_path_id is not null and not exists (
    select 1 from public.career_paths
    where id = p_path_id and user_id = p_user_id
  ) then
    raise exception 'Career path was not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_request_id::text, 0)
  );

  select * into v_analysis
  from public.career_analyses
  where user_id = p_user_id and request_id = p_request_id
  for update;

  select fl.plan_code, fl.enabled, fl.quota
    into v_plan, v_enabled, v_quota
  from private.feature_limit(p_user_id, 'rag_analysis') fl;

  if v_analysis.id is not null and v_analysis.status = 'succeeded' then
    select coalesce(f.usage_count, 0) into v_used
    from (select 1) seed
    left join public.feature_usage_monthly f
      on f.user_id = p_user_id
      and f.feature_key = 'rag_analysis'
      and f.period_start = v_period;
    return jsonb_build_object(
      'state', 'succeeded',
      'analysis_id', v_analysis.id,
      'access', jsonb_build_object(
        'plan_code', coalesce(v_plan, 'free'),
        'allowed', true,
        'used', coalesce(v_used, 0),
        'quota', v_quota
      )
    );
  end if;

  if v_analysis.id is not null
    and v_analysis.status = 'pending'
    and v_analysis.updated_at > now() - interval '10 minutes'
  then
    select coalesce(f.usage_count, 0) into v_used
    from (select 1) seed
    left join public.feature_usage_monthly f
      on f.user_id = p_user_id
      and f.feature_key = 'rag_analysis'
      and f.period_start = v_period;
    return jsonb_build_object(
      'state', 'pending',
      'analysis_id', v_analysis.id,
      'access', jsonb_build_object(
        'plan_code', coalesce(v_plan, 'free'),
        'allowed', true,
        'used', coalesce(v_used, 0),
        'quota', v_quota
      )
    );
  end if;

  if v_analysis.id is not null and v_analysis.status = 'pending' then
    update public.feature_usage_monthly
    set usage_count = greatest(0, usage_count - 1), updated_at = now()
    where user_id = p_user_id
      and feature_key = 'rag_analysis'
      and period_start = v_analysis.usage_period_start;
    update public.career_analyses
    set status = 'failed',
        failure_code = 'STALE_REQUEST',
        completed_at = now(),
        updated_at = now()
    where id = v_analysis.id;
  end if;

  if not coalesce(v_enabled, false) then
    return jsonb_build_object(
      'state', 'quota_exceeded',
      'access', jsonb_build_object(
        'plan_code', coalesce(v_plan, 'free'),
        'allowed', false,
        'used', 0,
        'quota', coalesce(v_quota, 0)
      )
    );
  end if;

  insert into public.feature_usage_monthly (
    user_id, feature_key, period_start, usage_count
  )
  values (p_user_id, 'rag_analysis', v_period, 0)
  on conflict (user_id, feature_key, period_start) do nothing;

  select usage_count into v_used
  from public.feature_usage_monthly
  where user_id = p_user_id
    and feature_key = 'rag_analysis'
    and period_start = v_period
  for update;

  if v_quota is not null and v_used >= v_quota then
    return jsonb_build_object(
      'state', 'quota_exceeded',
      'analysis_id', v_analysis.id,
      'access', jsonb_build_object(
        'plan_code', coalesce(v_plan, 'free'),
        'allowed', false,
        'used', v_used,
        'quota', v_quota
      )
    );
  end if;

  update public.feature_usage_monthly
  set usage_count = usage_count + 1, updated_at = now()
  where user_id = p_user_id
    and feature_key = 'rag_analysis'
    and period_start = v_period
  returning usage_count into v_used;

  if v_analysis.id is null then
    insert into public.career_analyses (
      user_id, request_id, path_id, target_role, status,
      document_count, usage_period_start
    )
    values (
      p_user_id, p_request_id, p_path_id, coalesce(p_target_role, ''), 'pending',
      p_document_count, v_period
    )
    returning * into v_analysis;
  else
    update public.career_analyses
    set path_id = p_path_id,
        target_role = coalesce(p_target_role, ''),
        status = 'pending',
        summary = '',
        findings = '[]'::jsonb,
        sources = '[]'::jsonb,
        model = '',
        failure_code = null,
        document_count = p_document_count,
        usage_period_start = v_period,
        started_at = now(),
        completed_at = null,
        updated_at = now()
    where id = v_analysis.id
    returning * into v_analysis;
  end if;

  return jsonb_build_object(
    'state', 'reserved',
    'analysis_id', v_analysis.id,
    'access', jsonb_build_object(
      'plan_code', coalesce(v_plan, 'free'),
      'allowed', true,
      'used', v_used,
      'quota', v_quota
    )
  );
end;
$$;

create or replace function public.reserve_career_analysis(
  p_user_id uuid,
  p_request_id uuid,
  p_path_id uuid,
  p_target_role text,
  p_document_count integer
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reserve_career_analysis_internal(
    p_user_id, p_request_id, p_path_id, p_target_role, p_document_count
  );
$$;

create or replace function private.complete_career_analysis_internal(
  p_user_id uuid,
  p_request_id uuid,
  p_summary text,
  p_findings jsonb,
  p_sources jsonb,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_analysis public.career_analyses%rowtype;
begin
  if p_user_id is null
    or p_request_id is null
    or char_length(coalesce(p_summary, '')) not between 1 and 20000
    or jsonb_typeof(p_findings) <> 'array'
    or jsonb_typeof(p_sources) <> 'array'
    or char_length(coalesce(p_model, '')) not between 1 and 120
  then
    raise exception 'Invalid completed analysis';
  end if;

  update public.career_analyses
  set status = 'succeeded',
      summary = p_summary,
      findings = p_findings,
      sources = p_sources,
      model = p_model,
      failure_code = null,
      completed_at = now(),
      updated_at = now()
  where user_id = p_user_id
    and request_id = p_request_id
    and status = 'pending'
  returning * into v_analysis;

  if v_analysis.id is null then
    raise exception 'Pending analysis was not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_analysis.id,
    'request_id', v_analysis.request_id,
    'path_id', v_analysis.path_id,
    'target_role', v_analysis.target_role,
    'status', v_analysis.status,
    'summary', v_analysis.summary,
    'findings', v_analysis.findings,
    'sources', v_analysis.sources,
    'model', v_analysis.model,
    'created_at', v_analysis.created_at,
    'completed_at', v_analysis.completed_at
  );
end;
$$;

create or replace function public.complete_career_analysis(
  p_user_id uuid,
  p_request_id uuid,
  p_summary text,
  p_findings jsonb,
  p_sources jsonb,
  p_model text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.complete_career_analysis_internal(
    p_user_id, p_request_id, p_summary, p_findings, p_sources, p_model
  );
$$;

create or replace function private.fail_career_analysis_internal(
  p_user_id uuid,
  p_request_id uuid,
  p_failure_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_analysis public.career_analyses%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_request_id::text, 0)
  );

  select * into v_analysis
  from public.career_analyses
  where user_id = p_user_id and request_id = p_request_id
  for update;

  if v_analysis.id is null or v_analysis.status <> 'pending' then
    return false;
  end if;

  update public.career_analyses
  set status = 'failed',
      failure_code = left(coalesce(p_failure_code, 'ANALYSIS_FAILED'), 80),
      completed_at = now(),
      updated_at = now()
  where id = v_analysis.id;

  update public.feature_usage_monthly
  set usage_count = greatest(0, usage_count - 1), updated_at = now()
  where user_id = p_user_id
    and feature_key = 'rag_analysis'
    and period_start = v_analysis.usage_period_start;

  return true;
end;
$$;

create or replace function public.fail_career_analysis(
  p_user_id uuid,
  p_request_id uuid,
  p_failure_code text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.fail_career_analysis_internal(
    p_user_id, p_request_id, p_failure_code
  );
$$;

revoke all on function private.reserve_career_analysis_internal(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function private.complete_career_analysis_internal(uuid, uuid, text, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke all on function private.fail_career_analysis_internal(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function private.reserve_career_analysis_internal(uuid, uuid, uuid, text, integer)
  to service_role;
grant execute on function private.complete_career_analysis_internal(uuid, uuid, text, jsonb, jsonb, text)
  to service_role;
grant execute on function private.fail_career_analysis_internal(uuid, uuid, text)
  to service_role;

revoke all on function public.reserve_career_analysis(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_career_analysis(uuid, uuid, text, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.fail_career_analysis(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.reserve_career_analysis(uuid, uuid, uuid, text, integer)
  to service_role;
grant execute on function public.complete_career_analysis(uuid, uuid, text, jsonb, jsonb, text)
  to service_role;
grant execute on function public.fail_career_analysis(uuid, uuid, text)
  to service_role;

comment on table public.career_analyses
  is 'Persisted, user-owned RAG results with idempotent request lifecycle state.';
comment on table public.beta_feedback
  is 'Private-beta feedback. Context must never contain CV or job-description content.';
