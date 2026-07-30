create schema if not exists private;

alter table public.career_profiles
  add column if not exists guidance_locale text not null default 'en'
  check (guidance_locale in ('en', 'ar'));

alter table public.job_descriptions
  add column if not exists cv_version_label text not null default ''
  check (char_length(cv_version_label) <= 120);

alter table public.operational_events
  drop constraint if exists operational_events_operation_check;
alter table public.operational_events
  add constraint operational_events_operation_check check (
    operation in (
      'analyze_career', 'cv_guidance', 'import_job', 'interview_generate',
      'interview_assess', 'interview_transcribe', 'shared_report', 'export_account',
      'delete_account', 'checkout', 'billing_portal', 'stripe_webhook',
      'join_waitlist', 'career_intelligence', 'career_planning', 'institution_dashboard',
      'mentor_network', 'company_intelligence', 'interview_video_assess',
      'portfolio_analyse', 'credential_verify'
    )
  );

alter table public.product_events
  drop constraint if exists product_events_surface_check;
alter table public.product_events
  add constraint product_events_surface_check check (
    surface is null or surface in (
      'auth', 'onboarding', 'overview', 'profile', 'paths', 'knowledge', 'plan',
      'interview', 'applications', 'progress', 'feedback', 'reports', 'twin',
      'institution', 'mentors'
    )
  );

alter table public.product_events
  drop constraint if exists product_events_workflow_check;
alter table public.product_events
  add constraint product_events_workflow_check check (
    workflow is null or workflow in (
      'onboarding', 'cv', 'job', 'analysis', 'application', 'action_plan',
      'interview_practice', 'interview_assessment', 'report_share', 'feedback',
      'career_intelligence'
    )
  );

create or replace function public.record_product_event(
  p_event_name text,
  p_surface text,
  p_workflow text,
  p_error_code text,
  p_session_id uuid,
  p_app_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_error_code text := nullif(upper(trim(coalesce(p_error_code, ''))), '');
begin
  if v_user_id is null or p_session_id is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_event_name not in ('app_open', 'view_open', 'workflow_started', 'workflow_completed', 'workflow_failed') then
    raise exception 'Invalid event name' using errcode = '22023';
  end if;
  if p_surface is not null and p_surface not in (
    'auth', 'onboarding', 'overview', 'profile', 'paths', 'knowledge', 'plan',
    'interview', 'applications', 'progress', 'feedback', 'reports', 'twin',
    'institution', 'mentors'
  ) then
    raise exception 'Invalid surface' using errcode = '22023';
  end if;
  if (p_event_name like 'workflow_%') <> (p_workflow is not null) then
    raise exception 'Invalid workflow event' using errcode = '22023';
  end if;
  if p_workflow is not null and p_workflow not in (
    'onboarding', 'cv', 'job', 'analysis', 'application', 'action_plan',
    'interview_practice', 'interview_assessment', 'report_share', 'feedback',
    'career_intelligence'
  ) then
    raise exception 'Invalid workflow' using errcode = '22023';
  end if;
  if (p_event_name = 'workflow_failed') <> (v_error_code is not null)
    or (v_error_code is not null and (char_length(v_error_code) > 80 or v_error_code !~ '^[A-Z0-9_:-]+$'))
  then
    raise exception 'Invalid error code' using errcode = '22023';
  end if;
  if char_length(coalesce(p_app_version, '')) not between 1 and 40 then
    raise exception 'Invalid app version' using errcode = '22023';
  end if;

  insert into public.product_events (
    user_id, event_name, surface, workflow, error_code, session_id, app_version
  ) values (
    v_user_id, p_event_name, p_surface, p_workflow, v_error_code,
    p_session_id, p_app_version
  );
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  slug text not null unique check (
    char_length(slug) between 2 and 80
    and slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  organization_type text not null check (
    organization_type in ('university', 'government', 'employer', 'training_provider', 'partner')
  ),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  region text not null default 'EMEA' check (char_length(region) between 2 and 80),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'advisor', 'analyst', 'member')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create or replace function private.organization_has_role(
  p_organization_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and (p_roles is null or membership.role = any(p_roles))
  );
$$;

revoke all on function private.organization_has_role(uuid, text[]) from public, anon;
grant execute on function private.organization_has_role(uuid, text[]) to authenticated, service_role;

create table public.organization_data_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scopes text[] not null default '{}'::text[] check (
    scopes <@ array[
      'cohort_analytics', 'individual_guidance', 'placement_reporting',
      'programme_evaluation', 'mentor_matching'
    ]::text[]
  ),
  status text not null default 'active' check (status in ('active', 'withdrawn', 'expired')),
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  check (expires_at is null or expires_at > granted_at),
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);

create table public.career_taxonomy_nodes (
  id uuid primary key default gen_random_uuid(),
  taxonomy text not null check (
    taxonomy in ('esco', 'onet', 'custom', 'vendor', 'institution')
  ),
  external_id text not null,
  node_type text not null check (
    node_type in ('skill', 'occupation', 'technology', 'certification', 'course', 'industry')
  ),
  preferred_label text not null check (char_length(preferred_label) between 1 and 240),
  description text not null default '' check (char_length(description) <= 10000),
  aliases text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (taxonomy, external_id)
);

create table public.career_taxonomy_edges (
  id uuid primary key default gen_random_uuid(),
  from_node_id uuid not null references public.career_taxonomy_nodes(id) on delete cascade,
  to_node_id uuid not null references public.career_taxonomy_nodes(id) on delete cascade,
  relationship text not null check (
    relationship in ('broader', 'narrower', 'related', 'requires', 'supports', 'validated_by')
  ),
  weight numeric(6, 5) not null default 1 check (weight between 0 and 1),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (from_node_id, to_node_id, relationship),
  check (from_node_id <> to_node_id)
);

create table public.career_graph_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  taxonomy_node_id uuid references public.career_taxonomy_nodes(id) on delete set null,
  node_type text not null check (
    node_type in (
      'skill', 'occupation', 'career_path', 'project', 'certification', 'course',
      'github_repository', 'evidence', 'interview_performance', 'application',
      'company', 'technology', 'career_goal', 'action_item', 'portfolio'
    )
  ),
  canonical_key text not null check (char_length(canonical_key) between 3 and 500),
  label text not null check (char_length(label) between 1 and 240),
  description text not null default '' check (char_length(description) <= 20000),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  source_type text not null default 'manual' check (
    source_type in (
      'manual', 'profile', 'cv', 'career_path', 'job', 'knowledge', 'analysis',
      'interview', 'action_plan', 'github', 'portfolio', 'credential', 'market',
      'roadmap'
    )
  ),
  source_id text,
  confidence numeric(6, 5) not null default 1 check (confidence between 0 and 1),
  verification_status text not null default 'observed' check (
    verification_status in ('inferred', 'observed', 'user_verified', 'externally_verified')
  ),
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canonical_key),
  unique (id, user_id)
);

create table public.career_graph_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  from_node_id uuid not null,
  to_node_id uuid not null,
  relationship text not null check (
    relationship in (
      'requires', 'supports', 'validated_by', 'demonstrated_by', 'related_to',
      'targets', 'employed_by', 'completed', 'uses', 'applied_to',
      'performed_in', 'located_in', 'aims_for', 'contains', 'improves',
      'recommended_for'
    )
  ),
  weight numeric(6, 5) not null default 1 check (weight between 0 and 1),
  confidence numeric(6, 5) not null default 1 check (confidence between 0 and 1),
  rationale text not null default '' check (char_length(rationale) <= 10000),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (from_node_id, user_id)
    references public.career_graph_nodes(id, user_id) on delete cascade,
  foreign key (to_node_id, user_id)
    references public.career_graph_nodes(id, user_id) on delete cascade,
  unique (user_id, from_node_id, to_node_id, relationship),
  check (from_node_id <> to_node_id)
);

create table public.career_twins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'stale', 'failed')),
  current_experience_level text not null default '' check (char_length(current_experience_level) <= 160),
  trajectory text not null default '' check (char_length(trajectory) <= 1000),
  trajectory_ar text not null default '' check (char_length(trajectory_ar) <= 1000),
  guidance_locale text not null default 'en' check (guidance_locale in ('en', 'ar')),
  preferred_industries jsonb not null default '[]'::jsonb check (jsonb_typeof(preferred_industries) = 'array'),
  technical_strengths jsonb not null default '[]'::jsonb check (jsonb_typeof(technical_strengths) = 'array'),
  behavioural_strengths jsonb not null default '[]'::jsonb check (jsonb_typeof(behavioural_strengths) = 'array'),
  missing_competencies jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_competencies) = 'array'),
  long_term_aspirations jsonb not null default '[]'::jsonb check (jsonb_typeof(long_term_aspirations) = 'array'),
  summary text not null default '' check (char_length(summary) <= 20000),
  summary_ar text not null default '' check (char_length(summary_ar) <= 20000),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  graph_version bigint not null default 0 check (graph_version >= 0),
  input_fingerprint text not null default '' check (char_length(input_fingerprint) <= 128),
  model text not null default '' check (char_length(model) <= 120),
  confidence numeric(6, 5) not null default 0 check (confidence between 0 and 1),
  refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.career_twin_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  graph_version bigint not null check (graph_version >= 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  reason text not null default 'refresh' check (
    reason in ('initial', 'refresh', 'profile_change', 'analysis_change', 'simulation')
  ),
  created_at timestamptz not null default now()
);

create table public.career_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  recommendation_type text not null check (
    recommendation_type in (
      'skill', 'certification', 'course', 'project', 'application', 'interview',
      'mobility', 'portfolio', 'career_path', 'mentor', 'company'
    )
  ),
  title text not null check (char_length(title) between 1 and 240),
  summary text not null check (char_length(summary) between 1 and 20000),
  localized jsonb not null default '{}'::jsonb check (jsonb_typeof(localized) = 'object'),
  rationale jsonb not null check (jsonb_typeof(rationale) = 'object'),
  impact jsonb not null default '{}'::jsonb check (jsonb_typeof(impact) = 'object'),
  effort jsonb not null default '{}'::jsonb check (jsonb_typeof(effort) = 'object'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  graph_node_ids uuid[] not null default '{}'::uuid[],
  state text not null default 'active' check (
    state in ('active', 'accepted', 'dismissed', 'completed', 'superseded')
  ),
  source_analysis_id uuid references public.career_analyses(id) on delete set null,
  engine_version text not null default 'v2-foundation' check (char_length(engine_version) between 1 and 80),
  confidence numeric(6, 5) not null default 0 check (confidence between 0 and 1),
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > generated_at)
);

create index organization_memberships_user_idx
  on public.organization_memberships(user_id, status, organization_id);
create index organization_data_consents_user_idx
  on public.organization_data_consents(user_id, status, organization_id);
create index career_taxonomy_nodes_type_label_idx
  on public.career_taxonomy_nodes(node_type, preferred_label);
create index career_taxonomy_edges_from_idx
  on public.career_taxonomy_edges(from_node_id, relationship);
create index career_taxonomy_edges_to_idx
  on public.career_taxonomy_edges(to_node_id, relationship);
