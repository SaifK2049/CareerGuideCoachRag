create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

alter table public.career_profiles
  add column display_name text not null default '',
  add column career_goal text not null default '',
  add column experience_level text not null default '',
  add column country text not null default '',
  add column onboarding_complete boolean not null default false;

alter table public.career_profiles
  add constraint career_profiles_display_name_length check (char_length(display_name) <= 120),
  add constraint career_profiles_career_goal_length check (char_length(career_goal) <= 240),
  add constraint career_profiles_experience_level_allowed
    check (experience_level in ('', 'student', 'early', 'mid', 'senior', 'leadership'));

create table public.plan_feature_limits (
  plan_code text not null check (plan_code in ('free', 'premium')),
  feature_key text not null,
  enabled boolean not null default false,
  quota integer check (quota is null or quota >= 0),
  primary key (plan_code, feature_key)
);

insert into public.plan_feature_limits (plan_code, feature_key, enabled, quota) values
  ('free', 'job_paths', true, 1),
  ('free', 'job_descriptions', true, 5),
  ('free', 'knowledge_evidence', true, 10),
  ('free', 'rag_analysis', true, 2),
  ('free', 'learning_plan', false, 0),
  ('free', 'public_profile', false, 0),
  ('premium', 'job_paths', true, 10),
  ('premium', 'job_descriptions', true, 100),
  ('premium', 'knowledge_evidence', true, 250),
  ('premium', 'rag_analysis', true, 50),
  ('premium', 'learning_plan', true, null),
  ('premium', 'public_profile', true, null);

