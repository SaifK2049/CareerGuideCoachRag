create extension if not exists pg_cron;

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (
    event_name in ('app_open', 'view_open', 'workflow_started', 'workflow_completed', 'workflow_failed')
  ),
  surface text check (
    surface is null or surface in (
      'auth', 'onboarding', 'overview', 'profile', 'paths', 'knowledge', 'plan',
      'interview', 'applications', 'progress', 'feedback', 'reports'
    )
  ),
  workflow text check (
    workflow is null or workflow in (
      'onboarding', 'cv', 'job', 'analysis', 'application', 'action_plan',
      'interview_practice', 'interview_assessment', 'report_share', 'feedback'
    )
  ),
  error_code text check (
    error_code is null or (char_length(error_code) between 1 and 80 and error_code ~ '^[A-Z0-9_:-]+$')
  ),
  session_id uuid not null,
  app_version text not null default 'unknown' check (char_length(app_version) between 1 and 40),
  created_at timestamptz not null default now(),
  check ((event_name like 'workflow_%') = (workflow is not null)),
  check ((event_name = 'workflow_failed') = (error_code is not null))
);

create table public.operational_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  operation text not null check (
    operation in (
      'analyze_career', 'cv_guidance', 'import_job', 'interview_generate',
      'interview_assess', 'interview_transcribe', 'shared_report', 'export_account',
      'delete_account', 'checkout', 'billing_portal', 'stripe_webhook', 'join_waitlist'
    )
  ),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  error_code text check (
    error_code is null or (char_length(error_code) between 1 and 80 and error_code ~ '^[A-Z0-9_:-]+$')
  ),
  latency_ms integer not null check (latency_ms between 0 and 3600000),
  model text not null default '' check (char_length(model) <= 120),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now(),
  check ((outcome = 'failed') = (error_code is not null))
);

create index product_events_created_idx on public.product_events(created_at desc);
create index product_events_user_created_idx on public.product_events(user_id, created_at desc);
create index product_events_workflow_created_idx on public.product_events(workflow, event_name, created_at desc)
  where workflow is not null;
create index operational_events_created_idx on public.operational_events(created_at desc);
create index operational_events_operation_created_idx
  on public.operational_events(operation, outcome, created_at desc);

alter table public.product_events enable row level security;
alter table public.operational_events enable row level security;

revoke all on public.product_events, public.operational_events from public, anon, authenticated;
grant select, insert, delete on public.product_events, public.operational_events to service_role;
grant usage, select on sequence public.operational_events_id_seq to service_role;