create index career_graph_nodes_user_type_idx
  on public.career_graph_nodes(user_id, node_type, updated_at desc);
create index career_graph_nodes_taxonomy_idx
  on public.career_graph_nodes(taxonomy_node_id)
  where taxonomy_node_id is not null;
create index career_graph_nodes_organization_idx
  on public.career_graph_nodes(organization_id, node_type)
  where organization_id is not null;
create index career_graph_edges_user_from_idx
  on public.career_graph_edges(user_id, from_node_id, relationship);
create index career_graph_edges_user_to_idx
  on public.career_graph_edges(user_id, to_node_id, relationship);
create index career_twin_snapshots_user_created_idx
  on public.career_twin_snapshots(user_id, created_at desc);
create index career_recommendations_user_state_idx
  on public.career_recommendations(user_id, state, generated_at desc);

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_data_consents enable row level security;
alter table public.career_taxonomy_nodes enable row level security;
alter table public.career_taxonomy_edges enable row level security;
alter table public.career_graph_nodes enable row level security;
alter table public.career_graph_edges enable row level security;
alter table public.career_twins enable row level security;
alter table public.career_twin_snapshots enable row level security;
alter table public.career_recommendations enable row level security;

create policy "organization members can read organization"
  on public.organizations for select to authenticated
  using ((select private.organization_has_role(id, null)));

create policy "organization administrators can update organization"
  on public.organizations for update to authenticated
  using ((select private.organization_has_role(id, array['owner', 'admin']::text[])))
  with check ((select private.organization_has_role(id, array['owner', 'admin']::text[])));

create policy "members can read their organization memberships"
  on public.organization_memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.organization_has_role(organization_id, array['owner', 'admin', 'advisor']::text[]))
  );

create policy "organization administrators can manage memberships"
  on public.organization_memberships for all to authenticated
  using ((select private.organization_has_role(organization_id, array['owner', 'admin']::text[])))
  with check ((select private.organization_has_role(organization_id, array['owner', 'admin']::text[])));

create policy "users manage their institutional consents"
  on public.organization_data_consents for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "organization administrators read active consents"
  on public.organization_data_consents for select to authenticated
  using (
    (select private.organization_has_role(organization_id, array['owner', 'admin', 'advisor']::text[]))
  );

create policy "authenticated users read career taxonomy nodes"
  on public.career_taxonomy_nodes for select to authenticated
  using (true);

create policy "authenticated users read career taxonomy edges"
  on public.career_taxonomy_edges for select to authenticated
  using (true);

create policy "career graph node owner access"
  on public.career_graph_nodes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "consented advisors read career graph nodes"
  on public.career_graph_nodes for select to authenticated
  using (
    organization_id is not null
    and (select private.organization_has_role(
      organization_id,
      array['owner', 'admin', 'advisor']::text[]
    ))
    and exists (
      select 1
      from public.organization_data_consents consent
      where consent.organization_id = career_graph_nodes.organization_id
        and consent.user_id = career_graph_nodes.user_id
        and consent.status = 'active'
        and 'individual_guidance' = any(consent.scopes)
        and (consent.expires_at is null or consent.expires_at > now())
    )
  );

create policy "career graph edge owner access"
  on public.career_graph_edges for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "consented advisors read career graph edges"
  on public.career_graph_edges for select to authenticated
  using (
    organization_id is not null
    and (select private.organization_has_role(
      organization_id,
      array['owner', 'admin', 'advisor']::text[]
    ))
    and exists (
      select 1
      from public.organization_data_consents consent
      where consent.organization_id = career_graph_edges.organization_id
        and consent.user_id = career_graph_edges.user_id
        and consent.status = 'active'
        and 'individual_guidance' = any(consent.scopes)
        and (consent.expires_at is null or consent.expires_at > now())
    )
  );

create policy "career twin owner access"
  on public.career_twins for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "consented advisors read career twin"
  on public.career_twins for select to authenticated
  using (
    organization_id is not null
    and (select private.organization_has_role(
      organization_id,
      array['owner', 'admin', 'advisor']::text[]
    ))
    and exists (
      select 1
      from public.organization_data_consents consent
      where consent.organization_id = career_twins.organization_id
        and consent.user_id = career_twins.user_id
        and consent.status = 'active'
        and 'individual_guidance' = any(consent.scopes)
        and (consent.expires_at is null or consent.expires_at > now())
    )
  );

create policy "career twin snapshot owner read"
  on public.career_twin_snapshots for select to authenticated
  using (user_id = (select auth.uid()));

create policy "career twin snapshot owner insert"
  on public.career_twin_snapshots for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "career twin snapshot owner delete"
  on public.career_twin_snapshots for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "career recommendation owner access"
  on public.career_recommendations for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "consented advisors read career recommendations"
  on public.career_recommendations for select to authenticated
  using (
    organization_id is not null
    and (select private.organization_has_role(
      organization_id,
      array['owner', 'admin', 'advisor']::text[]
    ))
    and exists (
      select 1
      from public.organization_data_consents consent
      where consent.organization_id = career_recommendations.organization_id
        and consent.user_id = career_recommendations.user_id
        and consent.status = 'active'
        and 'individual_guidance' = any(consent.scopes)
        and (consent.expires_at is null or consent.expires_at > now())
    )
  );

grant select on
  public.organizations, public.organization_memberships,
  public.career_taxonomy_nodes, public.career_taxonomy_edges
  to authenticated;
grant select, insert, update, delete on
  public.organization_data_consents, public.career_graph_nodes,
  public.career_graph_edges, public.career_twins, public.career_recommendations
  to authenticated;
grant select, insert, delete on public.career_twin_snapshots to authenticated;

grant select, insert, update, delete on
  public.organizations, public.organization_memberships,
  public.organization_data_consents, public.career_taxonomy_nodes,
  public.career_taxonomy_edges, public.career_graph_nodes,
  public.career_graph_edges, public.career_twins,
  public.career_twin_snapshots, public.career_recommendations
  to service_role;

