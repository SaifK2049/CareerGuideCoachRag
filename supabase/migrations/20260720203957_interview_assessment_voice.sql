insert into public.plan_feature_limits (plan_code, feature_key, enabled, quota) values
  ('free', 'interview_voice', false, 0),
  ('premium', 'interview_voice', true, null)
on conflict (plan_code, feature_key) do update set
  enabled = excluded.enabled,
  quota = excluded.quota;

alter table public.interview_practice_sessions
  add column assessment_status text not null default 'not_started'
    check (assessment_status in ('not_started', 'pending', 'succeeded', 'failed')),
  add column assessment jsonb not null default '{}'::jsonb
    check (jsonb_typeof(assessment) = 'object'),
  add column assessment_model text not null default ''
    check (char_length(assessment_model) <= 120),
  add column assessment_failure_code text
    check (assessment_failure_code is null or char_length(assessment_failure_code) <= 80),
  add column assessed_at timestamptz;

create index interview_sessions_user_assessment_idx
  on public.interview_practice_sessions(user_id, assessment_status, updated_at desc);

create or replace function private.reserve_interview_assessment_internal(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.interview_practice_sessions%rowtype;
begin
  if p_user_id is null or p_user_id <> (select auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_session
  from public.interview_practice_sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Interview session not found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'completed'
    or v_session.answered_count < jsonb_array_length(v_session.questions) then
    raise exception 'Complete every answer before requesting feedback' using errcode = '22023';
  end if;
  if v_session.assessment_status = 'succeeded' then
    return jsonb_build_object('state', 'succeeded', 'assessment', v_session.assessment);
  end if;
  if v_session.assessment_status = 'pending'
    and v_session.updated_at > now() - interval '10 minutes' then
    return jsonb_build_object('state', 'pending');
  end if;

  update public.interview_practice_sessions
  set assessment_status = 'pending', assessment_failure_code = null, updated_at = now()
  where id = p_session_id;

  return jsonb_build_object('state', 'reserved');
end;
$$;

create or replace function public.reserve_interview_assessment(p_session_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reserve_interview_assessment_internal((select auth.uid()), p_session_id);
$$;

revoke all on function private.reserve_interview_assessment_internal(uuid, uuid)
  from public, anon;
grant execute on function private.reserve_interview_assessment_internal(uuid, uuid)
  to authenticated;
revoke all on function public.reserve_interview_assessment(uuid) from public, anon;
grant execute on function public.reserve_interview_assessment(uuid) to authenticated;

create or replace function public.complete_interview_assessment(
  p_user_id uuid,
  p_session_id uuid,
  p_assessment jsonb,
  p_model text
)
returns public.interview_practice_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.interview_practice_sessions%rowtype;
begin
  if jsonb_typeof(p_assessment) <> 'object' or char_length(coalesce(p_model, '')) > 120 then
    raise exception 'Invalid assessment result' using errcode = '22023';
  end if;

  update public.interview_practice_sessions
  set
    assessment_status = 'succeeded',
    assessment = p_assessment,
    assessment_model = p_model,
    assessment_failure_code = null,
    assessed_at = now(),
    updated_at = now()
  where id = p_session_id and user_id = p_user_id and assessment_status = 'pending'
  returning * into v_session;

  return v_session;
end;
$$;

create or replace function public.fail_interview_assessment(
  p_user_id uuid,
  p_session_id uuid,
  p_failure_code text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  update public.interview_practice_sessions
  set
    assessment_status = 'failed',
    assessment_failure_code = left(coalesce(p_failure_code, 'ASSESSMENT_FAILED'), 80),
    updated_at = now()
  where id = p_session_id and user_id = p_user_id and assessment_status = 'pending'
  returning true;
$$;

revoke all on function public.complete_interview_assessment(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_interview_assessment(uuid, uuid, jsonb, text)
  to service_role;
revoke all on function public.fail_interview_assessment(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_interview_assessment(uuid, uuid, text)
  to service_role;

create or replace function private.invalidate_interview_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.answer_text is distinct from old.answer_text
    or new.self_rating is distinct from old.self_rating then
    update public.interview_practice_sessions
    set
      assessment_status = 'not_started',
      assessment = '{}'::jsonb,
      assessment_model = '',
      assessment_failure_code = null,
      assessed_at = null,
      updated_at = now()
    where id = new.session_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function private.invalidate_interview_assessment()
  from public, anon, authenticated;

create trigger interview_answers_invalidate_assessment
after update of answer_text, self_rating on public.interview_practice_answers
for each row execute function private.invalidate_interview_assessment();
