-- ============================================================
-- Legacy hosted DBs: `CREATE TABLE IF NOT EXISTS` in the
-- foundation migration does not add columns when `registrations`
-- already existed from an older layout. PostgREST then errors
-- (e.g. missing amount_paid_cents). This migration adds any Phase 1
-- columns that are still absent. Defaults only apply to existing rows
-- when the column is created; review and backfill real data if needed.
-- ============================================================

alter table public.registrations
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists pledge_code text not null default upper(replace(gen_random_uuid()::text, '-', '')),
  add column if not exists first_name text not null default 'Unknown',
  add column if not exists last_name text not null default 'Unknown',
  add column if not exists email text not null default 'legacy@placeholder.invalid',
  add column if not exists email_normalized text not null default 'legacy@placeholder.invalid',
  add column if not exists phone text,
  add column if not exists church text,
  add column if not exists city text,
  add column if not exists tier text not null default 'regular',
  add column if not exists total_cents bigint not null default 0,
  add column if not exists amount_paid_cents bigint not null default 0,
  add column if not exists status text not null default 'pending',
  add column if not exists attendees_json jsonb not null default '[]'::jsonb,
  add column if not exists lookup_token_version integer not null default 1,
  add column if not exists last_reminder_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists registrations_pledge_code_key
  on public.registrations (pledge_code);

create index if not exists registrations_email_normalized_idx
  on public.registrations (email_normalized);

create index if not exists registrations_status_idx
  on public.registrations (status);

create index if not exists registrations_last_reminder_at_idx
  on public.registrations (last_reminder_at);

drop trigger if exists registrations_set_updated_at on public.registrations;

create trigger registrations_set_updated_at
before update on public.registrations
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.registrations enable row level security;

revoke all on public.registrations from anon, authenticated;

grant all on table public.registrations to service_role;
