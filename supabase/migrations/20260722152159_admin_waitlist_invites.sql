alter table public.waitlist_signups
  add column invite_started_at timestamptz,
  add column invited_at timestamptz,
  add column invited_user_id uuid references auth.users(id) on delete set null,
  add column invite_error_code text,
  add constraint waitlist_signups_invite_error_code_check
    check (invite_error_code is null or invite_error_code in ('INVITE_FAILED', 'INVITE_RATE_LIMITED', 'USER_EXISTS'));

create index waitlist_signups_created_idx
  on public.waitlist_signups (created_at desc);

create or replace function public.admin_analytics_waitlist(
  p_from timestamptz,
  p_to timestamptz,
  p_search text default '',
  p_status text default '',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  display_name text,
  source text,
  consented_at timestamptz,
  created_at timestamptz,
  status text,
  invited_at timestamptz,
  joined_at timestamptz,
  invite_error_code text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with directory as (
    select
      w.id,
      w.email,
      w.display_name,
      w.source,
      w.consented_at,
      w.created_at,
      case
        when u.confirmed_at is not null then 'joined'
        when w.invited_at is not null then 'invited'
        when u.id is not null then 'invited'
        when w.invite_error_code is not null then 'failed'
        when w.invite_started_at >= now() - interval '10 minutes' then 'sending'
        else 'pending'
      end::text as status,
      w.invited_at,
      coalesce(u.last_sign_in_at, u.confirmed_at) as joined_at,
      w.invite_error_code
    from public.waitlist_signups w
    left join auth.users u on lower(u.email) = lower(w.email)
    where w.created_at >= p_from and w.created_at < p_to
  ), filtered as (
    select * from directory d
    where (coalesce(p_search, '') = '' or d.email ilike '%' || p_search || '%' or d.display_name ilike '%' || p_search || '%')
      and (coalesce(p_status, '') = '' or d.status = p_status)
  )
  select f.*, count(*) over () as total_count
  from filtered f
  order by f.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

create or replace function public.admin_claim_waitlist_invite(p_id uuid)
returns table (signup_id uuid, email text, display_name text)
language sql
security definer
set search_path = ''
as $$
  update public.waitlist_signups w
  set invite_started_at = now(), invite_error_code = null
  where w.id = p_id
    and w.invited_at is null
    and not exists (select 1 from auth.users u where lower(u.email) = lower(w.email))
    and (
      w.invite_started_at is null
      or w.invite_error_code is not null
      or w.invite_started_at < now() - interval '10 minutes'
    )
  returning w.id, w.email, w.display_name;
$$;

create or replace function public.admin_complete_waitlist_invite(
  p_id uuid,
  p_user_id uuid default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if (p_user_id is null) = (p_error_code is null) then
    raise exception 'Provide exactly one invite outcome' using errcode = '22023';
  end if;
  if p_error_code is not null and p_error_code not in ('INVITE_FAILED', 'INVITE_RATE_LIMITED', 'USER_EXISTS') then
    raise exception 'Invalid invite error code' using errcode = '22023';
  end if;

  update public.waitlist_signups
  set invited_at = case when p_user_id is not null then now() else null end,
      invited_user_id = p_user_id,
      invite_error_code = p_error_code
  where id = p_id and invite_started_at is not null;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.admin_analytics_waitlist(timestamptz, timestamptz, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_claim_waitlist_invite(uuid) from public, anon, authenticated;
revoke all on function public.admin_complete_waitlist_invite(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_analytics_waitlist(timestamptz, timestamptz, text, text, integer, integer) to service_role;
grant execute on function public.admin_claim_waitlist_invite(uuid) to service_role;
grant execute on function public.admin_complete_waitlist_invite(uuid, uuid, text) to service_role;