create or replace function public.sync_career_knowledge_graph()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_node_count integer;
  v_edge_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    profile.user_id,
    'career_goal',
    'career_goal:primary',
    left(profile.career_goal, 240),
    profile.career_goal,
    jsonb_build_object(
      'country', profile.country,
      'experience_level', profile.experience_level
    ),
    'profile',
    profile.user_id::text,
    1,
    'user_verified',
    now(),
    now()
  from public.career_profiles profile
  where profile.user_id = v_user_id
    and nullif(trim(profile.career_goal), '') is not null
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    confidence = excluded.confidence,
    verification_status = excluded.verification_status,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    path.user_id,
    'career_path',
    'career_path:' || path.id::text,
    path.name,
    path.description,
    jsonb_build_object('target_role', path.target),
    'career_path',
    path.id::text,
    1,
    'user_verified',
    now(),
    now()
  from public.career_paths path
  where path.user_id = v_user_id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select distinct on (
    analysis.user_id,
    lower(regexp_replace(trim(finding->>'skill'), '[^a-zA-Z0-9]+', '-', 'g'))
  )
    analysis.user_id,
    'skill',
    'skill:' || lower(regexp_replace(trim(finding->>'skill'), '[^a-zA-Z0-9]+', '-', 'g')),
    finding->>'skill',
    coalesce(finding->>'explanation', ''),
    jsonb_build_object(
      'analysis_confidence', finding->>'confidence',
      'citations', coalesce(finding->'citations', '[]'::jsonb),
      'analysis_id', analysis.id
    ),
    'analysis',
    analysis.id::text,
    case finding->>'confidence'
      when 'strong' then 0.9
      when 'partial' then 0.75
      else 0.65
    end,
    'inferred',
    analysis.completed_at,
    now()
  from (
    select distinct on (candidate.user_id)
      candidate.id, candidate.user_id, candidate.findings, candidate.completed_at
    from public.career_analyses candidate
    where candidate.user_id = v_user_id and candidate.status = 'succeeded'
    order by candidate.user_id, candidate.completed_at desc
  ) analysis
  cross join lateral jsonb_array_elements(analysis.findings) finding
  where nullif(trim(finding->>'skill'), '') is not null
  order by
    analysis.user_id,
    lower(regexp_replace(trim(finding->>'skill'), '[^a-zA-Z0-9]+', '-', 'g')),
    case finding->>'confidence'
      when 'strong' then 3
      when 'partial' then 2
      else 1
    end desc
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = case
      when public.career_graph_nodes.description = '' then excluded.description
      else public.career_graph_nodes.description
    end,
    attributes = public.career_graph_nodes.attributes || excluded.attributes,
    confidence = greatest(public.career_graph_nodes.confidence, excluded.confidence),
    last_observed_at = greatest(public.career_graph_nodes.last_observed_at, excluded.last_observed_at),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select distinct on (
    path.user_id,
    lower(regexp_replace(trim(path.target), '[^a-zA-Z0-9]+', '-', 'g'))
  )
    path.user_id,
    'occupation',
    'occupation:' || lower(regexp_replace(trim(path.target), '[^a-zA-Z0-9]+', '-', 'g')),
    path.target,
    '',
    '{}'::jsonb,
    'career_path',
    path.id::text,
    0.95,
    'observed',
    now(),
    now()
  from public.career_paths path
  where path.user_id = v_user_id
    and nullif(trim(path.target), '') is not null
  order by
    path.user_id,
    lower(regexp_replace(trim(path.target), '[^a-zA-Z0-9]+', '-', 'g')),
    path.created_at desc
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    confidence = greatest(public.career_graph_nodes.confidence, excluded.confidence),
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    evidence.user_id,
    'skill',
    'skill:' || lower(regexp_replace(trim(evidence.skill), '[^a-zA-Z0-9]+', '-', 'g')),
    evidence.skill,
    '',
    jsonb_build_object('highest_evidence_confidence', evidence.confidence),
    'knowledge',
    evidence.id::text,
    least(1, evidence.confidence::numeric / 3),
    'observed',
    now(),
    now()
  from public.knowledge_evidence evidence
  where evidence.user_id = v_user_id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    attributes = public.career_graph_nodes.attributes || excluded.attributes,
    confidence = greatest(public.career_graph_nodes.confidence, excluded.confidence),
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    evidence.user_id,
    'evidence',
    'evidence:' || evidence.id::text,
    evidence.title,
    evidence.evidence,
    jsonb_build_object('skill', evidence.skill, 'confidence', evidence.confidence),
    'knowledge',
    evidence.id::text,
    least(1, evidence.confidence::numeric / 3),
    'user_verified',
    now(),
    now()
  from public.knowledge_evidence evidence
  where evidence.user_id = v_user_id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    confidence = excluded.confidence,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    job.user_id,
    'application',
    'application:' || job.id::text,
    job.title,
    job.description,
    jsonb_build_object(
      'path_id', job.path_id,
      'company', job.company,
      'location', job.location,
      'status', job.application_status,
      'employment_type', job.employment_type,
      'work_arrangement', job.work_arrangement,
      'salary_text', job.salary_text
    ),
    'job',
    job.id::text,
    1,
    'user_verified',
    now(),
    now()
  from public.job_descriptions job
  where job.user_id = v_user_id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select distinct on (
    job.user_id,
    lower(regexp_replace(trim(job.company), '[^a-zA-Z0-9]+', '-', 'g'))
  )
    job.user_id,
    'company',
    'company:' || lower(regexp_replace(trim(job.company), '[^a-zA-Z0-9]+', '-', 'g')),
    job.company,
    '',
    '{}'::jsonb,
    'job',
    job.id::text,
    0.95,
    'observed',
    now(),
    now()
  from public.job_descriptions job
  where job.user_id = v_user_id
    and nullif(trim(job.company), '') is not null
  order by
    job.user_id,
    lower(regexp_replace(trim(job.company), '[^a-zA-Z0-9]+', '-', 'g')),
    job.created_at desc
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    confidence = greatest(public.career_graph_nodes.confidence, excluded.confidence),
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    session.user_id,
    'interview_performance',
    'interview:' || session.id::text,
    session.title || case when session.company = '' then '' else ' at ' || session.company end,
    coalesce(session.assessment->>'summary', ''),
    jsonb_build_object(
      'status', session.status,
      'answered_count', session.answered_count,
      'earned_xp', session.earned_xp,
      'assessment_status', session.assessment_status,
      'score', session.assessment->'score'
    ),
    'interview',
    session.id::text,
    case when session.assessment_status = 'succeeded' then 1 else 0.7 end,
    'observed',
    now(),
    now()
  from public.interview_practice_sessions session
  where session.user_id = v_user_id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    confidence = excluded.confidence,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    item.user_id,
    'action_item',
    'action:' || item.id::text,
    item.title,
    item.description,
    jsonb_build_object(
      'skill', item.skill,
      'status', item.status,
      'priority', item.priority,
      'target_date', item.target_date
    ),
    'action_plan',
    item.id::text,
    1,
    'user_verified',
    now(),
    now()
  from public.action_plan_items item
  where item.user_id = v_user_id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    asset.user_id,
    case when asset.provider = 'github' then 'github_repository' else 'project' end,
    'portfolio:' || asset.id::text,
    asset.title,
    asset.description,
    jsonb_build_object(
      'provider', asset.provider,
      'url', asset.url,
      'technologies', asset.technologies,
      'visibility', asset.visibility,
      'overall_score', asset.analysis->'overall_score',
      'analysis_dimensions', asset.analysis->'dimensions',
      'analysed_at', asset.analysed_at
    ),
    case when asset.provider = 'github' then 'github' else 'portfolio' end,
    asset.id::text,
    case when asset.analysed_at is null then 0.6 else 0.9 end,
    case when asset.analysed_at is null then 'user_verified' else 'observed' end,
    now(),
    now()
  from public.portfolio_assets asset
  where asset.user_id = v_user_id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    confidence = excluded.confidence,
    verification_status = excluded.verification_status,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    asset.user_id,
    'project',
    'project:portfolio:' || asset.id::text,
    asset.title,
    asset.description,
    jsonb_build_object(
      'portfolio_asset_id', asset.id,
      'repository_url', asset.url,
      'technologies', asset.technologies,
      'overall_score', asset.analysis->'overall_score',
      'analysis_dimensions', asset.analysis->'dimensions'
    ),
    'portfolio',
    asset.id::text,
    case when asset.analysed_at is null then 0.6 else 0.9 end,
    case when asset.analysed_at is null then 'user_verified' else 'observed' end,
    now(),
    now()
  from public.portfolio_assets asset
  where asset.user_id = v_user_id
    and asset.provider = 'github'
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    confidence = excluded.confidence,
    verification_status = excluded.verification_status,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select distinct on (
    asset.user_id,
    lower(regexp_replace(trim(technology), '[^a-zA-Z0-9]+', '-', 'g'))
  )
    asset.user_id,
    'technology',
    'technology:' || lower(regexp_replace(trim(technology), '[^a-zA-Z0-9]+', '-', 'g')),
    technology,
    '',
    jsonb_build_object('portfolio_asset_id', asset.id),
    case when asset.provider = 'github' then 'github' else 'portfolio' end,
    asset.id::text,
    case when asset.analysed_at is null then 0.6 else 0.9 end,
    'observed',
    now(),
    now()
  from public.portfolio_assets asset
  cross join lateral unnest(asset.technologies) technology
  where asset.user_id = v_user_id and nullif(trim(technology), '') is not null
  order by
    asset.user_id,
    lower(regexp_replace(trim(technology), '[^a-zA-Z0-9]+', '-', 'g')),
    asset.analysed_at desc nulls last,
    asset.id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    attributes = public.career_graph_nodes.attributes || excluded.attributes,
    confidence = greatest(public.career_graph_nodes.confidence, excluded.confidence),
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select
    credential.user_id,
    'certification',
    'credential:' || credential.id::text,
    credential.name,
    credential.issuer,
    jsonb_build_object(
      'provider', credential.provider,
      'issuer', credential.issuer,
      'credential_url', credential.credential_url,
      'issued_on', credential.issued_on,
      'expires_on', credential.expires_on,
      'skills', credential.skills,
      'verification_status', credential.verification_status
    ),
    'credential',
    credential.id::text,
    case when credential.verification_status = 'verified' then 1 else 0.6 end,
    case when credential.verification_status = 'verified' then 'externally_verified' else 'user_verified' end,
    now(),
    now()
  from public.career_credentials credential
  where credential.user_id = v_user_id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    confidence = excluded.confidence,
    verification_status = excluded.verification_status,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select distinct on (
    credential.user_id,
    lower(regexp_replace(trim(skill), '[^a-zA-Z0-9]+', '-', 'g'))
  )
    credential.user_id,
    'skill',
    'skill:' || lower(regexp_replace(trim(skill), '[^a-zA-Z0-9]+', '-', 'g')),
    skill,
    '',
    jsonb_build_object('credential_id', credential.id),
    'credential',
    credential.id::text,
    case when credential.verification_status = 'verified' then 1 else 0.6 end,
    case when credential.verification_status = 'verified' then 'externally_verified' else 'observed' end,
    now(),
    now()
  from public.career_credentials credential
  cross join lateral unnest(credential.skills) skill
  where credential.user_id = v_user_id and nullif(trim(skill), '') is not null
  order by
    credential.user_id,
    lower(regexp_replace(trim(skill), '[^a-zA-Z0-9]+', '-', 'g')),
    case when credential.verification_status = 'verified' then 1 else 0 end desc,
    credential.id
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    attributes = public.career_graph_nodes.attributes || excluded.attributes,
    confidence = greatest(public.career_graph_nodes.confidence, excluded.confidence),
    verification_status = case
      when excluded.verification_status = 'externally_verified' then 'externally_verified'
      else public.career_graph_nodes.verification_status
    end,
    last_observed_at = now(),
    updated_at = now();

  with taxonomy_matches as (
    select
      graph.id as graph_id,
      taxonomy.id as taxonomy_id,
      taxonomy.description,
      taxonomy.taxonomy,
      taxonomy.external_id,
      taxonomy.metadata
    from public.career_graph_nodes graph
    cross join lateral (
      select candidate.*
      from public.career_taxonomy_nodes candidate
      where candidate.node_type = graph.node_type
        and (
          lower(candidate.preferred_label) = lower(graph.label)
          or exists (
            select 1 from unnest(candidate.aliases) alias
            where lower(alias) = lower(graph.label)
          )
        )
      order by case candidate.taxonomy when 'esco' then 0 when 'onet' then 1 else 2 end
      limit 1
    ) taxonomy
    where graph.user_id = v_user_id
      and graph.node_type in ('skill', 'occupation', 'technology', 'certification', 'course')
  )
  update public.career_graph_nodes graph
  set taxonomy_node_id = taxonomy.taxonomy_id,
      description = case when graph.description = '' then taxonomy.description else graph.description end,
      attributes = graph.attributes || jsonb_build_object(
        'taxonomy', taxonomy.taxonomy,
        'taxonomy_external_id', taxonomy.external_id,
        'taxonomy_source', taxonomy.metadata->>'source_url'
      ),
      updated_at = now()
  from taxonomy_matches taxonomy
  where graph.id = taxonomy.graph_id;

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select distinct on (asset.user_id, technology_node.id, portfolio_node.id)
    asset.user_id,
    technology_node.id,
    portfolio_node.id,
    'demonstrated_by',
    case when asset.analysed_at is null then 0.6 else 0.9 end,
    case when asset.analysed_at is null then 0.6 else 0.9 end,
    'The portfolio asset publicly reports this technology and retains its analysis evidence.',
    jsonb_build_array(jsonb_build_object('type', 'portfolio_asset', 'id', asset.id)),
    now()
  from public.portfolio_assets asset
  cross join lateral unnest(asset.technologies) technology
  join public.career_graph_nodes technology_node
    on technology_node.user_id = asset.user_id
   and technology_node.canonical_key =
     'technology:' || lower(regexp_replace(trim(technology), '[^a-zA-Z0-9]+', '-', 'g'))
  join public.career_graph_nodes portfolio_node
    on portfolio_node.user_id = asset.user_id
   and portfolio_node.canonical_key = 'portfolio:' || asset.id::text
  where asset.user_id = v_user_id
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    weight = excluded.weight,
    confidence = excluded.confidence,
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select
    asset.user_id,
    project_node.id,
    repository_node.id,
    'demonstrated_by',
    case when asset.analysed_at is null then 0.6 else 0.9 end,
    case when asset.analysed_at is null then 0.6 else 0.9 end,
    'This project is demonstrated by its linked public GitHub repository.',
    jsonb_build_array(jsonb_build_object('type', 'portfolio_asset', 'id', asset.id)),
    now()
  from public.portfolio_assets asset
  join public.career_graph_nodes project_node
    on project_node.user_id = asset.user_id
   and project_node.canonical_key = 'project:portfolio:' || asset.id::text
  join public.career_graph_nodes repository_node
    on repository_node.user_id = asset.user_id
   and repository_node.canonical_key = 'portfolio:' || asset.id::text
  where asset.user_id = v_user_id
    and asset.provider = 'github'
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    weight = excluded.weight,
    confidence = excluded.confidence,
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select distinct on (analysis.user_id, occupation_node.id, skill_node.id)
    analysis.user_id,
    occupation_node.id,
    skill_node.id,
    'requires',
    case finding->>'confidence' when 'missing' then 1 else 0.8 end,
    case finding->>'confidence' when 'strong' then 0.9 when 'partial' then 0.8 else 0.85 end,
    coalesce(finding->>'explanation', 'The latest career analysis links this skill to the target occupation.'),
    jsonb_build_array(jsonb_build_object(
      'type', 'career_analysis',
      'id', analysis.id,
      'citations', coalesce(finding->'citations', '[]'::jsonb)
    )),
    now()
  from (
    select distinct on (candidate.user_id)
      candidate.id, candidate.user_id, candidate.path_id, candidate.findings
    from public.career_analyses candidate
    where candidate.user_id = v_user_id and candidate.status = 'succeeded'
    order by candidate.user_id, candidate.completed_at desc
  ) analysis
  join public.career_paths path
    on path.id = analysis.path_id and path.user_id = analysis.user_id
  cross join lateral jsonb_array_elements(analysis.findings) finding
  join public.career_graph_nodes occupation_node
    on occupation_node.user_id = path.user_id
   and occupation_node.canonical_key =
     'occupation:' || lower(regexp_replace(trim(path.target), '[^a-zA-Z0-9]+', '-', 'g'))
  join public.career_graph_nodes skill_node
    on skill_node.user_id = analysis.user_id
   and skill_node.canonical_key =
     'skill:' || lower(regexp_replace(trim(finding->>'skill'), '[^a-zA-Z0-9]+', '-', 'g'))
  where nullif(trim(finding->>'skill'), '') is not null
  order by
    analysis.user_id,
    occupation_node.id,
    skill_node.id,
    case finding->>'confidence'
      when 'strong' then 3
      when 'partial' then 2
      else 1
    end desc
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    weight = excluded.weight,
    confidence = excluded.confidence,
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select
    credential.user_id,
    skill_node.id,
    credential_node.id,
    'validated_by',
    case when credential.verification_status = 'verified' then 1 else 0.6 end,
    case when credential.verification_status = 'verified' then 1 else 0.6 end,
    'The credential declares this skill; confidence reflects issuer verification status.',
    jsonb_build_array(jsonb_build_object('type', 'career_credential', 'id', credential.id)),
    now()
  from public.career_credentials credential
  cross join lateral unnest(credential.skills) skill
  join public.career_graph_nodes skill_node
    on skill_node.user_id = credential.user_id
   and skill_node.canonical_key =
     'skill:' || lower(regexp_replace(trim(skill), '[^a-zA-Z0-9]+', '-', 'g'))
  join public.career_graph_nodes credential_node
    on credential_node.user_id = credential.user_id
   and credential_node.canonical_key = 'credential:' || credential.id::text
  where credential.user_id = v_user_id
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    weight = excluded.weight,
    confidence = excluded.confidence,
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select
    path.user_id,
    path_node.id,
    occupation_node.id,
    'targets',
    1,
    1,
    'The user explicitly selected this occupation as the target of the career path.',
    jsonb_build_array(jsonb_build_object('type', 'career_path', 'id', path.id)),
    now()
  from public.career_paths path
  join public.career_graph_nodes path_node
    on path_node.user_id = path.user_id
   and path_node.canonical_key = 'career_path:' || path.id::text
  join public.career_graph_nodes occupation_node
    on occupation_node.user_id = path.user_id
   and occupation_node.canonical_key =
     'occupation:' || lower(regexp_replace(trim(path.target), '[^a-zA-Z0-9]+', '-', 'g'))
  where path.user_id = v_user_id
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select
    evidence.user_id,
    skill_node.id,
    evidence_node.id,
    'demonstrated_by',
    least(1, evidence.confidence::numeric / 3),
    least(1, evidence.confidence::numeric / 3),
    'The user supplied this evidence for the named skill.',
    jsonb_build_array(jsonb_build_object('type', 'knowledge_evidence', 'id', evidence.id)),
    now()
  from public.knowledge_evidence evidence
  join public.career_graph_nodes evidence_node
    on evidence_node.user_id = evidence.user_id
   and evidence_node.canonical_key = 'evidence:' || evidence.id::text
  join public.career_graph_nodes skill_node
    on skill_node.user_id = evidence.user_id
   and skill_node.canonical_key =
     'skill:' || lower(regexp_replace(trim(evidence.skill), '[^a-zA-Z0-9]+', '-', 'g'))
  where evidence.user_id = v_user_id
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    weight = excluded.weight,
    confidence = excluded.confidence,
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select
    job.user_id,
    application_node.id,
    company_node.id,
    'applied_to',
    1,
    1,
    'The saved application names this company.',
    jsonb_build_array(jsonb_build_object('type', 'job_description', 'id', job.id)),
    now()
  from public.job_descriptions job
  join public.career_graph_nodes application_node
    on application_node.user_id = job.user_id
   and application_node.canonical_key = 'application:' || job.id::text
  join public.career_graph_nodes company_node
    on company_node.user_id = job.user_id
   and company_node.canonical_key =
     'company:' || lower(regexp_replace(trim(job.company), '[^a-zA-Z0-9]+', '-', 'g'))
  where job.user_id = v_user_id
    and nullif(trim(job.company), '') is not null
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select
    job.user_id,
    path_node.id,
    application_node.id,
    'contains',
    1,
    1,
    'This application is tracked inside the selected career path.',
    jsonb_build_array(jsonb_build_object('type', 'job_description', 'id', job.id)),
    now()
  from public.job_descriptions job
  join public.career_graph_nodes application_node
    on application_node.user_id = job.user_id
   and application_node.canonical_key = 'application:' || job.id::text
  join public.career_graph_nodes path_node
    on path_node.user_id = job.user_id
   and path_node.canonical_key = 'career_path:' || job.path_id::text
  where job.user_id = v_user_id
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select
    session.user_id,
    interview_node.id,
    application_node.id,
    'performed_in',
    1,
    1,
    'This practice round was generated for the saved application.',
    jsonb_build_array(jsonb_build_object('type', 'interview_practice_session', 'id', session.id)),
    now()
  from public.interview_practice_sessions session
  join public.career_graph_nodes interview_node
    on interview_node.user_id = session.user_id
   and interview_node.canonical_key = 'interview:' || session.id::text
  join public.career_graph_nodes application_node
    on application_node.user_id = session.user_id
   and application_node.canonical_key = 'application:' || session.job_id::text
  where session.user_id = v_user_id
    and session.job_id is not null
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  insert into public.career_graph_nodes (
    user_id, node_type, canonical_key, label, description, attributes,
    source_type, source_id, confidence, verification_status, last_observed_at, updated_at
  )
  select distinct on (
    milestone.user_id,
    md5(coalesce(nullif(resource->>'url', ''), resource->>'title'))
  )
    milestone.user_id,
    'course',
    'course:' || md5(coalesce(nullif(resource->>'url', ''), resource->>'title')),
    left(resource->>'title', 240),
    'Learning resource connected to ' || milestone.title || '.',
    jsonb_build_object(
      'url', resource->>'url',
      'provider_type', resource->>'provider_type',
      'roadmap_id', milestone.roadmap_id,
      'milestone_id', milestone.id,
      'milestone_status', milestone.status
    ),
    'roadmap',
    milestone.id::text,
    case when milestone.status = 'completed' then 1 else 0.75 end,
    case when milestone.status = 'completed' then 'user_verified' else 'observed' end,
    now(),
    now()
  from public.learning_roadmap_milestones milestone
  cross join lateral jsonb_array_elements(milestone.resources) resource
  where milestone.user_id = v_user_id
    and nullif(trim(resource->>'title'), '') is not null
  order by
    milestone.user_id,
    md5(coalesce(nullif(resource->>'url', ''), resource->>'title')),
    milestone.updated_at desc
  on conflict (user_id, canonical_key) do update set
    label = excluded.label,
    description = excluded.description,
    attributes = excluded.attributes,
    confidence = excluded.confidence,
    verification_status = excluded.verification_status,
    last_observed_at = now(),
    updated_at = now();

  insert into public.career_graph_edges (
    user_id, from_node_id, to_node_id, relationship, weight, confidence,
    rationale, evidence_refs, updated_at
  )
  select distinct on (milestone.user_id, course_node.id, goal_node.id)
    milestone.user_id,
    course_node.id,
    goal_node.id,
    'supports',
    case when milestone.status = 'completed' then 1 else 0.7 end,
    case when milestone.status = 'completed' then 1 else 0.75 end,
    'This roadmap course supports the user’s stated career goal.',
    jsonb_build_array(
      jsonb_build_object('type', 'learning_roadmap', 'id', milestone.roadmap_id),
      jsonb_build_object('type', 'learning_roadmap_milestone', 'id', milestone.id)
    ),
    now()
  from public.learning_roadmap_milestones milestone
  cross join lateral jsonb_array_elements(milestone.resources) resource
  join public.career_graph_nodes course_node
    on course_node.user_id = milestone.user_id
   and course_node.canonical_key =
     'course:' || md5(coalesce(nullif(resource->>'url', ''), resource->>'title'))
  join public.career_graph_nodes goal_node
    on goal_node.user_id = milestone.user_id
   and goal_node.canonical_key = 'career_goal:primary'
  where milestone.user_id = v_user_id
    and nullif(trim(resource->>'title'), '') is not null
  order by
    milestone.user_id,
    course_node.id,
    goal_node.id,
    case when milestone.status = 'completed' then 1 else 0 end desc,
    milestone.updated_at desc
  on conflict (user_id, from_node_id, to_node_id, relationship) do update set
    weight = excluded.weight,
    confidence = excluded.confidence,
    rationale = excluded.rationale,
    evidence_refs = excluded.evidence_refs,
    updated_at = now();

  select count(*) into v_node_count
  from public.career_graph_nodes where user_id = v_user_id;

  select count(*) into v_edge_count
  from public.career_graph_edges where user_id = v_user_id;

  return jsonb_build_object(
    'nodes', v_node_count,
    'edges', v_edge_count,
    'synced_at', now()
  );