create or replace function public.record_product_event(
  p_event_name text,
  p_surface text,
  p_workflow text,
  p_error_code text,
  p_session_id uuid,
  p_app_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_error_code text := nullif(upper(trim(coalesce(p_error_code, ''))), '');
begin
  if v_user_id is null or p_session_id is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_event_name not in ('app_open', 'view_open', 'workflow_started', 'workflow_completed', 'workflow_failed') then
    raise exception 'Invalid event name' using errcode = '22023';
  end if;
  if p_surface is not null and p_surface not in (
    'auth', 'onboarding', 'overview', 'profile', 'paths', 'knowledge', 'plan',
    'interview', 'applications', 'progress', 'feedback', 'reports'
  ) then
    raise exception 'Invalid surface' using errcode = '22023';
  end if;
  if (p_event_name like 'workflow_%') <> (p_workflow is not null) then
    raise exception 'Invalid workflow event' using errcode = '22023';
  end if;
  if p_workflow is not null and p_workflow not in (
    'onboarding', 'cv', 'job', 'analysis', 'application', 'action_plan',
    'interview_practice', 'interview_assessment', 'report_share', 'feedback'
  ) then
    raise exception 'Invalid workflow' using errcode = '22023';
  end if;
  if (p_event_name = 'workflow_failed') <> (v_error_code is not null)
    or (v_error_code is not null and (char_length(v_error_code) > 80 or v_error_code !~ '^[A-Z0-9_:-]+$'))
  then
    raise exception 'Invalid error code' using errcode = '22023';
  end if;
  if char_length(coalesce(p_app_version, '')) not between 1 and 40 then
    raise exception 'Invalid app version' using errcode = '22023';
  end if;

  insert into public.product_events (
    user_id, event_name, surface, workflow, error_code, session_id, app_version
  ) values (
    v_user_id, p_event_name, p_surface, p_workflow, v_error_code,
    p_session_id, p_app_version
  );
end;
$$;

revoke all on function public.record_product_event(text, text, text, text, uuid, text)
  from public, anon;
grant execute on function public.record_product_event(text, text, text, text, uuid, text)
  to authenticated;

create or replace function public.admin_analytics_overview(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_span interval := p_to - p_from;
  v_previous_from timestamptz := p_from - (p_to - p_from);
  v_step interval;
  v_bucket_from timestamptz;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '400 days' then
    raise exception 'Invalid analytics range' using errcode = '22023';
  end if;
  v_step := case when v_span > interval '90 days' then interval '7 days' else interval '1 day' end;
  v_bucket_from := date_trunc(case when v_span > interval '90 days' then 'week' else 'day' end, p_from);

  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'granularity', case when v_step = interval '7 days' then 'week' else 'day' end),
    'totals', jsonb_build_object(
      'total_users', (select count(*) from auth.users),
      'new_users', (select count(*) from auth.users where created_at >= p_from and created_at < p_to),
      'previous_new_users', (select count(*) from auth.users where created_at >= v_previous_from and created_at < p_from),
      'active_users', (select count(distinct user_id) from public.product_events where created_at >= p_from and created_at < p_to),
      'previous_active_users', (select count(distinct user_id) from public.product_events where created_at >= v_previous_from and created_at < p_from),
      'onboarded_users', (select count(*) from public.career_profiles where onboarding_complete),
      'premium_users', (select count(*) from public.account_subscriptions where plan_code = 'premium' and status in ('active', 'trialing')),
      'waitlist_signups', (select count(*) from public.waitlist_signups where created_at >= p_from and created_at < p_to),
      'waitlist_converted', (
        select count(*) from public.waitlist_signups w
        where w.created_at >= p_from and w.created_at < p_to
          and exists (select 1 from auth.users u where lower(u.email) = lower(w.email))
      ),
      'feedback_items', (select count(*) from public.beta_feedback where created_at >= p_from and created_at < p_to)
    ),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket', bucket,
        'new_users', (select count(*) from auth.users u where u.created_at >= bucket and u.created_at < bucket + v_step),
        'active_users', (select count(distinct e.user_id) from public.product_events e where e.created_at >= bucket and e.created_at < bucket + v_step)
      ) order by bucket)
      from generate_series(v_bucket_from, p_to - interval '1 second', v_step) bucket
    ), '[]'::jsonb),
    'activation', (
      with cohort as (
        select id from auth.users where created_at >= p_from and created_at < p_to
      )
      select jsonb_build_array(
        jsonb_build_object('stage', 'account_created', 'count', count(*)),
        jsonb_build_object('stage', 'onboarding_complete', 'count', count(*) filter (where exists (
          select 1 from public.career_profiles p where p.user_id = cohort.id and p.onboarding_complete
        ))),
        jsonb_build_object('stage', 'cv_added', 'count', count(*) filter (where exists (
          select 1 from public.career_profiles p where p.user_id = cohort.id and (p.cv_uploaded_at is not null or p.cv_text <> '')
        ))),
        jsonb_build_object('stage', 'job_added', 'count', count(*) filter (where exists (
          select 1 from public.job_descriptions j where j.user_id = cohort.id and j.created_at < p_to
        ))),
        jsonb_build_object('stage', 'analysis_completed', 'count', count(*) filter (where exists (
          select 1 from public.career_analyses a where a.user_id = cohort.id and a.status = 'succeeded' and a.completed_at < p_to
        ))),
        jsonb_build_object('stage', 'action_completed', 'count', count(*) filter (where exists (
          select 1 from public.action_plan_items i where i.user_id = cohort.id and i.status = 'completed' and i.completed_at < p_to
        )))
      ) from cohort
    ),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workflow', workflow,
        'users', users,
        'completed', completed,
        'failed', failed
      ) order by workflow)
      from (
        select workflow, count(distinct user_id) filter (where event_name = 'workflow_completed') as users,
          count(*) filter (where event_name = 'workflow_completed') as completed,
          count(*) filter (where event_name = 'workflow_failed') as failed
        from public.product_events
        where created_at >= p_from and created_at < p_to and workflow is not null
        group by workflow
      ) feature_rows
    ), '[]'::jsonb),
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object('status', application_status, 'count', count) order by application_status)
      from (
        select application_status, count(*) as count
        from public.job_descriptions group by application_status
      ) application_rows
    ), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('plan', plan_code, 'status', status, 'count', count) order by plan_code, status)
      from (
        select plan_code, status, count(*) as count
        from public.account_subscriptions group by plan_code, status
      ) plan_rows
    ), '[]'::jsonb),
    'feedback_categories', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'count', count) order by category)
      from (
        select category, count(*) as count
        from public.beta_feedback where created_at >= p_from and created_at < p_to group by category
      ) feedback_rows
    ), '[]'::jsonb),
    'finding_feedback', jsonb_build_object(
      'useful', (select count(*) from public.analysis_finding_feedback where rating = 'useful' and updated_at >= p_from and updated_at < p_to),
      'needs_work', (select count(*) from public.analysis_finding_feedback where rating = 'needs_work' and updated_at >= p_from and updated_at < p_to)
    )
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_analytics_users(
  p_from timestamptz,
  p_to timestamptz,
  p_search text default '',
  p_plan text default '',
  p_onboarding text default '',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  country text,
  experience_level text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  last_active_at timestamptz,
  onboarding_complete boolean,
  plan_code text,
  subscription_status text,
  path_count bigint,
  job_count bigint,
  evidence_count bigint,
  analysis_count bigint,
  application_count bigint,
  action_count bigint,
  interview_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with directory as (
    select
      u.id as user_id,
      coalesce(u.email, '')::text as email,
      coalesce(p.display_name, '') as display_name,
      coalesce(p.country, '') as country,
      coalesce(p.experience_level, '') as experience_level,
      u.created_at,
      u.last_sign_in_at,
      (select max(e.created_at) from public.product_events e where e.user_id = u.id) as last_active_at,
      coalesce(p.onboarding_complete, false) as onboarding_complete,
      case when s.plan_code = 'premium' and s.status in ('active', 'trialing') then 'premium' else 'free' end as plan_code,
      coalesce(s.status, 'free') as subscription_status,
      (select count(*) from public.career_paths x where x.user_id = u.id) as path_count,
      (select count(*) from public.job_descriptions x where x.user_id = u.id) as job_count,
      (select count(*) from public.knowledge_evidence x where x.user_id = u.id) as evidence_count,
      (select count(*) from public.career_analyses x where x.user_id = u.id and x.created_at >= p_from and x.created_at < p_to) as analysis_count,
      (select count(*) from public.job_descriptions x where x.user_id = u.id and x.application_status <> 'saved') as application_count,
      (select count(*) from public.action_plan_items x where x.user_id = u.id) as action_count,
      (select count(*) from public.interview_practice_sessions x where x.user_id = u.id and x.started_at >= p_from and x.started_at < p_to) as interview_count
    from auth.users u
    left join public.career_profiles p on p.user_id = u.id
    left join public.account_subscriptions s on s.user_id = u.id
  ), filtered as (
    select * from directory d
    where (coalesce(p_search, '') = '' or d.email ilike '%' || p_search || '%' or d.display_name ilike '%' || p_search || '%' or d.user_id::text = p_search)
      and (coalesce(p_plan, '') = '' or d.plan_code = p_plan)
      and (coalesce(p_onboarding, '') = '' or d.onboarding_complete = (p_onboarding = 'complete'))
  )
  select f.*, count(*) over () as total_count
  from filtered f
  order by f.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_analytics_feedback(
  p_from timestamptz,
  p_to timestamptz,
  p_search text default '',
  p_category text default '',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  user_id uuid,
  email text,
  category text,
  message text,
  view_name text,
  app_version text,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.user_id, coalesce(u.email, '')::text, f.category, f.message,
    coalesce(f.context->>'view', ''), coalesce(f.context->>'app_version', ''), f.created_at,
    count(*) over ()
  from public.beta_feedback f
  join auth.users u on u.id = f.user_id
  where f.created_at >= p_from and f.created_at < p_to
    and (coalesce(p_category, '') = '' or f.category = p_category)
    and (coalesce(p_search, '') = '' or u.email ilike '%' || p_search || '%' or f.message ilike '%' || p_search || '%')
  order by f.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_analytics_system(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'operation', operation,
        'succeeded', succeeded,
        'failed', failed,
        'success_rate', case when succeeded + failed = 0 then 0 else round(100.0 * succeeded / (succeeded + failed), 1) end,
        'p50_latency_ms', p50_latency_ms,
        'p95_latency_ms', p95_latency_ms,
        'input_tokens', input_tokens,
        'output_tokens', output_tokens
      ) order by operation)
      from (
        select operation,
          count(*) filter (where outcome = 'succeeded') as succeeded,
          count(*) filter (where outcome = 'failed') as failed,
          round(percentile_cont(0.5) within group (order by latency_ms))::integer as p50_latency_ms,
          round(percentile_cont(0.95) within group (order by latency_ms))::integer as p95_latency_ms,
          coalesce(sum(input_tokens), 0) as input_tokens,
          coalesce(sum(output_tokens), 0) as output_tokens
        from public.operational_events
        where created_at >= p_from and created_at < p_to
        group by operation
      ) operation_rows
    ), '[]'::jsonb),
    'failures', coalesce((
      select jsonb_agg(jsonb_build_object('operation', operation, 'error_code', error_code, 'count', count) order by count desc)
      from (
        select operation, error_code, count(*) as count
        from public.operational_events
        where outcome = 'failed' and created_at >= p_from and created_at < p_to
        group by operation, error_code order by count(*) desc limit 50
      ) failure_rows
    ), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object(
        'model', model, 'requests', requests, 'input_tokens', input_tokens, 'output_tokens', output_tokens
      ) order by requests desc)
      from (
        select model, count(*) as requests, coalesce(sum(input_tokens), 0) as input_tokens,
          coalesce(sum(output_tokens), 0) as output_tokens
        from public.operational_events
        where model <> '' and created_at >= p_from and created_at < p_to
        group by model
      ) model_rows
    ), '[]'::jsonb),
    'stalled', jsonb_build_object(
      'analyses', (select count(*) from public.career_analyses where status = 'pending' and updated_at < now() - interval '10 minutes'),
      'interview_assessments', (select count(*) from public.interview_practice_sessions where assessment_status = 'pending' and updated_at < now() - interval '10 minutes')
    ),
    'stripe_errors', (select count(*) from public.stripe_events where last_error is not null and created_at >= p_from and created_at < p_to)
  );
$$;

revoke all on function public.admin_analytics_overview(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_analytics_users(timestamptz, timestamptz, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_analytics_feedback(timestamptz, timestamptz, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_analytics_system(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_analytics_overview(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_analytics_users(timestamptz, timestamptz, text, text, text, integer, integer) to service_role;
grant execute on function public.admin_analytics_feedback(timestamptz, timestamptz, text, text, integer, integer) to service_role;
grant execute on function public.admin_analytics_system(timestamptz, timestamptz) to service_role;

select cron.schedule(
  'masari-prune-analytics',
  '17 3 * * *',
  $$
    delete from public.product_events where created_at < now() - interval '13 months';
    delete from public.operational_events where created_at < now() - interval '13 months';
  $$
);
