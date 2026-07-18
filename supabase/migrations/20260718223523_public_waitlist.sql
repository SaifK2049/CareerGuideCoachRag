create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null default '',
  source text not null default 'website',
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint waitlist_signups_email_length check (char_length(email) between 3 and 320),
  constraint waitlist_signups_name_length check (char_length(display_name) <= 120)
);

create unique index waitlist_signups_email_unique
  on public.waitlist_signups (lower(email));

alter table public.waitlist_signups enable row level security;

revoke all on table public.waitlist_signups from anon, authenticated;
grant all on table public.waitlist_signups to service_role;

comment on table public.waitlist_signups is
  'Private pre-launch interest list. Public submissions are accepted only through the Turnstile-verified Edge Function.';
