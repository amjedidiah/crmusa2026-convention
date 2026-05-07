-- ============================================================
-- CRM USA 2026 Convention
-- Phase 1 Foundation Schema
-- Source of truth: versioned Supabase migrations
-- ============================================================

create extension if not exists pgcrypto;

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  pledge_code text not null,
  first_name text not null,
  last_name text not null,
  email text not null,
  email_normalized text not null,
  phone text,
  church text,
  city text,
  tier text not null,
  total_cents bigint not null,
  amount_paid_cents bigint not null default 0,
  status text not null default 'pending',
  attendees_json jsonb not null default '[]'::jsonb,
  lookup_token_version integer not null default 1,
  last_reminder_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint registrations_pledge_code_not_blank check (btrim(pledge_code) <> ''),
  constraint registrations_first_name_not_blank check (btrim(first_name) <> ''),
  constraint registrations_last_name_not_blank check (btrim(last_name) <> ''),
  constraint registrations_email_not_blank check (btrim(email) <> ''),
  constraint registrations_email_normalized_not_blank check (btrim(email_normalized) <> ''),
  constraint registrations_tier_check check (tier in ('earlybird', 'regular', 'late')),
  constraint registrations_total_cents_check check (total_cents >= 0),
  constraint registrations_amount_paid_cents_check check (amount_paid_cents >= 0),
  constraint registrations_status_check check (status in ('pending', 'partial', 'complete', 'cancelled')),
  constraint registrations_lookup_token_version_check check (lookup_token_version > 0),
  constraint registrations_attendees_json_is_array check (jsonb_typeof(attendees_json) = 'array')
);

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

create table if not exists public.registration_payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  source text not null,
  external_ref text not null,
  amount_cents bigint not null,
  received_at timestamptz not null default timezone('utc', now()),
  notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_by text,
  status text not null default 'posted',
  constraint registration_payments_source_not_blank check (btrim(source) <> ''),
  constraint registration_payments_external_ref_not_blank check (btrim(external_ref) <> ''),
  constraint registration_payments_amount_cents_check check (amount_cents > 0),
  constraint registration_payments_status_check check (status in ('posted', 'voided'))
);

create unique index if not exists registration_payments_source_external_ref_key
  on public.registration_payments (source, external_ref);

create index if not exists registration_payments_registration_id_idx
  on public.registration_payments (registration_id);

create index if not exists registration_payments_received_at_idx
  on public.registration_payments (received_at desc);

drop trigger if exists registration_payments_set_updated_at on public.registration_payments;
create trigger registration_payments_set_updated_at
before update on public.registration_payments
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.registrations enable row level security;
alter table public.registration_payments enable row level security;

revoke all on public.registrations from anon, authenticated;
revoke all on public.registration_payments from anon, authenticated;

grant all on table public.registrations to service_role;
grant all on table public.registration_payments to service_role;

comment on table public.registrations is
  'Convention registrations. Browser access is not allowed; all reads and writes go through Vercel server-side functions.';

comment on table public.registration_payments is
  'Authoritative payment events for manual reconciliation and imports.';