end;
$$;

revoke all on function public.sync_career_knowledge_graph() from public, anon;
grant execute on function public.sync_career_knowledge_graph() to authenticated;

create or replace function public.get_career_operating_system_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'twin', (
      select to_jsonb(twin) - 'user_id'
      from public.career_twins twin
      where twin.user_id = (select auth.uid())
    ),
    'graph', jsonb_build_object(
      'node_count', (
        select count(*) from public.career_graph_nodes node
        where node.user_id = (select auth.uid())
      ),
      'edge_count', (
        select count(*) from public.career_graph_edges edge
        where edge.user_id = (select auth.uid())
      ),
      'nodes_by_type', (
        select coalesce(jsonb_object_agg(grouped.node_type, grouped.node_count), '{}'::jsonb)
        from (
          select node.node_type, count(*) as node_count
          from public.career_graph_nodes node
          where node.user_id = (select auth.uid())
          group by node.node_type
        ) grouped
      )
    ),
    'recommendations', (
      select coalesce(jsonb_agg(
        to_jsonb(recommendation) - 'user_id'
        order by recommendation.confidence desc, recommendation.generated_at desc
      ), '[]'::jsonb)
      from public.career_recommendations recommendation
      where recommendation.user_id = (select auth.uid())
        and recommendation.state = 'active'
    )
  );
$$;

create table public.organization_programmes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 240),
  programme_type text not null check (
    programme_type in ('degree', 'bootcamp', 'workforce', 'placement', 'scholarship', 'apprenticeship', 'other')
  ),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'archived')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.organization_cohorts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  programme_id uuid references public.organization_programmes(id) on delete set null,
  name text not null check (char_length(name) between 2 and 240),
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('planned', 'active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.organization_cohort_members (
  cohort_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  external_reference text not null default '' check (char_length(external_reference) <= 240),
  status text not null default 'active' check (status in ('invited', 'active', 'completed', 'withdrawn')),
  joined_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cohort_id, user_id),
  foreign key (cohort_id, organization_id)
    references public.organization_cohorts(id, organization_id) on delete cascade,
  check ((status = 'completed') = (completed_at is not null))
);

