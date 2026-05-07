# CRM USA National Convention 2026

Official convention website for Charismatic Renewal Ministries USA.

**Event:** July 29 – August 2, 2026  
**Venue:** Holiday Inn NW Houston, 3539 N Sam Houston Pkwy West, Houston, TX 77086

---

## What’s implemented (Phases 1–5)

| Phase | Scope                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Versioned schema (`registrations`, `registration_payments`), cents-based money, RLS locked to service role, seed data for local testing.                                                                                                                                                                                                                                              |
| **2** | `POST /api/register` only for new registrations; confirmation email via **Resend** (prod/preview) or **SMTP → Mailpit** (local / `NODE_ENV=test` by default); public site has no direct DB writes.                                                                                                                                                                                    |
| **3** | Tokenized return flow: `GET /api/lookup`, `POST /api/lookup-request`, signed links in email, optional Upstash rate limits on register + lookup-request.                                                                                                                                                                                                                               |
| **4** | Staff tools: Supabase Auth magic link + email allowlist; `GET /api/admin/registrations`, `POST /api/admin/payments/manual`, Zeffy `preview`/`apply`; RPC `staff_apply_registration_payment`; weekly `/api/remind` with `last_reminder_at`.                                                                                                                                            |
| **5** | Ops hardening: structured JSON logs (`api/_lib/server-log.js`), [OPERATIONS.md](./OPERATIONS.md) runbook, [.env.example](./.env.example), CI (`bun test`), optional DB integration tests (`RUN_INTEGRATION=1`), optional HTTP smoke (`SMOKE_BASE_URL`); RPC returns `payment_id` (migration `202605070003`). Roadmap and launch criteria: [PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md). |

Public pages: `index.html` (register + returning guest). Staff: `admin-sync.html` + `admin-sync-app.js`.

---

## Prerequisites

