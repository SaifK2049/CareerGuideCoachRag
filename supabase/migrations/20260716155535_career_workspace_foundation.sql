create extension if not exists vector with schema extensions;

create table public.career_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_path_id uuid,
  cv_file_name text not null default '',
  cv_text text not null default '',
  cv_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.career_paths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  target text not null check (char_length(target) between 1 and 200),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.career_paths add constraint career_paths_id_user_unique unique (id, user_id);
alter table public.career_profiles
  add constraint career_profiles_active_path_fk
  foreign key (active_path_id, user_id) references public.career_paths(id, user_id) on delete set null (active_path_id);

create table public.job_descriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  company text not null default '',
  location text not null default '',
  source_url text not null default '',
  description text not null check (char_length(description) between 1 and 100000),
  content_hash text not null default '',
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.job_descriptions
  add constraint job_descriptions_path_owner_fk
  foreign key (path_id, user_id) references public.career_paths(id, user_id) on delete cascade;

create unique index job_descriptions_user_content_hash_unique
  on public.job_descriptions(user_id, content_hash)
  where content_hash <> '';

create table public.knowledge_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill text not null check (char_length(skill) between 1 and 160),
  title text not null check (char_length(title) between 1 and 240),
  confidence smallint not null check (confidence between 1 and 3),
  evidence text not null check (char_length(evidence) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('cv', 'job_description', 'knowledge')),
  source_id text not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 12000),
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id, chunk_index)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index career_paths_user_id_idx on public.career_paths(user_id);
create index job_descriptions_user_path_idx on public.job_descriptions(user_id, path_id);
create index knowledge_evidence_user_id_idx on public.knowledge_evidence(user_id);
create index document_chunks_user_source_idx on public.document_chunks(user_id, source_type, source_id);
create index audit_events_user_created_idx on public.audit_events(user_id, created_at desc);

alter table public.career_profiles enable row level security;
alter table public.career_paths enable row level security;
alter table public.job_descriptions enable row level security;
alter table public.knowledge_evidence enable row level security;
alter table public.document_chunks enable row level security;
alter table public.audit_events enable row level security;

create policy "profile owner access" on public.career_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "path owner access" on public.career_paths
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "job owner access" on public.job_descriptions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "evidence owner access" on public.knowledge_evidence
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "chunk owner access" on public.document_chunks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "audit owner read" on public.audit_events
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "audit owner insert" on public.audit_events
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on
  public.career_profiles, public.career_paths, public.job_descriptions,
  public.knowledge_evidence, public.document_chunks
  to authenticated;
grant select, insert on public.audit_events to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-cvs', 'private-cvs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "cv owner read" on storage.objects for select to authenticated
  using (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cv owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cv owner update" on storage.objects for update to authenticated
  using (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cv owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'private-cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.match_career_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 12,
  filter_path text default null
)
returns table (
  id uuid,
  source_type text,
  source_id text,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    dc.id, dc.source_type, dc.source_id, dc.content, dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.user_id = (select auth.uid())
    and dc.embedding is not null
    and (filter_path is null or dc.metadata->>'path_id' = filter_path or dc.metadata->>'path_id' is null)
  order by dc.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 30);
$$;

grant execute on function public.match_career_chunks(extensions.vector, integer, text) to authenticated;