create index organization_programmes_org_status_idx
  on public.organization_programmes(organization_id, status);
create index organization_cohorts_org_status_idx
  on public.organization_cohorts(organization_id, status);
create index organization_cohort_members_org_status_idx
  on public.organization_cohort_members(organization_id, status, user_id);

alter table public.organization_programmes enable row level security;
alter table public.organization_cohorts enable row level security;
alter table public.organization_cohort_members enable row level security;

create policy "organization staff read programmes"
  on public.organization_programmes for select to authenticated
  using ((select private.organization_has_role(
    organization_id, array['owner', 'admin', 'advisor', 'analyst']::text[]
  )));
create policy "organization administrators manage programmes"
  on public.organization_programmes for all to authenticated
  using ((select private.organization_has_role(organization_id, array['owner', 'admin']::text[])))
  with check ((select private.organization_has_role(organization_id, array['owner', 'admin']::text[])));
create policy "organization staff read cohorts"
  on public.organization_cohorts for select to authenticated
  using ((select private.organization_has_role(
    organization_id, array['owner', 'admin', 'advisor', 'analyst']::text[]
  )));
create policy "organization administrators manage cohorts"
  on public.organization_cohorts for all to authenticated
  using ((select private.organization_has_role(organization_id, array['owner', 'admin']::text[])))
  with check ((select private.organization_has_role(organization_id, array['owner', 'admin']::text[])));
create policy "users read their cohort memberships"
  on public.organization_cohort_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.organization_has_role(
      organization_id, array['owner', 'admin', 'advisor', 'analyst']::text[]
    ))
  );
create policy "organization administrators manage cohort memberships"
  on public.organization_cohort_members for all to authenticated
  using ((select private.organization_has_role(organization_id, array['owner', 'admin']::text[])))
  with check ((select private.organization_has_role(organization_id, array['owner', 'admin']::text[])));

revoke all on public.organization_programmes, public.organization_cohorts,
  public.organization_cohort_members from public, anon;
grant select, insert, update, delete on public.organization_programmes,
  public.organization_cohorts, public.organization_cohort_members to authenticated, service_role;

create or replace function public.get_organization_employability_dashboard(
  p_organization_id uuid,
  p_cohort_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization public.organizations%rowtype;
  v_consent_count integer;
  v_minimum_group_size constant integer := 5;
  v_dashboard jsonb;
begin
  if v_user_id is null or not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = v_user_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'advisor', 'analyst')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_cohort_id is not null and not exists (
    select 1 from public.organization_cohorts cohort
    where cohort.id = p_cohort_id and cohort.organization_id = p_organization_id
  ) then
    raise exception 'Cohort does not belong to organization' using errcode = '22023';
  end if;

  select * into v_organization
  from public.organizations where id = p_organization_id;

  with eligible as (
    select distinct member.user_id
    from public.organization_cohort_members member
    join public.organization_data_consents consent
      on consent.organization_id = member.organization_id
     and consent.user_id = member.user_id
     and consent.status = 'active'
     and 'cohort_analytics' = any(consent.scopes)
     and (consent.expires_at is null or consent.expires_at > now())
    where member.organization_id = p_organization_id
      and member.status in ('active', 'completed')
      and (p_cohort_id is null or member.cohort_id = p_cohort_id)
  )
  select count(*) into v_consent_count from eligible;

  if v_consent_count < v_minimum_group_size then
    return jsonb_build_object(
      'organization', jsonb_build_object(
        'id', v_organization.id,
        'name', v_organization.name,
        'type', v_organization.organization_type
      ),
      'cohort_id', p_cohort_id,
      'privacy', jsonb_build_object(
        'suppressed', true,
        'minimum_group_size', v_minimum_group_size,
        'consented_members', v_consent_count,
        'reason', 'Cohort analytics are hidden until at least five active participants consent.'
      )
    );
  end if;

  with eligible as (
    select distinct member.user_id
    from public.organization_cohort_members member
    join public.organization_data_consents consent
      on consent.organization_id = member.organization_id
     and consent.user_id = member.user_id
     and consent.status = 'active'
     and 'cohort_analytics' = any(consent.scopes)
     and (consent.expires_at is null or consent.expires_at > now())
    where member.organization_id = p_organization_id
      and member.status in ('active', 'completed')
      and (p_cohort_id is null or member.cohort_id = p_cohort_id)
  ),
  latest_readiness as (
    select distinct on (assessment.user_id)
      assessment.user_id, assessment.overall_score, assessment.categories
    from public.career_readiness_assessments assessment
    join eligible on eligible.user_id = assessment.user_id
    order by assessment.user_id, assessment.created_at desc
  ),
  path_distribution as (
    select path.target, count(distinct path.user_id) as users
    from public.career_paths path join eligible on eligible.user_id = path.user_id
    group by path.target order by users desc, path.target limit 12
  ),
  gap_distribution as (
    select gap->>'skill' as skill, count(distinct twin.user_id) as users
    from public.career_twins twin
    join eligible on eligible.user_id = twin.user_id
    cross join lateral jsonb_array_elements(twin.missing_competencies) gap
    where nullif(gap->>'skill', '') is not null
    group by gap->>'skill' order by users desc, skill limit 12
  ),
  engagement as (
    select
      count(*) filter (where action.status = 'completed') as completed_actions,
      count(*) as total_actions,
      count(distinct action.user_id) filter (
        where action.updated_at >= now() - interval '30 days'
      ) as active_users
    from public.action_plan_items action join eligible on eligible.user_id = action.user_id
  ),
  outcomes as (
    select
      count(*) filter (where job.application_status in ('applied', 'interviewing', 'offer', 'rejected')) as applications,
      count(*) filter (where job.application_status in ('interviewing', 'offer')) as interviews,
      count(*) filter (where job.application_status = 'offer') as offers,
      count(distinct job.user_id) filter (where job.application_status = 'offer') as placed_users
    from public.job_descriptions job join eligible on eligible.user_id = job.user_id
  ),
  credentials as (
    select
      count(*) as credentials,
      count(*) filter (where credential.verification_status = 'verified') as verified,
      count(distinct credential.user_id) filter (
        where credential.verification_status = 'verified'
      ) as learners_with_verified
    from public.career_credentials credential join eligible on eligible.user_id = credential.user_id
  )
  select jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_organization.id,
      'name', v_organization.name,
      'type', v_organization.organization_type
    ),
    'cohort_id', p_cohort_id,
    'privacy', jsonb_build_object(
      'suppressed', false,
      'minimum_group_size', v_minimum_group_size,
      'consented_members', v_consent_count
    ),
    'employability', jsonb_build_object(
      'assessed_members', (select count(*) from latest_readiness),
      'average_readiness', (select round(avg(overall_score), 1) from latest_readiness),
      'category_averages', (
        select coalesce(jsonb_object_agg(category.key, round(category.average_score, 1)), '{}'::jsonb)
        from (
          select item.key, avg((item.value->>'score')::numeric) as average_score
          from latest_readiness
          cross join lateral jsonb_each(latest_readiness.categories) item
          group by item.key
        ) category
      )
    ),
    'skill_gaps', (
      select coalesce(jsonb_agg(jsonb_build_object('skill', skill, 'learners', users)), '[]'::jsonb)
      from gap_distribution
    ),
    'career_paths', (
      select coalesce(jsonb_agg(jsonb_build_object('target', target, 'learners', users)), '[]'::jsonb)
      from path_distribution
    ),
    'engagement', (
      select jsonb_build_object(
        'active_users_30d', active_users,
        'completed_actions', completed_actions,
        'total_actions', total_actions,
        'completion_rate', case when total_actions > 0 then round(completed_actions::numeric / total_actions * 100, 1) end
      ) from engagement
    ),
    'placements', (
      select jsonb_build_object(
        'applications', applications,
        'interviews', interviews,
        'offers', offers,
        'placed_learners', placed_users,
        'offer_conversion', case when applications > 0 then round(offers::numeric / applications * 100, 1) end
      ) from outcomes
    ),
    'certifications', (
      select jsonb_build_object(
        'credentials', credentials,
        'verified', verified,
        'learners_with_verified', learners_with_verified
      ) from credentials
    ),
    'programme_effectiveness', jsonb_build_object(
      'readiness_coverage', (
        select round(count(*)::numeric / v_consent_count * 100, 1) from latest_readiness
      ),
      'placement_rate', (
        select round(placed_users::numeric / v_consent_count * 100, 1) from outcomes
      ),
      'limitations', 'Directional aggregate from consenting Orynta participants; it is not a population-level causal evaluation.'
    ),
    'generated_at', now()
  ) into v_dashboard;

  return v_dashboard;
end;
$$;

revoke all on function public.get_organization_employability_dashboard(uuid, uuid)
  from public, anon;
grant execute on function public.get_organization_employability_dashboard(uuid, uuid)
  to authenticated;

create table public.mentor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  mentor_type text not null check (
    mentor_type in ('alumni', 'industry_professional', 'recruiter', 'career_coach')
  ),
  headline text not null check (char_length(headline) between 2 and 240),
  biography text not null default '' check (char_length(biography) <= 4000),
  industries text[] not null default '{}'::text[],
  skills text[] not null default '{}'::text[],
  locations text[] not null default '{}'::text[],
  languages text[] not null default '{}'::text[],
  experience_levels text[] not null default '{}'::text[],
  accepting_mentees boolean not null default false,
  maximum_active_mentees integer not null default 3 check (maximum_active_mentees between 1 and 50),
  verification_status text not null default 'unverified' check (
    verification_status in ('unverified', 'verified', 'suspended')
  ),
  visibility text not null default 'private' check (visibility in ('private', 'network', 'public')),
  matching_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (accepting_mentees and visibility in ('network', 'public')) = (matching_consent_at is not null)
    or (not accepting_mentees and matching_consent_at is null)
  )
);

create table public.mentor_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mentor_user_id uuid not null references auth.users(id) on delete cascade,
  mentor_profile_id uuid not null references public.mentor_profiles(id) on delete cascade,
  score numeric not null check (score between 0 and 100),
  dimensions jsonb not null check (jsonb_typeof(dimensions) = 'object'),
  rationale jsonb not null check (jsonb_typeof(rationale) = 'object'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  status text not null default 'suggested' check (
    status in ('suggested', 'requested', 'connected', 'declined', 'dismissed', 'expired')
  ),
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, mentor_user_id),
  unique (id, user_id, mentor_user_id),
  check (user_id <> mentor_user_id)
);

create table public.mentorship_requests (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.mentor_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mentor_user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 20 and 2000),
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'declined', 'withdrawn', 'completed')
  ),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (match_id),
  foreign key (match_id, user_id, mentor_user_id)
    references public.mentor_matches(id, user_id, mentor_user_id) on delete cascade,
  check (user_id <> mentor_user_id),
  check ((status in ('accepted', 'declined')) = (responded_at is not null))
);

create index mentor_profiles_discovery_idx
  on public.mentor_profiles(accepting_mentees, verification_status, visibility);
