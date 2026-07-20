insert into public.plan_feature_limits (plan_code, feature_key, enabled, quota) values
  ('free', 'interview_prep', true, 1),
  ('premium', 'interview_prep', true, 20)
on conflict (plan_code, feature_key) do update set
  enabled = excluded.enabled,
  quota = excluded.quota;

create table public.interview_practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path_id uuid,
  job_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  company text not null default '' check (char_length(company) <= 200),
  questions jsonb not null check (
    jsonb_typeof(questions) = 'array'
    and jsonb_array_length(questions) between 3 and 10
  ),
  source_context jsonb not null default '[]'::jsonb check (jsonb_typeof(source_context) = 'array'),
  status text not null default 'active' check (status in ('active', 'completed')),
  answered_count integer not null default 0 check (answered_count >= 0),
  earned_xp integer not null default 0 check (earned_xp >= 0),
  model text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (path_id, user_id)
    references public.career_paths(id, user_id) on delete cascade,
  foreign key (job_id, user_id)
    references public.job_descriptions(id, user_id) on delete cascade
);

create table public.interview_practice_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  question_index integer not null check (question_index >= 0 and question_index < 10),
  answer_text text not null check (char_length(answer_text) between 1 and 8000),
  self_rating integer not null check (self_rating between 1 and 5),
  earned_xp integer not null default 0 check (earned_xp between 0 and 25),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, question_index),
  foreign key (session_id, user_id)
    references public.interview_practice_sessions(id, user_id) on delete cascade
);

