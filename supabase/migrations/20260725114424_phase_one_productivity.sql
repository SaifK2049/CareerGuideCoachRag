alter table public.career_profiles
  add column reminder_settings jsonb not null default
    '{"closing_days":3,"follow_up_days":0,"interview_hours":24,"include_plan_items":true}'::jsonb,
  add column dismissed_reminders jsonb not null default '{}'::jsonb,
  add constraint career_profiles_reminder_settings_object
    check (jsonb_typeof(reminder_settings) = 'object'),
  add constraint career_profiles_dismissed_reminders_object
    check (jsonb_typeof(dismissed_reminders) = 'object');

alter table public.job_descriptions
  add column source_provider text not null default ''
    check (char_length(source_provider) <= 80),
  add column external_job_id text not null default ''
    check (char_length(external_job_id) <= 240),
  add column employment_type text not null default ''
    check (char_length(employment_type) <= 120),
  add column work_arrangement text not null default ''
    check (char_length(work_arrangement) <= 120),
  add column salary_text text not null default ''
    check (char_length(salary_text) <= 240),
  add column import_metadata jsonb not null default '{}'::jsonb,
  add column normalized_source_url text not null default ''
    check (char_length(normalized_source_url) <= 2048),
  add constraint job_descriptions_import_metadata_object
    check (jsonb_typeof(import_metadata) = 'object');

create index job_descriptions_user_normalized_source_idx
  on public.job_descriptions(user_id, normalized_source_url)
  where normalized_source_url <> '';

create index job_descriptions_user_provider_external_idx
  on public.job_descriptions(user_id, source_provider, external_job_id)
  where source_provider <> '' and external_job_id <> '';

grant select, insert, update on table public.career_profiles to authenticated;
grant select, insert, update, delete on table public.job_descriptions to authenticated;