create index mentor_matches_user_score_idx on public.mentor_matches(user_id, score desc);
create index mentor_matches_mentor_status_idx on public.mentor_matches(mentor_user_id, status);
create index mentorship_requests_participants_idx
  on public.mentorship_requests(user_id, mentor_user_id, status);

alter table public.mentor_profiles enable row level security;
alter table public.mentor_matches enable row level security;
alter table public.mentorship_requests enable row level security;

create policy "users manage their mentor profile"
  on public.mentor_profiles for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "active mentors are discoverable"
  on public.mentor_profiles for select to authenticated
  using (
    accepting_mentees
    and matching_consent_at is not null
    and verification_status <> 'suspended'
    and visibility in ('network', 'public')
  );
create policy "match participants read mentor matches"
  on public.mentor_matches for select to authenticated
  using ((select auth.uid()) in (user_id, mentor_user_id));
create policy "mentees manage suggested matches"
  on public.mentor_matches for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "mentees insert their mentor matches"
  on public.mentor_matches for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "mentees delete their mentor matches"
  on public.mentor_matches for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy "request participants read mentorship requests"
  on public.mentorship_requests for select to authenticated
  using ((select auth.uid()) in (user_id, mentor_user_id));
create policy "mentees create mentorship requests"
  on public.mentorship_requests for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "request participants update mentorship requests"
  on public.mentorship_requests for update to authenticated
  using ((select auth.uid()) in (user_id, mentor_user_id))
  with check ((select auth.uid()) in (user_id, mentor_user_id));

revoke all on public.mentor_profiles, public.mentor_matches,
  public.mentorship_requests from public, anon;
grant select, insert, update, delete on public.mentor_profiles to authenticated, service_role;
grant select, insert, update, delete on public.mentor_matches,
  public.mentorship_requests to authenticated;
grant select, insert, update, delete on public.mentor_matches,
  public.mentorship_requests to service_role;

create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique check (char_length(canonical_name) between 1 and 240),
  website_url text check (website_url is null or website_url ~ '^https://'),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  cities text[] not null default '{}'::text[],
  industries text[] not null default '{}'::text[],
  overview text not null default '' check (char_length(overview) <= 10000),
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array'),
  technologies jsonb not null default '[]'::jsonb check (jsonb_typeof(technologies) = 'array'),
  competitors jsonb not null default '[]'::jsonb check (jsonb_typeof(competitors) = 'array'),
  hiring_signals jsonb not null default '[]'::jsonb check (jsonb_typeof(hiring_signals) = 'array'),
  interview_expectations jsonb not null default '[]'::jsonb check (jsonb_typeof(interview_expectations) = 'array'),
  recent_news jsonb not null default '[]'::jsonb check (jsonb_typeof(recent_news) = 'array'),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  source_freshness_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_intelligence_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.job_descriptions(id) on delete cascade,
  company_profile_id uuid references public.company_profiles(id) on delete set null,
  company_name text not null check (char_length(company_name) between 1 and 240),
  overview jsonb not null check (jsonb_typeof(overview) = 'object'),
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array'),
  technologies jsonb not null default '[]'::jsonb check (jsonb_typeof(technologies) = 'array'),
  hiring_trends jsonb not null default '[]'::jsonb check (jsonb_typeof(hiring_trends) = 'array'),
  interview_expectations jsonb not null default '[]'::jsonb check (jsonb_typeof(interview_expectations) = 'array'),
  recent_news jsonb not null default '[]'::jsonb check (jsonb_typeof(recent_news) = 'array'),
  competitors jsonb not null default '[]'::jsonb check (jsonb_typeof(competitors) = 'array'),
  suggested_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggested_questions) = 'array'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  limitations text not null default '' check (char_length(limitations) <= 4000),
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create index company_profiles_country_status_idx on public.company_profiles(country_code, status);
create index company_briefs_user_updated_idx
  on public.company_intelligence_briefs(user_id, updated_at desc);

alter table public.company_profiles enable row level security;
alter table public.company_intelligence_briefs enable row level security;

create policy "published company profiles are readable"
  on public.company_profiles for select to authenticated
  using (status = 'published');
create policy "users manage their company briefs"
  on public.company_intelligence_briefs for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.company_profiles, public.company_intelligence_briefs from public, anon;
grant select on public.company_profiles to authenticated;
grant select, insert, update, delete on public.company_intelligence_briefs to authenticated;
grant select, insert, update, delete on public.company_profiles,
  public.company_intelligence_briefs to service_role;

create table public.interview_video_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.interview_practice_sessions(id) on delete cascade,
  question_index integer not null check (question_index between 0 and 20),
  duration_seconds integer not null check (duration_seconds between 3 and 180),
  transcript text not null check (char_length(transcript) between 1 and 8000),
  pace_words_per_minute numeric not null check (pace_words_per_minute between 0 and 500),
  filler_words jsonb not null check (jsonb_typeof(filler_words) = 'object'),
  frame_count integer not null check (frame_count between 1 and 8),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  model text not null check (char_length(model) between 1 and 120),
  privacy_version text not null default 'video-coach-v1' check (char_length(privacy_version) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, session_id, question_index)
);

create index interview_video_assessments_user_created_idx
  on public.interview_video_assessments(user_id, created_at desc);

alter table public.interview_video_assessments enable row level security;
create policy "users manage their video interview assessments"
  on public.interview_video_assessments for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.interview_video_assessments from public, anon;
grant select, insert, update, delete on public.interview_video_assessments
  to authenticated, service_role;

revoke all on function public.get_career_operating_system_snapshot() from public, anon;
grant execute on function public.get_career_operating_system_snapshot() to authenticated;