create table public.interview_game_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_xp integer not null default 0 check (total_xp >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_practice_date date,
  questions_answered integer not null default 0 check (questions_answered >= 0),
  sessions_completed integer not null default 0 check (sessions_completed >= 0),
  badges text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index interview_sessions_user_started_idx
  on public.interview_practice_sessions(user_id, started_at desc);
create index interview_sessions_path_owner_idx
  on public.interview_practice_sessions(path_id, user_id);
create index interview_sessions_job_owner_idx
  on public.interview_practice_sessions(job_id, user_id);
create index interview_answers_user_session_idx
  on public.interview_practice_answers(user_id, session_id, question_index);
create index interview_answers_session_owner_idx
  on public.interview_practice_answers(session_id, user_id);

alter table public.interview_practice_sessions enable row level security;
alter table public.interview_practice_answers enable row level security;
alter table public.interview_game_profiles enable row level security;

create policy "users read their interview sessions"
  on public.interview_practice_sessions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "users delete their interview sessions"
  on public.interview_practice_sessions for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy "users read their interview answers"
  on public.interview_practice_answers for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "users read their interview game profile"
  on public.interview_game_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "users delete their interview game profile"
  on public.interview_game_profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, delete on public.interview_practice_sessions to authenticated;
grant select on public.interview_practice_answers to authenticated;
grant select, delete on public.interview_game_profiles to authenticated;
grant select, insert, update, delete on
  public.interview_practice_sessions,
  public.interview_practice_answers,
  public.interview_game_profiles
  to service_role;

create or replace function private.reserve_interview_prep_internal(p_user_id uuid)
returns table (plan_code text, allowed boolean, used integer, quota integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id <> (select auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select usage.plan_code, usage.allowed, usage.used, usage.quota
  from private.consume_feature_usage_internal(p_user_id, 'interview_prep') usage;
end;
$$;

create or replace function public.reserve_interview_prep()
returns table (plan_code text, allowed boolean, used integer, quota integer)
language sql
security invoker
set search_path = ''
as $$
  select * from private.reserve_interview_prep_internal((select auth.uid()));
$$;

revoke all on function private.reserve_interview_prep_internal(uuid) from public, anon;
grant execute on function private.reserve_interview_prep_internal(uuid) to authenticated;
revoke all on function public.reserve_interview_prep() from public, anon;
grant execute on function public.reserve_interview_prep() to authenticated;

create or replace function public.refund_interview_prep(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.feature_usage_monthly
  set usage_count = greatest(0, usage_count - 1), updated_at = now()
  where user_id = p_user_id
    and feature_key = 'interview_prep'
    and period_start = date_trunc('month', now())::date;
$$;

revoke all on function public.refund_interview_prep(uuid) from public, anon, authenticated;
grant execute on function public.refund_interview_prep(uuid) to service_role;

create or replace function private.record_interview_answer_internal(
  p_user_id uuid,
  p_session_id uuid,
  p_question_index integer,
  p_answer_text text,
  p_self_rating integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.interview_practice_sessions%rowtype;
  v_existing public.interview_practice_answers%rowtype;
  v_answer_xp integer := 0;
  v_completion_xp integer := 0;
  v_answered integer;
  v_question_count integer;
  v_today date := (now() at time zone 'utc')::date;
  v_profile public.interview_game_profiles%rowtype;
begin
  if p_user_id is null or p_user_id <> (select auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_question_index < 0 or p_question_index >= 10
    or char_length(trim(coalesce(p_answer_text, ''))) < 1
    or char_length(p_answer_text) > 8000
    or p_self_rating not between 1 and 5 then
    raise exception 'Invalid answer' using errcode = '22023';
  end if;

  select * into v_session
  from public.interview_practice_sessions
  where id = p_session_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'Interview session not found' using errcode = 'P0002';
  end if;

  v_question_count := jsonb_array_length(v_session.questions);
  if p_question_index >= v_question_count then
    raise exception 'Question does not exist' using errcode = '22023';
  end if;

  select * into v_existing
  from public.interview_practice_answers
  where session_id = p_session_id and question_index = p_question_index;

  if v_existing.id is null then
    v_answer_xp := 10 + case when char_length(trim(p_answer_text)) >= 150 then 5 else 0 end;
    insert into public.interview_practice_answers (
      user_id, session_id, question_index, answer_text, self_rating, earned_xp
    ) values (
      p_user_id, p_session_id, p_question_index, trim(p_answer_text), p_self_rating, v_answer_xp
    );
  else
    update public.interview_practice_answers
    set answer_text = trim(p_answer_text), self_rating = p_self_rating, updated_at = now()
    where id = v_existing.id;
  end if;

  select count(*)::integer into v_answered
  from public.interview_practice_answers
  where session_id = p_session_id;

  if v_session.status <> 'completed' and v_answered >= v_question_count then
    v_completion_xp := 50;
  end if;

  update public.interview_practice_sessions
  set
    answered_count = v_answered,
    earned_xp = earned_xp + v_answer_xp + v_completion_xp,
    status = case when v_answered >= v_question_count then 'completed' else status end,
    completed_at = case
      when v_answered >= v_question_count then coalesce(completed_at, now())
      else completed_at
    end,
    updated_at = now()
  where id = p_session_id;

  insert into public.interview_game_profiles (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  update public.interview_game_profiles
  set
    total_xp = total_xp + v_answer_xp + v_completion_xp,
    current_streak = case
      when v_answer_xp = 0 or last_practice_date = v_today then current_streak
      when last_practice_date = v_today - 1 then current_streak + 1
      else 1
    end,
    last_practice_date = case when v_answer_xp > 0 then v_today else last_practice_date end,
    questions_answered = questions_answered + case when v_answer_xp > 0 then 1 else 0 end,
    sessions_completed = sessions_completed + case when v_completion_xp > 0 then 1 else 0 end,
    updated_at = now()
  where user_id = p_user_id
  returning * into v_profile;

  update public.interview_game_profiles as game
  set
    longest_streak = greatest(game.longest_streak, game.current_streak),
    badges = array(
      select distinct unlocked.badge
      from unnest(game.badges || array_remove(array[
        case when game.questions_answered >= 1 then 'first_answer' end,
        case when game.questions_answered >= 5 then 'warm_up' end,
        case when game.sessions_completed >= 1 then 'session_complete' end,
        case when game.current_streak >= 3 then 'streak_3' end,
        case when game.total_xp >= 500 then 'xp_500' end
      ], null)) as unlocked(badge)
    )
  where game.user_id = p_user_id
  returning * into v_profile;

  return jsonb_build_object(
    'answer_xp', v_answer_xp,
    'completion_xp', v_completion_xp,
    'session_completed', v_completion_xp > 0,
    'profile', to_jsonb(v_profile)
  );
end;
$$;

create or replace function public.record_interview_answer(
  p_session_id uuid,
  p_question_index integer,
  p_answer_text text,
  p_self_rating integer
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_interview_answer_internal(
    (select auth.uid()),
    p_session_id,
    p_question_index,
    p_answer_text,
    p_self_rating
  );
$$;

revoke all on function private.record_interview_answer_internal(uuid, uuid, integer, text, integer)
  from public, anon;
grant execute on function private.record_interview_answer_internal(uuid, uuid, integer, text, integer)
  to authenticated;
revoke all on function public.record_interview_answer(uuid, integer, text, integer)
  from public, anon;
grant execute on function public.record_interview_answer(uuid, integer, text, integer)
  to authenticated;