create table public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null default 'free' check (plan_code in ('free', 'premium')),
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'free'
    check (status in ('free', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  stripe_event_created bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.feature_usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null,
  period_start date not null,
  usage_count integer not null default 0 check (usage_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_key, period_start)
);

create table public.stripe_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.plan_feature_limits enable row level security;
alter table public.billing_customers enable row level security;
alter table public.account_subscriptions enable row level security;
alter table public.feature_usage_monthly enable row level security;
alter table public.stripe_events enable row level security;

create policy "authenticated can read plan limits"
  on public.plan_feature_limits for select to authenticated using (true);
create policy "users read their subscription"
  on public.account_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "users read their usage"
  on public.feature_usage_monthly for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "deny browser access to billing customers"
  on public.billing_customers for all to anon, authenticated
  using (false) with check (false);
create policy "deny browser access to Stripe events"
  on public.stripe_events for all to anon, authenticated
  using (false) with check (false);

grant select on public.plan_feature_limits, public.account_subscriptions, public.feature_usage_monthly to authenticated;
revoke all on public.billing_customers, public.stripe_events from anon, authenticated;
grant select, insert, update, delete on
  public.plan_feature_limits, public.billing_customers, public.account_subscriptions,
  public.feature_usage_monthly, public.stripe_events
  to service_role;

create or replace function public.apply_stripe_subscription_event(
  p_user_id uuid,
  p_plan_code text,
  p_subscription_id text,
  p_price_id text,
  p_status text,
  p_cancel_at_period_end boolean,
  p_current_period_end timestamptz,
  p_event_created bigint
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with applied as (
    insert into public.account_subscriptions as current_subscription (
      user_id, plan_code, stripe_subscription_id, stripe_price_id, status,
      cancel_at_period_end, current_period_end, stripe_event_created, updated_at
    )
    values (
      p_user_id, p_plan_code, p_subscription_id, p_price_id, p_status,
      p_cancel_at_period_end, p_current_period_end, p_event_created, now()
    )
    on conflict (user_id) do update set
      plan_code = excluded.plan_code,
      stripe_subscription_id = excluded.stripe_subscription_id,
      stripe_price_id = excluded.stripe_price_id,
      status = excluded.status,
      cancel_at_period_end = excluded.cancel_at_period_end,
      current_period_end = excluded.current_period_end,
      stripe_event_created = excluded.stripe_event_created,
      updated_at = now()
    where current_subscription.stripe_event_created <= excluded.stripe_event_created
    returning true
  )
  select coalesce((select true from applied limit 1), false);
$$;

revoke all on function public.apply_stripe_subscription_event(uuid, text, text, text, text, boolean, timestamptz, bigint)
  from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_event(uuid, text, text, text, text, boolean, timestamptz, bigint)
  to service_role;

create or replace function private.effective_plan(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.plan_code = 'premium'
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
    then 'premium'
    else 'free'
  end
  from (select p_user_id as user_id) u
  left join public.account_subscriptions s on s.user_id = u.user_id;
$$;

create or replace function private.feature_limit(p_user_id uuid, p_feature_key text)
returns table (plan_code text, enabled boolean, quota integer)
language sql
stable
security definer
set search_path = ''
as $$
  select pfl.plan_code, pfl.enabled, pfl.quota
  from public.plan_feature_limits pfl
  where pfl.plan_code = coalesce(private.effective_plan(p_user_id), 'free')
    and pfl.feature_key = p_feature_key;
$$;

create or replace function private.consume_feature_usage_internal(p_user_id uuid, p_feature_key text)
returns table (plan_code text, allowed boolean, used integer, quota integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_enabled boolean;
  v_quota integer;
  v_used integer;
  v_period date := date_trunc('month', now())::date;
begin
  if p_user_id is null or p_user_id <> (select auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select fl.plan_code, fl.enabled, fl.quota
    into v_plan, v_enabled, v_quota
  from private.feature_limit(p_user_id, p_feature_key) fl;

  if not coalesce(v_enabled, false) then
    return query select coalesce(v_plan, 'free'), false, 0, coalesce(v_quota, 0);
    return;
  end if;

  insert into public.feature_usage_monthly (user_id, feature_key, period_start, usage_count)
  values (p_user_id, p_feature_key, v_period, 0)
  on conflict (user_id, feature_key, period_start) do nothing;

  select f.usage_count into v_used
  from public.feature_usage_monthly f
  where f.user_id = p_user_id and f.feature_key = p_feature_key and f.period_start = v_period
  for update;

  if v_quota is not null and v_used >= v_quota then
    return query select v_plan, false, v_used, v_quota;
    return;
  end if;

  update public.feature_usage_monthly
  set usage_count = usage_count + 1, updated_at = now()
  where user_id = p_user_id and feature_key = p_feature_key and period_start = v_period
  returning usage_count into v_used;

  return query select v_plan, true, v_used, v_quota;
end;
$$;

create or replace function public.consume_feature_usage(p_feature_key text)
returns table (plan_code text, allowed boolean, used integer, quota integer)
language sql
security invoker
set search_path = ''
as $$
  select * from private.consume_feature_usage_internal((select auth.uid()), p_feature_key);
$$;

revoke all on function private.consume_feature_usage_internal(uuid, text) from public, anon;
grant execute on function private.consume_feature_usage_internal(uuid, text) to authenticated;
revoke all on function public.consume_feature_usage(text) from public, anon;
grant execute on function public.consume_feature_usage(text) to authenticated;

create or replace function private.my_account_access_internal(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with effective as (
    select coalesce(private.effective_plan(p_user_id), 'free') as plan_code
  ),
  subscription as (
    select s.status, s.cancel_at_period_end, s.current_period_end
    from public.account_subscriptions s where s.user_id = p_user_id
  ),
  usage as (
    select coalesce(sum(f.usage_count), 0)::integer as used
    from public.feature_usage_monthly f
    where f.user_id = p_user_id
      and f.feature_key = 'rag_analysis'
      and f.period_start = date_trunc('month', now())::date
  )
  select jsonb_build_object(
    'plan', e.plan_code,
    'status', coalesce(s.status, 'free'),
    'cancel_at_period_end', coalesce(s.cancel_at_period_end, false),
    'current_period_end', s.current_period_end,
    'rag_used', u.used,
    'rag_limit', pfl.quota,
    'features', (
      select coalesce(jsonb_object_agg(p.feature_key, jsonb_build_object('enabled', p.enabled, 'quota', p.quota)), '{}'::jsonb)
      from public.plan_feature_limits p where p.plan_code = e.plan_code
    )
  )
  from effective e
  cross join usage u
  left join subscription s on true
  left join public.plan_feature_limits pfl
    on pfl.plan_code = e.plan_code and pfl.feature_key = 'rag_analysis';
$$;

create or replace function public.get_my_account_access()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.my_account_access_internal((select auth.uid()));
$$;

revoke all on function private.my_account_access_internal(uuid) from public, anon;
grant execute on function private.my_account_access_internal(uuid) to authenticated;
revoke all on function public.get_my_account_access() from public, anon;
grant execute on function public.get_my_account_access() to authenticated;

create or replace function private.enforce_resource_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feature text := tg_argv[0];
  v_quota integer;
  v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));

  if tg_table_name = 'career_paths'
    and exists (select 1 from public.career_paths where id = new.id and user_id = new.user_id) then
    return new;
  elsif tg_table_name = 'job_descriptions'
    and exists (select 1 from public.job_descriptions where id = new.id and user_id = new.user_id) then
    return new;
  elsif tg_table_name = 'knowledge_evidence'
    and exists (select 1 from public.knowledge_evidence where id = new.id and user_id = new.user_id) then
    return new;
  end if;

  select fl.quota into v_quota
  from private.feature_limit(new.user_id, v_feature) fl
  where fl.enabled;

  if v_quota is null then
    return new;
  end if;

  if tg_table_name = 'career_paths' then
    select count(*) into v_count from public.career_paths where user_id = new.user_id;
  elsif tg_table_name = 'job_descriptions' then
    select count(*) into v_count from public.job_descriptions where user_id = new.user_id;
  elsif tg_table_name = 'knowledge_evidence' then
    select count(*) into v_count from public.knowledge_evidence where user_id = new.user_id;
  else
    raise exception 'Unsupported limited resource';
  end if;

  if v_count >= coalesce(v_quota, 0) then
    raise exception 'Your current plan limit for % has been reached', v_feature
      using errcode = 'P0001', hint = 'Upgrade to Premium or remove an existing item.';
  end if;
  return new;
end;
$$;

create trigger enforce_path_plan_limit
  before insert on public.career_paths
  for each row execute function private.enforce_resource_limit('job_paths');
create trigger enforce_job_plan_limit
  before insert on public.job_descriptions
  for each row execute function private.enforce_resource_limit('job_descriptions');
create trigger enforce_knowledge_plan_limit
  before insert on public.knowledge_evidence
  for each row execute function private.enforce_resource_limit('knowledge_evidence');

create or replace function private.handle_new_masari_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.career_profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (user_id) do nothing;
  insert into public.account_subscriptions (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_masari on auth.users;
create trigger on_auth_user_created_masari
  after insert on auth.users
  for each row execute function private.handle_new_masari_user();

insert into public.career_profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

insert into public.account_subscriptions (user_id)
select id from auth.users
on conflict (user_id) do nothing;

grant usage, select on sequence public.audit_events_id_seq to authenticated, service_role;

revoke all on function private.effective_plan(uuid) from public, anon, authenticated;
revoke all on function private.feature_limit(uuid, text) from public, anon, authenticated;
revoke all on function private.enforce_resource_limit() from public, anon, authenticated;
revoke all on function private.handle_new_masari_user() from public, anon, authenticated;
