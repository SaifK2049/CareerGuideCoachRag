alter table public.job_descriptions
  add column next_action text not null default ''
    check (char_length(next_action) <= 1000),
  add column follow_up_date date,
  add column interview_at timestamptz,
  add column contact_name text not null default ''
    check (char_length(contact_name) <= 200),
  add column contact_email text not null default ''
    check (char_length(contact_email) <= 320);

create index job_descriptions_user_status_follow_up_idx
  on public.job_descriptions(user_id, application_status, follow_up_date);

create index job_descriptions_user_interview_idx
  on public.job_descriptions(user_id, interview_at)
  where interview_at is not null;