create table public.labour_market_observations (
  id uuid primary key default gen_random_uuid(),
  external_id text check (external_id is null or char_length(external_id) between 1 and 240),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  city text not null default '' check (char_length(city) <= 160),
  industry text not null default '' check (char_length(industry) <= 160),
  job_family text not null check (char_length(job_family) between 2 and 200),
  experience_level text not null default 'unspecified' check (
    experience_level in ('entry', 'junior', 'mid', 'senior', 'lead', 'executive', 'unspecified')
  ),
  signal_type text not null check (
    signal_type in (
      'skill_demand', 'salary', 'hiring_trend', 'industry_growth',
      'technology_adoption', 'certification_popularity', 'cost_of_living'
    )
  ),
  subject text not null check (char_length(subject) between 1 and 240),
  value_numeric numeric,
  value_unit text not null default '' check (char_length(value_unit) <= 80),
  range_low numeric,
  range_high numeric,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  sample_size integer check (sample_size is null or sample_size >= 0),
  observed_from date not null,
  observed_to date not null,
  source_name text not null check (char_length(source_name) between 2 and 240),
  source_url text not null check (source_url ~ '^https://'),
  methodology text not null default '' check (char_length(methodology) <= 4000),
  confidence numeric not null default 0.5 check (confidence between 0 and 1),
  status text not null default 'published' check (status in ('draft', 'published', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (observed_to >= observed_from),
  check (range_low is null or range_high is null or range_high >= range_low)
);

create unique index labour_market_source_record_idx
  on public.labour_market_observations(source_name, external_id);

create table public.mobility_destination_profiles (
  country_code text primary key check (country_code in ('DE', 'NL', 'SE', 'AE', 'SA', 'QA', 'JO', 'EG')),
  country_name text not null check (char_length(country_name) between 2 and 120),
  country_name_ar text not null check (char_length(country_name_ar) between 2 and 120),
  visa_considerations jsonb not null check (jsonb_typeof(visa_considerations) = 'object'),
  language_requirements jsonb not null check (jsonb_typeof(language_requirements) = 'object'),
  recommended_certifications text[] not null default '{}'::text[],
  official_sources jsonb not null check (jsonb_typeof(official_sources) = 'array'),
  reviewed_on date not null,
  status text not null default 'published' check (status in ('draft', 'published', 'retired')),
  updated_at timestamptz not null default now()
);

insert into public.mobility_destination_profiles (
  country_code, country_name, country_name_ar, visa_considerations,
  language_requirements, recommended_certifications, official_sources, reviewed_on
) values
(
  'DE', 'Germany', 'ألمانيا',
  '{"summary":"EU/EEA and Swiss citizens generally have different rights from third-country nationals. Third-country routes include skilled-worker permits, the EU Blue Card, and the Opportunity Card; eligibility depends on the person, qualification, role, and offer.","checkpoints":["Confirm the route for your citizenship and intended role.","Check qualification recognition for regulated professions.","Recheck current salary and language thresholds on the official portal before applying."],"not_legal_advice":true}',
  '{"workplace":"German is frequently valuable even when a role operates in English.","legal":"Some routes and regulated professions have route-specific language requirements; the skilled-worker visa and EU Blue Card do not have a general statutory German requirement.","recommended":"Check the exact route and profession rather than assuming one national threshold."}',
  array['Role-specific German language certification', 'Regulated-profession recognition where applicable'],
  '[{"title":"Make it in Germany — visa and residence","url":"https://www.make-it-in-germany.com/en/visa-residence"},{"title":"Make it in Germany — language knowledge","url":"https://www.make-it-in-germany.com/en/living-in-germany/learn-german/knowledge"}]',
  '2026-07-30'
),
(
  'NL', 'Netherlands', 'هولندا',
  '{"summary":"EEA and Swiss nationals may work without a work permit. Other nationals may require an employer-sponsored work/residence route such as the highly skilled migrant route.","checkpoints":["Confirm whether a TWV, GVVA, residence permit, or recognised-sponsor route applies.","Check current salary criteria with the IND.","Confirm whether the employer is an eligible recognised sponsor."],"not_legal_advice":true}',
  '{"workplace":"English is common in some international workplaces; Dutch materially expands the accessible labour market.","legal":"Language requirements depend on the immigration or integration route and are not represented as one universal work-visa threshold.","recommended":"Validate both employer expectations and any route-specific civic integration obligation."}',
  array['Role-relevant professional certification', 'Dutch language evidence where useful'],
  '[{"title":"Government.nl — permits for foreign workers","url":"https://www.government.nl/topics/foreign-citizens-working-in-the-netherlands/question-and-answer/what-permits-do-foreign-workers-need"},{"title":"Government.nl — highly skilled migrants","url":"https://www.government.nl/topics/foreign-citizens-working-in-the-netherlands/question-and-answer/how-can-i-hire-a-highly-skilled-migrant"}]',
  '2026-07-30'
),
(
  'SE', 'Sweden', 'السويد',
  '{"summary":"Non-EU/EEA citizens generally need a work permit and a signed employment agreement. Employment terms, insurance, and a current salary floor apply.","checkpoints":["Check the current salary requirement on the Swedish Migration Agency site.","Confirm employer insurance and employment-term requirements.","Review any occupation-specific restrictions and document requirements."],"not_legal_advice":true}',
  '{"workplace":"Many technical teams use English, while Swedish increases access and long-term mobility.","legal":"The general employee permit page does not set a universal Swedish-language test, but regulated roles can differ.","recommended":"Assess the target occupation and employer rather than relying on an English-only assumption."}',
  array['Role-relevant professional certification', 'Swedish language evidence where useful'],
  '[{"title":"Swedish Migration Agency — employee work permits","url":"https://www.migrationsverket.se/en/you-want-to-apply/work/employee-or-self-employed/employees.html"}]',
  '2026-07-30'
),
(
  'AE', 'United Arab Emirates', 'الإمارات العربية المتحدة',
  '{"summary":"Most expatriates require a work permit and residence status. Standard employment routes are employer-led; qualification attestation and medical screening may apply.","checkpoints":["Never work on a visit or tourist visa.","Confirm the permit and residence route with the employer and relevant emirate authority.","Check whether qualifications must be attested for the occupation."],"not_legal_advice":true}',
  '{"workplace":"English is widely used in many private-sector roles; Arabic improves local-market reach.","legal":"No universal language test is represented here; profession and employer requirements vary.","recommended":"Check the vacancy, licensing body, and employment contract language."}',
  array['Attested role qualification where required', 'Locally required professional licence where applicable'],
  '[{"title":"UAE Government — preparing to work","url":"https://u.ae/en/information-and-services/jobs/employment-in-the-private-sector/preparing-to-work"},{"title":"UAE Government — work permits","url":"https://u.ae/en/information-and-services/jobs/employment-in-the-private-sector/job-offers-and-work-permits-and-contracts/work-permits"}]',
  '2026-07-30'
),
(
  'SA', 'Saudi Arabia', 'المملكة العربية السعودية',
  '{"summary":"Non-Saudi workers require ministry approval, a work permit, and a written fixed-term employer contract. Occupation restrictions, localisation rules, and professional verification can apply.","checkpoints":["Confirm the occupation is open to non-Saudi workers.","Check employer sponsorship, contract, and permit responsibilities.","Verify whether professional accreditation applies to the role."],"not_legal_advice":true}',
  '{"workplace":"Arabic expands access; English is used in many international and technical environments.","legal":"No single language threshold is represented because requirements vary by role and employer.","recommended":"Check professional classification and role-specific licensing."}',
  array['Saudi professional verification where applicable', 'Role-specific professional accreditation'],
  '[{"title":"HRSD — employment of non-Saudis","url":"https://www.hrsd.gov.sa/en/%D8%AA%D9%88%D8%B8%D9%8A%D9%81-%D8%BA%D9%8A%D8%B1-%D8%A7%D9%84%D8%B3%D8%B9%D9%88%D8%AF%D9%8A%D9%8A%D9%86"},{"title":"HRSD — professional verification","url":"https://www.hrsd.gov.sa/en/care-about-you/skillsandtrain"}]',
  '2026-07-30'
),
(
  'QA', 'Qatar', 'قطر',
  '{"summary":"Newcomers generally need a Qatari employer for a work residence permit. Employer-arranged entry, residence conversion, attested qualifications, police clearance, contract, and medical checks may apply.","checkpoints":["Confirm the employer sponsorship and work-residence route.","Prepare attested qualifications and other documents when required.","Verify current procedures and fees with the Ministry of Interior."],"not_legal_advice":true}',
  '{"workplace":"English is common in many international roles; Arabic expands local-market access.","legal":"No universal language threshold is represented here.","recommended":"Check employer and regulated-profession requirements."}',
  array['Attested role qualification where required', 'Locally required professional licence where applicable'],
  '[{"title":"Qatar Government — residence and work permits","url":"https://portal.www.gov.qa/wps/portal/topics/Visas+and+Official+Documents/Residence+and+Work+Permits"},{"title":"Qatar Ministry of Interior — work visa on company sponsorship","url":"https://portal.moi.gov.qa/wps/portal/MOIInternet/services/inquiries/visaservices"}]',
  '2026-07-30'
),
(
  'JO', 'Jordan', 'الأردن',
  '{"summary":"Non-Jordanian workers require a work permit under occupation- and sector-specific rules. Specialist-skilled routes and restricted occupations must be checked against the current Ministry guide.","checkpoints":["Check whether the profession and sector are open to non-Jordanians.","Use the current Ministry work-permit guide.","Confirm employer, document, and renewal requirements."],"not_legal_advice":true}',
  '{"workplace":"Arabic materially broadens access; English is used in some international and technical organisations.","legal":"No universal language threshold is represented here.","recommended":"Check the specific profession and employer."}',
  array['Role-specific professional recognition where applicable', 'Arabic language evidence where useful'],
  '[{"title":"Jordan Ministry of Labour — non-Jordanian workers","url":"https://mol.gov.jo/EN/Pages/NonJordanian_workers"}]',
  '2026-07-30'
),
(
  'EG', 'Egypt', 'مصر',
  '{"summary":"Employers seeking to hire foreign workers use Ministry of Labour work-permit procedures. Experience evidence, translated and authenticated documents, professional-body approval, and security approval can apply.","checkpoints":["Confirm the employer-led foreign-worker permit route.","Check profession-specific syndicate or licensing approval.","Verify current documentation, security, and renewal requirements."],"not_legal_advice":true}',
  '{"workplace":"Arabic materially broadens access; English is used in many international and technical organisations.","legal":"No universal language threshold is represented here.","recommended":"Check the profession, employer, and licensing body."}',
  array['Role-specific syndicate or professional approval where applicable', 'Authenticated experience evidence where required'],
  '[{"title":"Egypt Ministry of Labour — foreign work permits","url":"https://www.labour.gov.eg/en/services-1/business-owners-services/employment-and-labor-market-information/"}]',
  '2026-07-30'
);

update public.mobility_destination_profiles
set
  visa_considerations = visa_considerations || jsonb_build_object(
    'summary_ar',
    case country_code
      when 'DE' then 'تختلف حقوق مواطني الاتحاد الأوروبي والمنطقة الاقتصادية الأوروبية وسويسرا عن مواطني الدول الأخرى. تشمل المسارات المتاحة للعمالة الماهرة البطاقة الزرقاء للاتحاد الأوروبي وبطاقة الفرص، وتعتمد الأهلية على الشخص والمؤهل والمهنة وعرض العمل.'
      when 'NL' then 'يمكن لمواطني المنطقة الاقتصادية الأوروبية وسويسرا العمل عادةً دون تصريح، بينما قد يحتاج الآخرون إلى مسار عمل وإقامة برعاية صاحب عمل مثل مسار المهاجر عالي المهارة.'
      when 'SE' then 'يحتاج معظم المواطنين من خارج الاتحاد الأوروبي والمنطقة الاقتصادية الأوروبية إلى تصريح عمل وعقد توظيف موقع، مع متطلبات حالية للأجر وشروط العمل والتأمين.'
      when 'AE' then 'يحتاج معظم الوافدين إلى تصريح عمل وإقامة، وغالباً ما يقود صاحب العمل إجراءات المسار العادي، وقد يلزم تصديق المؤهلات والفحص الطبي.'
      when 'SA' then 'يحتاج العامل غير السعودي إلى موافقة الوزارة وتصريح عمل وعقد مكتوب محدد المدة، وقد تنطبق قيود المهن ومتطلبات التوطين والتحقق المهني.'
      when 'QA' then 'يحتاج القادمون للعمل عادةً إلى صاحب عمل قطري وتصريح إقامة للعمل، وقد تلزم مؤهلات مصدقة وشهادة حسن سيرة وعقد وفحوص طبية.'
      when 'JO' then 'يحتاج العامل غير الأردني إلى تصريح عمل وفق قواعد خاصة بالمهنة والقطاع، ويجب مراجعة المهن المقيدة ومسار أصحاب المهارات المتخصصة.'
      when 'EG' then 'تتبع جهة العمل إجراءات وزارة العمل لتصريح عمل الأجانب، وقد يلزم إثبات خبرة ووثائق مترجمة ومصدقة وموافقة الجهة المهنية والأمنية.'
    end
  ),
  language_requirements = language_requirements || jsonb_build_object(
    'workplace_ar',
    case country_code
      when 'DE' then 'تفيد اللغة الألمانية في توسيع فرص العمل حتى عندما تكون لغة الفريق الإنجليزية.'
      when 'NL' then 'تُستخدم الإنجليزية في بعض بيئات العمل الدولية، لكن الهولندية توسّع سوق الوظائف المتاح.'
      when 'SE' then 'تستخدم فرق تقنية عديدة الإنجليزية، بينما توسّع السويدية فرص العمل والتنقل طويل المدى.'
      when 'AE' then 'تُستخدم الإنجليزية على نطاق واسع في وظائف القطاع الخاص، وتزيد العربية من الوصول إلى السوق المحلي.'
      when 'SA' then 'تزيد العربية من الوصول إلى السوق، وتُستخدم الإنجليزية في بيئات دولية وتقنية عديدة.'
      when 'QA' then 'تُستخدم الإنجليزية في وظائف دولية عديدة، وتزيد العربية من الوصول إلى السوق المحلي.'
      when 'JO' then 'توسّع العربية فرص الوصول، وتُستخدم الإنجليزية في بعض المؤسسات الدولية والتقنية.'
      when 'EG' then 'توسّع العربية فرص الوصول، وتُستخدم الإنجليزية في مؤسسات دولية وتقنية عديدة.'
    end,
    'legal_ar', 'لا يُفترض وجود شرط لغوي وطني موحد؛ تحقّق من مسار الهجرة والمهنة المنظمة وصاحب العمل.',
    'recommended_ar', 'راجِع متطلبات المسار والمهنة والوظيفة المحددة قبل اتخاذ القرار.'
  );

alter table public.mobility_destination_profiles enable row level security;
create policy "Published mobility profiles are readable"
  on public.mobility_destination_profiles for select to authenticated
  using (status = 'published');
revoke all on public.mobility_destination_profiles from public, anon;
grant select on public.mobility_destination_profiles to authenticated;
grant select, insert, update, delete on public.mobility_destination_profiles to service_role;

create table public.portfolio_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('github', 'gitlab', 'portfolio', 'upload', 'other')),
  external_id text not null default '' check (char_length(external_id) <= 500),
  title text not null check (char_length(title) between 1 and 240),
  url text check (url is null or url ~ '^https://'),
  description text not null default '' check (char_length(description) <= 10000),
  technologies text[] not null default '{}'::text[],
  visibility text not null default 'private' check (visibility in ('private', 'public', 'unlisted')),
  analysis jsonb not null default '{}'::jsonb check (jsonb_typeof(analysis) = 'object'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  analysed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_id)
);

create table public.career_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (
    provider in ('credly', 'microsoft_learn', 'aws', 'google_cloud', 'cisco', 'azure', 'open_badges', 'manual')
  ),
  external_id text not null default '' check (char_length(external_id) <= 500),
  name text not null check (char_length(name) between 1 and 300),
  issuer text not null check (char_length(issuer) between 1 and 240),
  credential_url text check (credential_url is null or credential_url ~ '^https://'),
  issued_on date,
  expires_on date,
  verification_status text not null default 'unverified' check (
    verification_status in ('unverified', 'issuer_observed', 'verified', 'expired', 'revoked')
  ),
  skills text[] not null default '{}'::text[],
  verification jsonb not null default '{}'::jsonb check (jsonb_typeof(verification) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_id),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

