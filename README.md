# CRM USA National Convention 2026

Official convention website for Charismatic Renewal Ministries USA.

**Event:** July 29 – August 2, 2026
**Venue:** Holiday Inn NW Houston, 3539 N Sam Houston Pkwy West, Houston, TX 77086

---

## Local Supabase Workflow

This repository now treats the local Supabase CLI project as the schema source of truth.

```bash
supabase start
supabase db reset
supabase status
```

Key files:

- `supabase/config.toml` — local Supabase project config
- `supabase/migrations/202605070001_phase1_foundation.sql` — Phase 1 baseline schema
- `supabase/seed.sql` — deterministic local test data
- `supabase_migration.sql` — deprecated pointer file kept for compatibility

Recommended workflow:

1. Start local Supabase with `supabase start`
2. Rebuild schema and seed data with `supabase db reset`
3. Evolve the schema only through new files in `supabase/migrations`
4. Use the seeded registrations and payment events for endpoint and UI testing

---

## Quick Deploy

```bash
bash deploy_v1.sh
```

The script will:

1. Prompt for your current Supabase anon key and patch it into `index.html`
2. Remind you to apply the versioned migrations in `supabase/migrations`
3. Initialise git, connect to GitHub, commit and push
4. Vercel auto-deploys from the GitHub push

---

## Manual Key Locations

| Key               | Where to find it                                  |
| ----------------- | ------------------------------------------------- |
| Supabase Anon Key | Supabase → Project Settings → API → `anon public` |

---

## Stack

- `index.html` — single-file static site (HTML/CSS/JS)
- `api/_lib/*.js` — shared server-side helpers for validation, tokens, registration math, and Supabase access
- `vercel.json` — Vercel routing config
- `supabase/` — local Supabase project, migrations, and seed data
- `supabase_migration.sql` — deprecated pointer to the versioned migrations
- `deploy_v1.sh` — one-command deploy script

---

## Phase 1 Schema

The Phase 1 baseline schema introduces:

- `registrations`
  - `pledge_code`
  - `email_normalized`
  - `tier`
  - `total_cents`
  - `amount_paid_cents`
  - `status`
  - `attendees_json`
  - `lookup_token_version`
  - `last_reminder_at`
- `registration_payments`
  - `registration_id`
  - `source`
  - `external_ref`
  - `amount_cents`
  - `received_at`
  - `notes`
  - `raw_payload`

The schema is service-owned: public browser access is not granted in the Phase 1 migration. Later phases will move the frontend fully off direct Supabase access.

---

## Environment Notes

Current repo state is transitional:

- The existing browser flow still references a Supabase anon key in `index.html`
- The new Phase 1 foundation prepares the repo for fully server-side database access
- Future phases will remove the browser-to-Supabase dependency entirely

For server-side and cron work, plan to configure:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `RESEND_API_KEY`
- `CRON_SECRET`
- `LOOKUP_TOKEN_SECRET`

---

## Legacy Schema Snapshot

The original ad hoc schema file is no longer authoritative. It is retained only as a pointer to the versioned migration workflow.

---

## URLs

- **Live site:** <https://crmusa2026-convention.vercel.app>
- **GitHub:** <https://github.com/oxofoegbu/crmusa2026-convention>
