alter table public.job_descriptions
  add column application_status text not null default 'saved'
    check (application_status in ('saved', 'applied', 'interviewing', 'offer', 'rejected', 'archived')),
  add column closing_date date,
  add column applied_at timestamptz,
  add column notes text not null default ''
    check (char_length(notes) <= 10000);

alter table public.job_descriptions
  add constraint job_descriptions_id_user_unique unique (id, user_id);
alter table public.knowledge_evidence
  add constraint knowledge_evidence_id_user_unique unique (id, user_id);
alter table public.career_analyses
  add constraint career_analyses_id_user_unique unique (id, user_id);

create table public.action_plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path_id uuid,
  analysis_id uuid,
  finding_index integer check (finding_index is null or finding_index between 0 and 39),
  evidence_id uuid,
  title text not null check (char_length(title) between 1 and 240),
  skill text not null default '' check (char_length(skill) <= 160),
  description text not null default '' check (char_length(description) <= 10000),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed')),
  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  target_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (path_id, user_id) references public.career_paths(id, user_id) on delete cascade,
  foreign key (analysis_id, user_id) references public.career_analyses(id, user_id) on delete set null (analysis_id),
  foreign key (evidence_id, user_id) references public.knowledge_evidence(id, user_id) on delete set null (evidence_id)
);

create table public.analysis_evidence_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null,
  finding_index integer not null check (finding_index between 0 and 39),
  evidence_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, analysis_id, finding_index, evidence_id),
  foreign key (analysis_id, user_id) references public.career_analyses(id, user_id) on delete cascade,
  foreign key (evidence_id, user_id) references public.knowledge_evidence(id, user_id) on delete cascade
);

create table public.cv_guidance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path_id uuid not null,
  job_id uuid not null,
  summary text not null default '' check (char_length(summary) <= 20000),
  suggestions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestions) = 'array'),
  model text not null default '' check (char_length(model) <= 120),
  created_at timestamptz not null default now(),
  foreign key (path_id, user_id) references public.career_paths(id, user_id) on delete cascade,
  foreign key (job_id, user_id) references public.job_descriptions(id, user_id) on delete cascade
);

create table public.shared_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path_id uuid not null,
  analysis_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  foreign key (path_id, user_id) references public.career_paths(id, user_id) on delete cascade,
  foreign key (analysis_id, user_id) references public.career_analyses(id, user_id) on delete cascade
);

create index action_plan_items_user_path_status_idx
  on public.action_plan_items(user_id, path_id, status, target_date);
create index action_plan_items_path_owner_idx
  on public.action_plan_items(path_id, user_id);
create index action_plan_items_analysis_owner_idx
  on public.action_plan_items(analysis_id, user_id)
  where analysis_id is not null;
create index action_plan_items_evidence_owner_idx
  on public.action_plan_items(evidence_id, user_id)
  where evidence_id is not null;
create index analysis_evidence_links_analysis_idx
  on public.analysis_evidence_links(analysis_id, user_id);
create index analysis_evidence_links_evidence_idx
  on public.analysis_evidence_links(evidence_id, user_id);
create index cv_guidance_user_job_created_idx
  on public.cv_guidance(user_id, job_id, created_at desc);
create index cv_guidance_path_owner_idx
  on public.cv_guidance(path_id, user_id);
create index cv_guidance_job_owner_idx
  on public.cv_guidance(job_id, user_id);
create index shared_reports_user_created_idx
  on public.shared_reports(user_id, created_at desc);
create index shared_reports_path_owner_idx
  on public.shared_reports(path_id, user_id);
create index shared_reports_analysis_owner_idx
  on public.shared_reports(analysis_id, user_id);
create index shared_reports_active_token_idx
  on public.shared_reports(token_hash)
  where revoked_at is null;

alter table public.action_plan_items enable row level security;
alter table public.analysis_evidence_links enable row level security;
alter table public.cv_guidance enable row level security;
alter table public.shared_reports enable row level security;

create policy "action plan owner access" on public.action_plan_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "analysis evidence owner access" on public.analysis_evidence_links
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "cv guidance owner read" on public.cv_guidance
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "shared report owner access" on public.shared_reports
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on
  public.action_plan_items, public.analysis_evidence_links, public.shared_reports
  to authenticated;
grant select on public.cv_guidance to authenticated;
grant select, insert, update, delete on
  public.action_plan_items, public.analysis_evidence_links, public.cv_guidance,
  public.shared_reports
  to service_role;
