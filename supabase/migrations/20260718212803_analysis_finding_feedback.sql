create table public.analysis_finding_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null references public.career_analyses(id) on delete cascade,
  finding_index integer not null check (finding_index between 0 and 39),
  rating text not null check (rating in ('useful', 'needs_work')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, analysis_id, finding_index)
);

create index analysis_finding_feedback_user_idx
  on public.analysis_finding_feedback(user_id, updated_at desc);

alter table public.analysis_finding_feedback enable row level security;

create policy "finding feedback owner read"
  on public.analysis_finding_feedback for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "finding feedback owner insert"
  on public.analysis_finding_feedback for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.career_analyses analysis
      where analysis.id = analysis_id
        and analysis.user_id = (select auth.uid())
    )
  );

create policy "finding feedback owner update"
  on public.analysis_finding_feedback for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.career_analyses analysis
      where analysis.id = analysis_id
        and analysis.user_id = (select auth.uid())
    )
  );

create policy "finding feedback owner delete"
  on public.analysis_finding_feedback for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete
  on public.analysis_finding_feedback
  to authenticated, service_role;