create table public.career_readiness_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  twin_id uuid references public.career_twins(id) on delete set null,
  overall_score numeric not null check (overall_score between 0 and 100),
  categories jsonb not null check (jsonb_typeof(categories) = 'object'),
  recommendations jsonb not null default '[]'::jsonb check (jsonb_typeof(recommendations) = 'array'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  methodology_version text not null check (char_length(methodology_version) between 1 and 40),
  limitations text not null default '' check (char_length(limitations) <= 4000),
  created_at timestamptz not null default now()
);

create table public.career_simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  twin_id uuid references public.career_twins(id) on delete set null,
  scenario_type text not null check (
    scenario_type in ('skill', 'certification', 'mobility', 'learning_period', 'projects')
  ),
  scenario jsonb not null check (jsonb_typeof(scenario) = 'object'),
  baseline jsonb not null check (jsonb_typeof(baseline) = 'object'),
  projection jsonb not null check (jsonb_typeof(projection) = 'object'),
  roadmap jsonb not null default '[]'::jsonb check (jsonb_typeof(roadmap) = 'array'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  assumptions jsonb not null default '[]'::jsonb check (jsonb_typeof(assumptions) = 'array'),
  confidence numeric not null check (confidence between 0 and 1),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  model text not null default 'deterministic-v1' check (char_length(model) <= 120),
  created_at timestamptz not null default now(),
  unique (user_id, request_fingerprint)
);

create table public.learning_roadmaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  simulation_id uuid references public.career_simulations(id) on delete set null,
  title text not null check (char_length(title) between 1 and 300),
  title_ar text not null default '' check (char_length(title_ar) <= 300),
  goal text not null check (char_length(goal) between 1 and 2000),
  goal_ar text not null default '' check (char_length(goal_ar) <= 2000),
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'archived')),
  weekly_hours numeric not null check (weekly_hours > 0 and weekly_hours <= 80),
  forecast_completion date,
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.learning_roadmap_milestones (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  title text not null check (char_length(title) between 1 and 300),
  title_ar text not null default '' check (char_length(title_ar) <= 300),
  milestone_type text not null check (
    milestone_type in ('learn', 'project', 'certification', 'verification', 'application')
  ),
  estimated_hours numeric not null check (estimated_hours > 0 and estimated_hours <= 1000),
  status text not null default 'not_started' check (
    status in ('not_started', 'in_progress', 'completed', 'skipped')
  ),
  due_on date,
  resources jsonb not null default '[]'::jsonb check (jsonb_typeof(resources) = 'array'),
  verification_criteria text not null default '' check (char_length(verification_criteria) <= 4000),
  verification_criteria_ar text not null default '' check (char_length(verification_criteria_ar) <= 4000),
  impact jsonb not null default '{}'::jsonb check (jsonb_typeof(impact) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roadmap_id, sequence),
  foreign key (roadmap_id, user_id)
    references public.learning_roadmaps(id, user_id) on delete cascade,
  check ((status = 'completed') = (completed_at is not null))
);

create index labour_market_dimensions_idx on public.labour_market_observations(
  country_code, city, industry, job_family, experience_level, signal_type
);
create index career_simulations_user_created_idx on public.career_simulations(user_id, created_at desc);
create index career_readiness_user_created_idx on public.career_readiness_assessments(user_id, created_at desc);
create index portfolio_assets_user_updated_idx on public.portfolio_assets(user_id, updated_at desc);
create index career_credentials_user_updated_idx on public.career_credentials(user_id, updated_at desc);
create index learning_roadmaps_user_updated_idx on public.learning_roadmaps(user_id, updated_at desc);

alter table public.labour_market_observations enable row level security;
alter table public.portfolio_assets enable row level security;
alter table public.career_credentials enable row level security;
alter table public.career_readiness_assessments enable row level security;
alter table public.career_simulations enable row level security;
alter table public.learning_roadmaps enable row level security;
alter table public.learning_roadmap_milestones enable row level security;

create policy "Published labour market observations are readable"
  on public.labour_market_observations for select to authenticated
  using (status = 'published');
create policy "Users manage their portfolio assets"
  on public.portfolio_assets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage their credentials"
  on public.career_credentials for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users read their readiness assessments"
  on public.career_readiness_assessments for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users create their readiness assessments"
  on public.career_readiness_assessments for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users delete their readiness assessments"
  on public.career_readiness_assessments for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users manage their simulations"
  on public.career_simulations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage their learning roadmaps"
  on public.learning_roadmaps for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage their roadmap milestones"
  on public.learning_roadmap_milestones for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.set_learning_milestone_status(
  p_milestone_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.learning_roadmap_milestones%rowtype;
  roadmap public.learning_roadmaps%rowtype;
  remaining_hours numeric;
  unfinished_count integer;
  total_count integer;
  completed_count integer;
begin
  if p_status not in ('not_started', 'in_progress', 'completed', 'skipped') then
    raise exception 'Invalid milestone status';
  end if;

  update public.learning_roadmap_milestones
  set status = p_status,
      completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
      updated_at = now()
  where id = p_milestone_id
    and user_id = (select auth.uid())
  returning * into target;

  if target.id is null then raise exception 'Milestone not found'; end if;

  select
    coalesce(sum(estimated_hours) filter (where status not in ('completed', 'skipped')), 0),
    count(*) filter (where status not in ('completed', 'skipped')),
    count(*),
    count(*) filter (where status = 'completed')
  into remaining_hours, unfinished_count, total_count, completed_count
  from public.learning_roadmap_milestones
  where roadmap_id = target.roadmap_id
    and user_id = (select auth.uid());

  update public.learning_roadmaps
  set status = case when unfinished_count = 0 then 'completed' else 'active' end,
      forecast_completion = case
        when unfinished_count = 0 then current_date
        else current_date + (ceil(remaining_hours / weekly_hours)::integer * 7)
      end,
      updated_at = now()
  where id = target.roadmap_id
    and user_id = (select auth.uid())
  returning * into roadmap;

  return (to_jsonb(roadmap) - 'user_id') || jsonb_build_object(
    'progress_percent', case when total_count = 0 then 0 else round(completed_count::numeric * 100 / total_count) end,
    'remaining_hours', remaining_hours,
    'salary_projection', (
      select simulation.projection -> 'salary'
      from public.career_simulations simulation
      where simulation.id = roadmap.simulation_id
        and simulation.user_id = (select auth.uid())
    ),
    'milestones', (
      select coalesce(jsonb_agg(to_jsonb(milestone) - 'user_id' order by milestone.sequence), '[]'::jsonb)
      from public.learning_roadmap_milestones milestone
      where milestone.roadmap_id = target.roadmap_id
        and milestone.user_id = (select auth.uid())
    )
  );
end;
$$;

revoke all on public.labour_market_observations, public.portfolio_assets,
  public.career_credentials, public.career_readiness_assessments,
  public.career_simulations, public.learning_roadmaps,
  public.learning_roadmap_milestones from public, anon;
grant select on public.labour_market_observations to authenticated;
grant select, delete on public.portfolio_assets, public.career_credentials to authenticated;
grant insert (user_id, provider, external_id, title, url, description, technologies, visibility)
  on public.portfolio_assets to authenticated;
grant insert (user_id, provider, external_id, name, issuer, credential_url, issued_on, expires_on, skills)
  on public.career_credentials to authenticated;
grant select, insert, update, delete on public.career_simulations, public.learning_roadmaps,
  public.learning_roadmap_milestones to authenticated;
grant select, insert, delete on public.career_readiness_assessments to authenticated;
grant select, insert, update, delete on public.labour_market_observations,
  public.portfolio_assets, public.career_credentials, public.career_readiness_assessments,
  public.career_simulations, public.learning_roadmaps,
  public.learning_roadmap_milestones to service_role;
revoke all on function public.set_learning_milestone_status(uuid, text) from public, anon;
grant execute on function public.set_learning_milestone_status(uuid, text) to authenticated;

create or replace function public.get_career_operating_system_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'twin', (
      select to_jsonb(twin) - 'user_id'
      from public.career_twins twin
      where twin.user_id = (select auth.uid())
    ),
    'graph', jsonb_build_object(
      'node_count', (
        select count(*) from public.career_graph_nodes node
        where node.user_id = (select auth.uid())
      ),
      'edge_count', (
        select count(*) from public.career_graph_edges edge
        where edge.user_id = (select auth.uid())
      ),
      'nodes_by_type', (
        select coalesce(jsonb_object_agg(grouped.node_type, grouped.node_count), '{}'::jsonb)
        from (
          select node.node_type, count(*) as node_count
          from public.career_graph_nodes node
          where node.user_id = (select auth.uid())
          group by node.node_type
        ) grouped
      )
    ),
    'recommendations', (
      select coalesce(jsonb_agg(
        to_jsonb(recommendation) - 'user_id'
        order by recommendation.confidence desc, recommendation.generated_at desc
      ), '[]'::jsonb)
      from public.career_recommendations recommendation
      where recommendation.user_id = (select auth.uid())
        and recommendation.state = 'active'
    ),
    'readiness', (
      select to_jsonb(readiness) - 'user_id'
      from public.career_readiness_assessments readiness
      where readiness.user_id = (select auth.uid())
      order by readiness.created_at desc
      limit 1
    ),
    'simulations', (
      select coalesce(jsonb_agg(
        to_jsonb(simulation) - 'user_id'
        order by simulation.created_at desc
      ), '[]'::jsonb)
      from (
        select * from public.career_simulations
        where user_id = (select auth.uid())
        order by created_at desc
        limit 10
      ) simulation
    ),
    'roadmaps', (
      select coalesce(jsonb_agg(
        (to_jsonb(roadmap) - 'user_id') || jsonb_build_object(
          'milestones', (
            select coalesce(jsonb_agg(to_jsonb(milestone) - 'user_id' order by milestone.sequence), '[]'::jsonb)
            from public.learning_roadmap_milestones milestone
            where milestone.roadmap_id = roadmap.id
              and milestone.user_id = (select auth.uid())
          ),
          'progress_percent', (
            select coalesce(round(
              count(*) filter (where milestone.status = 'completed')::numeric * 100 /
              nullif(count(*), 0)
            ), 0)
            from public.learning_roadmap_milestones milestone
            where milestone.roadmap_id = roadmap.id
              and milestone.user_id = (select auth.uid())
          ),
          'salary_projection', (
            select simulation.projection -> 'salary'
            from public.career_simulations simulation
            where simulation.id = roadmap.simulation_id
              and simulation.user_id = (select auth.uid())
          )
        )
        order by roadmap.updated_at desc
      ), '[]'::jsonb)
      from public.learning_roadmaps roadmap
      where roadmap.user_id = (select auth.uid()) and roadmap.status in ('draft', 'active')
    ),
    'portfolio', jsonb_build_object(
      'asset_count', (select count(*) from public.portfolio_assets asset where asset.user_id = (select auth.uid())),
      'credential_count', (select count(*) from public.career_credentials credential where credential.user_id = (select auth.uid())),
      'verified_credentials', (
        select count(*) from public.career_credentials credential
        where credential.user_id = (select auth.uid()) and credential.verification_status = 'verified'
      )
    )
  );
$$;