| Tool                                      | Why                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Node.js 18+**                           | Vercel-style API routes; run `bun install` for `@upstash/*` (optional rate limiting).                       |
| **Docker Desktop** (or compatible engine) | Required by **Supabase CLI** for `supabase start` (local Postgres, Auth, Studio, etc.).                     |
| **Supabase CLI**                          | Local DB, migrations, `db reset`, link to hosted projects. [Install](https://supabase.com/docs/guides/cli). |

---

## Local Supabase (Phase 1 foundation + Phase 4 RPC)

Local Supabase runs in Docker containers. Ensure Docker is running, then:

```bash
cd crmusa2026-convention
bun install
supabase start
supabase db reset    # applies all migrations in supabase/migrations + seed.sql
supabase status      # API URL, anon key, service_role key — copy into .env.local
```

**Migrations (apply in order):**

- `supabase/migrations/202605070001_phase1_foundation.sql` — tables, RLS, triggers
- `supabase/migrations/202605070002_staff_apply_registration_payment.sql` — atomic payment RPC
- `supabase/migrations/202605070003_staff_apply_return_payment_id.sql` — RPC response includes `payment_id` for ops logs
- `supabase/migrations/202605080001_registration_payments_restrict_and_docs.sql` — `ON DELETE RESTRICT` on payment rows + constraint comments (also upgrades older DBs that used CASCADE)
- `supabase/migrations/202605080002_payment_audit_attribution.sql` — durable staff attribution columns, import batch ids, updated payment RPC

**Typical loop:** `supabase start` → change SQL → `supabase db reset` (recreates DB from all migrations + `seed.sql`) → run `bun test` and, when ready, `RUN_INTEGRATION=1 bun run test:integration` with `.env.local` pointing at that instance.

**Useful files:**

- `supabase/config.toml` — local project settings
- `supabase/seed.sql` — sample registrations / payments for dev
- `supabase_migration.sql` — legacy pointer; prefer `supabase/migrations/`

**Hosted Supabase:** push the same migrations via CLI (`supabase db push`) or run SQL from those files in the dashboard SQL editor (not ideal long-term).

---

## Local web server (`vercel dev`)

Plain `vercel dev` often **does not** inject variables from `.env.local` into `/api/*` functions, which leads to errors like `SUPABASE_URL is required` even when that file is correct.

**Use this script (not `bun run dev` / `bun dev`):**

```bash
cd crmusa2026-convention
bun install
bun run dev:vercel
# or: bun run dev:vercel
```

`dev:vercel` loads **`.env.local`** via `dotenv-cli`, then starts `vercel dev`. The script is intentionally **not** named `dev`, because Vercel may set the project **Development Command** to `bun run dev` or `bun dev`, which would call `vercel dev` **again** and trigger a recursive-invocation error.

**In Vercel:** Project → Settings → General → **Build & Development Settings** → clear or change **Development Command** so it is **not** `bun run dev`, `bun dev`, or anything that runs `vercel dev`. For this repo (static site + `/api`), an empty development command is fine when you start the server yourself with `bun run dev:vercel`.

**Alternative:** In the [Vercel dashboard](https://vercel.com) → your project → **Settings → Environment Variables**, add the same keys to the **Development** environment (not only Production). Linked `vercel dev` can then read them from the cloud without relying on local files.

---

## Environment variables (Phases 1–5)

Create **`.env.local`** for Vercel CLI / local experiments, and set the same keys in the **Vercel** project (or your host).

### Supabase

| Variable               | Required      | Used by                                                                                                                                                                                                  |
| ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`         | Yes           | All server routes using REST/RPC                                                                                                                                                                         |
| `SUPABASE_SERVICE_KEY` | Yes           | Server-only: `service_role` JWT for PostgREST (bypasses RLS). **Never** expose to the browser.                                                                                                           |
| `SUPABASE_ANON_KEY`    | Yes (Phase 4) | `/api/admin/auth-config` (admin UI) and **required** `apikey` for `GET /auth/v1/user` in `staff-auth.js` (no fallback to service_role). **Public** in admin page; not used for public registration data. |
| `SUPABASE_AUTH_KEY`    | No            | Optional override for that Auth `apikey` only—set deliberately if documented; avoid using service_role.                                                                                                  |

### Email

| Variable            | Required          | Used by                                                                                                                                             |
| ------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_TRANSPORT`   | No                | `resend` or `smtp` (Mailpit). If unset: **Resend** when `VERCEL_ENV` is `production` or `preview`; otherwise **SMTP** (local dev, `NODE_ENV=test`). |
| `RESEND_API_KEY`    | When using Resend | `POST /api/register` confirmation, `POST /api/lookup-request`, `api/confirm.js`, `/api/remind`                                                      |
| `MAILPIT_SMTP_HOST` | No                | SMTP host for Mailpit / dev relay. Default `127.0.0.1`.                                                                                             |
| `MAILPIT_SMTP_PORT` | No                | Default `1025` (Mailpit).                                                                                                                           |

**Local:** Run [Mailpit](https://github.com/axllent/mailpit) (or Docker) exposing SMTP on `1025` and open the web UI (often `8025`) to read messages. No `RESEND_API_KEY` required when transport is SMTP.

**Production / preview:** Set `RESEND_API_KEY` in Vercel (transport stays Resend automatically).

**Integration tests** (`RUN_INTEGRATION=1`): `test/load-env.mjs` sets `EMAIL_TRANSPORT=resend` by default so Resend is still mocked via `fetch`; override `EMAIL_TRANSPORT=smtp` if you run Mailpit for integration.

### Site & tokens

| Variable                   | Required             | Used by                                                                                                                            |
| -------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                 | Strongly recommended | Canonical links in emails (confirmation, lookup links, reminders). Example: `https://your-domain.vercel.app` (no trailing slash).  |
| `LOOKUP_TOKEN_SECRET`      | Yes (Phase 3)        | Signing lookup JWTs for `/#return?token=...`                                                                                       |
| `LOOKUP_TOKEN_TTL_SECONDS` | No                   | Override default lookup-link lifetime (seconds). Default **7 days** if unset; max **365 days**. Use for explicit longer campaigns. |

### Rate limiting (Phase 3, optional)

If unset, register / lookup-request still work; limits are only enforced when Upstash is configured.

| Variable                   | Required | Used by                  |
| -------------------------- | -------- | ------------------------ |
| `UPSTASH_REDIS_REST_URL`   | Optional | `api/_lib/rate-limit.js` |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Same                     |

### Cron (Phase 4 reminders)

| Variable      | Required | Used by                                                                 |
| ------------- | -------- | ----------------------------------------------------------------------- |
| `CRON_SECRET` | Yes      | `GET /api/remind` — `Authorization: Bearer <CRON_SECRET>` or `?secret=` |

### Staff admin (Phase 4)

| Variable                | Required | Used by                                                                                                                                                                                                                                                                                        |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAFF_EMAIL_ALLOWLIST` | Yes      | Comma- or newline-separated emails allowed after Supabase magic-link sign-in. If empty, **all** staff API calls return 403. Changes require updating Vercel (or host) env and **redeploy**; see [PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md) → _Staff email allowlist (launch) and offboarding_. |
| `STAFF_ORIGINS`         | No\*     | Allowed browser `Origin` values for `/api/admin/*` CORS (comma/newline-separated; echoed back with `Vary: Origin`). Never `*`.                                                                                                                                                                 |
| `STAFF_ORIGIN`          | No\*     | Single origin when you only need one; ignored if `STAFF_ORIGINS` is set.                                                                                                                                                                                                                       |

\*If both are unset, CORS allowlist falls back to **`SITE_URL`** (typical same-deployment admin + API). Add explicit origins for previews or when `SITE_URL` does not match where `admin-sync.html` is opened (e.g. `http://localhost:3000`).

**Staff login (hosted):** In Supabase Dashboard → Authentication → Providers, enable **Email** (magic link). Under URL configuration, add the production and preview origins for `admin-sync.html` (for example `https://<project>.vercel.app/admin-sync.html`). Staff open the admin page, sign in with an allowlisted email, and the SPA sends `Authorization: Bearer <session JWT>` to `/api/admin/*`. The anon key is exposed only to that admin page for Auth session bootstrap—not for public registration data. Staff APIs only emit `Access-Control-Allow-Origin` for allowlisted origins (see `STAFF_ORIGINS` / `SITE_URL`).

**Reminder cron:** Vercel Cron invokes `GET /api/remind` per `vercel.json`. Set `CRON_SECRET` in Vercel and configure the cron job to send `Authorization: Bearer <CRON_SECRET>` (the handler also accepts `?secret=` for manual curls).

**Rate limiting:** Configure Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) to enforce limits on `POST /api/register` and `POST /api/lookup-request`. If these variables are omitted, both routes still function without Redis-backed limits.

**Email:** On Vercel **production** and **preview**, transactional email uses **Resend** (`RESEND_API_KEY`). In **development** and when `NODE_ENV=test`, it uses **SMTP** to **Mailpit** by default (`127.0.0.1:1025`) unless you set `EMAIL_TRANSPORT=resend`. Create a Resend API key and verify the sending domain for hosted sends.

### Example `.env.local`

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...service_role...
SUPABASE_ANON_KEY=eyJ...anon...
# Production / preview: Resend (omit or set EMAIL_TRANSPORT=smtp for local Mailpit only).
RESEND_API_KEY=re_...
# Optional: force transport — resend | smtp (see “Email” table above).
# EMAIL_TRANSPORT=resend
SITE_URL=https://crmusa2026-convention.vercel.app
LOOKUP_TOKEN_SECRET=use-a-long-random-string
# Optional: lookup link TTL in seconds (default 604800 = 7 days; max 31536000).
# LOOKUP_TOKEN_TTL_SECONDS=2592000
CRON_SECRET=another-long-random-secret
STAFF_EMAIL_ALLOWLIST=finance@example.org,ops@example.org

# Optional: admin API CORS (defaults to SITE_URL if unset). Add previews/extra hosts as needed.
# STAFF_ORIGINS=https://crmusa2026-convention.vercel.app

# Optional: Auth verify apikey override (staff-auth.js); prefer SUPABASE_ANON_KEY.
# SUPABASE_AUTH_KEY=

# Optional
UPSTASH_REDIS_REST_URL=https://....upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

---

## Supabase project configuration (hosted)

1. **SQL:** Apply **all** SQL files under `supabase/migrations/` (including `staff_apply_registration_payment` and the `payment_id` return shape in `202605070003_*`).
2. **Auth → Providers:** Enable **Email**; use **magic link** for staff (`admin-sync.html`).
3. **Auth → URL configuration:** Add redirect URLs for your admin page, e.g. `https://<project>.vercel.app/admin-sync.html` and `http://localhost:3000/admin-sync.html` if you test locally with a static server.
4. **API keys:** Use **anon** for `SUPABASE_ANON_KEY` and **service_role** for `SUPABASE_SERVICE_KEY` (dashboard → Project Settings → API).

---

## API routes (reference)

### Public / registrant

- `POST /api/register` — create registration
- `GET /api/lookup?token=...` — tokenized summary
- `POST /api/lookup-request` — email + pledge → generic response + optional transactional email (Resend or SMTP per `EMAIL_TRANSPORT`)

### Staff (Bearer = Supabase session JWT, email on allowlist)

- `GET /api/admin/auth-config` — `{ supabase_url, supabase_anon_key }` for the admin UI
- `GET /api/admin/registrations` — list / search / lookup
- `POST /api/admin/payments/manual` — manual payment (RPC)
- `POST /api/admin/import/zeffy/preview` — CSV preview
- `POST /api/admin/import/zeffy/apply` — apply selected rows

### Cron / legacy

- `GET /api/remind` — balance reminders (`CRON_SECRET`)
- `POST /api/admin` — **410**; replaced by routes above

---

## Stack

- `index.html` — public registration + returning guest (no Supabase client)
- `admin-sync.html` + `admin-sync-app.js` — staff console (Supabase JS + magic link)
- `api/**/*.js` — Vercel serverless handlers
- `api/_lib/*.js` — validation, tokens, staff auth, rate limit, Zeffy CSV helpers, payment RPC wrapper, structured logging (`server-log.js`)
- `package.json` — `@upstash/ratelimit`, `@upstash/redis` (optional), `nodemailer` (SMTP / Mailpit when not using Resend)
- `vercel.json` — cron schedule for `/api/remind`
- `supabase/` — CLI project, migrations, seed

---

## Deploy notes

- Configure **all** env vars in the Vercel project; the app does **not** rely on embedding a Supabase anon key in `index.html` anymore.
- **`deploy_v1.sh` is disabled** (exits with an error). Do not run it; use Git push + Vercel env vars + migrations as documented above.

---

## Phase 5: Logs, tests, and operations

**Repo docs (all at repo root):** [OPERATIONS.md](./OPERATIONS.md) (runbook + log fields), [.env.example](./.env.example) (env template), [PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md) (phases, staff payment audit checklist, allowlist/offboarding, **Pre-launch verification and sign-off**, full test plan).

- **Structured logs:** Handlers emit single-line JSON (see [OPERATIONS.md](./OPERATIONS.md)) with `registration_id`, `payment_id`, `payment_source`, and, on payment routes, staff Auth identity plus `import_batch_id` where applicable. Search Vercel logs by `event` (for example `payment.manual_applied`, `payment.zeffy_row_applied`, `register.persisted`).
- **Staff admin responses:** Staff APIs return registrant PII by design for reconciliation—never log full response bodies; see [OPERATIONS.md](./OPERATIONS.md) → _Staff admin API responses (PII)_.
- **Env template:** Copy [.env.example](./.env.example) when onboarding; production keys live in Vercel / Supabase dashboards only.
- **Unit tests:** `bun test` — pricing, validation, tokens, Zeffy CSV helpers (runs on push/PR via [`ci.yml`](./.github/workflows/ci.yml)).
- **DB integration (opt-in):** `RUN_INTEGRATION=1 bun run test:integration` — calls Supabase REST/RPC directly for payment workflows and exercises `POST /api/register` persistence through the handler against local Supabase. Loads `.env.local` then `.env` via [`dotenv`](https://github.com/motdotla/dotenv) in [`test/load-env.mjs`](./test/load-env.mjs). Does **not** exercise staff JWT auth or HTTP framing for admin/Zeffy preview routes.
- **HTTP smoke (opt-in):** against a running deployment or `vercel dev`:

  ```bash
    SMOKE_BASE_URL=https://your-host.vercel.app bun run test:smoke-http
  ```

  Sends real HTTP requests to public/admin/cron routes for status-code sanity checks (see [`test/smoke-http.mjs`](./test/smoke-http.mjs)). `GET /api/admin/auth-config` allows **200 or 500** (500 means missing `SUPABASE_URL` / `SUPABASE_ANON_KEY` on that host); a **500 still passes** smoke but prints a **WARN** so logs surface misconfiguration. Before launch, run against the **release candidate URL** and tighten assertions when the harness allows ([PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md)). Not a replacement for manual checkout or browser E2E.

- **E2E (Playwright):** `bun run test:e2e:install` then, with `vercel dev` (or a deployed URL) running, `E2E_BASE_URL=http://127.0.0.1:3000 bun run test:e2e`. Add `E2E_REGISTER=1` to include one real `POST /api/register` journey (recommended on **staging** before launch when needed). See [`e2e/`](./e2e/) and [PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md) → Test Plan → E2E.
- **Strategy:** Unit + targeted integration + HTTP smoke + optional Playwright; admin and token-return flows remain mostly manual. Use **Pre-launch verification and sign-off** in [PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md) for ownership, staging parity, and recording manual results before production.

---

## URLs

- **Live site:** <https://crmusa2026-convention.vercel.app>
- **GitHub:** <https://github.com/oxofoegbu/crmusa2026-convention>

---

## Legacy

- `supabase_migration.sql` — pointer only; authoritative schema is under `supabase/migrations/`.
