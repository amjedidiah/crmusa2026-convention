-- LOCAL DEVELOPMENT ONLY — applied by `supabase db reset`, NOT by `supabase db push`.
-- Never put this data in migration files for production.
--
-- Sample registrations / payments for local dev.
-- Totals match api/_lib/registration.js PRICING_CENTS (same $ amounts as index.html #register).
-- created_at falls inside each tier’s registration window (America/Chicago calendar dates).

truncate table public.registration_payments restart identity cascade;
truncate table public.registrations restart identity cascade;

insert into public.registrations (
  id,
  pledge_code,
  first_name,
  last_name,
  email,
  email_normalized,
  phone,
  church,
  city,
  tier,
  total_cents,
  amount_paid_cents,
  status,
  attendees_json,
  lookup_token_version,
  last_reminder_at,
  metadata,
  created_at,
  updated_at
) values
  (
    '11111111-1111-1111-1111-111111111111',
    'EAR123',
    'Sarah',
    'Johnson',
    'sarah.johnson@example.com',
    'sarah.johnson@example.com',
    '555-0101',
    'Grace Life Center',
    'Houston',
    'earlybird',
    -- Early bird: adult $200 + youth 11–17 $100 = $300 (ages 38 + 14)
    30000,
    0,
    'pending',
    '[{"name":"Sarah Johnson","age":38},{"name":"Micah Johnson","age":14}]'::jsonb,
    1,
    null,
    '{"seed":"pending"}'::jsonb,
    '2026-05-10T18:00:00+00'::timestamptz,
    '2026-05-10T18:00:00+00'::timestamptz
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'REG456',
    'Daniel',
    'Okoye',
    'daniel.okoye@example.com',
    'daniel.okoye@example.com',
    '555-0102',
    'River of Life Chapel',
    'Dallas',
    'regular',
    -- Regular: one adult 18+ $250
    25000,
    25000,
    'complete',
    '[{"name":"Daniel Okoye","age":42}]'::jsonb,
    1,
    '2026-07-02T14:00:00+00'::timestamptz,
    '{"seed":"complete"}'::jsonb,
    '2026-06-20T16:00:00+00'::timestamptz,
    '2026-06-20T16:00:00+00'::timestamptz
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'LAT789',
    'Maria',
    'Chen',
    'maria.chen@example.com',
    'maria.chen@example.com',
    '555-0103',
    'New Hope Assembly',
    'Austin',
    'late',
    -- Late: $300 per person × 3 (all-ages tier)
    90000,
    20000,
    'partial',
    '[{"name":"Maria Chen","age":35},{"name":"Ethan Chen","age":9},{"name":"Olivia Chen","age":12}]'::jsonb,
    2,
    '2026-08-10T14:00:00+00'::timestamptz,
    '{"seed":"partial"}'::jsonb,
    '2026-07-25T17:00:00+00'::timestamptz,
    '2026-07-25T17:00:00+00'::timestamptz
  );

insert into public.registration_payments (
  id,
  registration_id,
  source,
  external_ref,
  amount_cents,
  received_at,
  notes,
  raw_payload,
  created_by,
  status
) values
  (
    '44444444-4444-4444-4444-444444444444',
    '22222222-2222-2222-2222-222222222222',
    'zeffy_import',
    'zeffy-seed-0001',
    25000,
    '2026-06-22T16:30:00+00'::timestamptz,
    'Seeded fully paid card payment',
    '{"provider":"zeffy"}'::jsonb,
    'seed',
    'posted'
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '33333333-3333-3333-3333-333333333333',
    'manual_zelle',
    'manual-zelle-seed-0001',
    20000,
    '2026-08-02T13:15:00+00'::timestamptz,
    'Seeded partial Zelle payment',
    '{"provider":"zelle"}'::jsonb,
    'seed',
    'posted'
  );
