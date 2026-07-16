with ranked as (
  select
    id,
    row_number() over (
      partition by user_id
      order by updated_at desc, created_at desc, id
    ) as position
  from public.career_analyses
  where status = 'pending'
),
failed as (
  update public.career_analyses as analysis
  set status = 'failed',
      failure_code = 'SUPERSEDED_REQUEST',
      completed_at = now(),
      updated_at = now()
  from ranked
  where analysis.id = ranked.id
    and ranked.position > 1
  returning analysis.user_id, analysis.usage_period_start
),
refunds as (
  select user_id, usage_period_start, count(*)::integer as refund_count
  from failed
  where usage_period_start is not null
  group by user_id, usage_period_start
)
update public.feature_usage_monthly as usage
set usage_count = greatest(0, usage.usage_count - refunds.refund_count),
    updated_at = now()
from refunds
where usage.user_id = refunds.user_id
  and usage.feature_key = 'rag_analysis'
  and usage.period_start = refunds.usage_period_start;

create unique index career_analyses_one_pending_user_idx
  on public.career_analyses(user_id)
  where status = 'pending';

create or replace function public.reserve_career_analysis(
  p_user_id uuid,
  p_request_id uuid,
  p_path_id uuid,
  p_target_role text,
  p_document_count integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pending_request_id uuid;
  v_pending_updated_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select analysis.request_id, analysis.updated_at
    into v_pending_request_id, v_pending_updated_at
  from public.career_analyses analysis
  where analysis.user_id = p_user_id
    and analysis.status = 'pending'
    and analysis.request_id <> p_request_id
  order by analysis.updated_at desc
  limit 1
  for update;

  if v_pending_request_id is not null
    and v_pending_updated_at > now() - interval '10 minutes'
  then
    return jsonb_build_object(
      'state', 'user_busy'
    );
  end if;

  if v_pending_request_id is not null then
    perform private.fail_career_analysis_internal(
      p_user_id,
      v_pending_request_id,
      'STALE_REQUEST'
    );
  end if;

  return private.reserve_career_analysis_internal(
    p_user_id,
    p_request_id,
    p_path_id,
    p_target_role,
    p_document_count
  );
end;
$$;

revoke all on function public.reserve_career_analysis(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_career_analysis(uuid, uuid, uuid, text, integer)
  to service_role;

comment on index public.career_analyses_one_pending_user_idx
  is 'Prevents concurrent analyses from replacing one another''s private vector chunks.';
