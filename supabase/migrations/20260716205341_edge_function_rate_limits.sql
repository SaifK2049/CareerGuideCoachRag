create table private.rate_limit_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (char_length(action) between 1 and 64),
  window_start timestamptz not null,
  reset_at timestamptz not null,
  request_count bigint not null check (request_count > 0),
  primary key (user_id, action, window_start)
);

alter table private.rate_limit_buckets enable row level security;
revoke all on private.rate_limit_buckets from public, anon, authenticated, service_role;

create policy "rate limit buckets are service-only"
  on private.rate_limit_buckets
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.consume_rate_limit(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_reset_at timestamptz;
  v_count bigint;
begin
  if p_user_id is null
    or p_action is null
    or char_length(p_action) not between 1 and 64
    or p_limit not between 1 and 10000
    or p_window_seconds not between 1 and 86400
  then
    raise exception 'Invalid rate-limit policy';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_reset_at := v_window_start + make_interval(secs => p_window_seconds);

  delete from private.rate_limit_buckets as bucket
  where bucket.user_id = p_user_id
    and bucket.action = p_action
    and bucket.reset_at < v_now;

  insert into private.rate_limit_buckets as bucket (
    user_id,
    action,
    window_start,
    reset_at,
    request_count
  )
  values (
    p_user_id,
    p_action,
    v_window_start,
    v_reset_at,
    1
  )
  on conflict (user_id, action, window_start)
  do update set request_count = bucket.request_count + 1
  returning bucket.request_count into v_count;

  return query
  select
    v_count <= p_limit,
    greatest(0, p_limit - v_count)::integer,
    greatest(1, ceil(extract(epoch from (v_reset_at - v_now)))::integer),
    v_reset_at;
end;
$$;

revoke all on function public.consume_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid, text, integer, integer)
  to service_role;

comment on function public.consume_rate_limit(uuid, text, integer, integer)
  is 'Atomically consumes a fixed-window Edge Function request allowance. Service role only.';
