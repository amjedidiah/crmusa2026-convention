# CRM USA National Convention 2026

Official convention website for Charismatic Renewal Ministries USA.

**Event:** July 29 – August 2, 2026  
**Venue:** Holiday Inn NW Houston, 3539 N Sam Houston Pkwy West, Houston, TX 77086

**Monorepo:** This project lives under the `crm_na` repository. The main CRM NA marketing site is the Next.js app in [`../client/`](../client/); information architecture for that surface is documented in [`../docs/development_plan.md`](../docs/development_plan.md).

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

**Hosted Supabase (CLI link + push):**

1. Install and log in: `supabase login`.
2. From `crmusa2026-convention/`, link this folder to your cloud project (Dashboard → **Project Settings** → **General** → reference ID / API URL shows `https://<project-ref>.supabase.co`):

   ```bash
   supabase link --project-ref <YOUR_PROJECT_REF>
   ```

3. Push migration history to the remote database:

   ```bash
   supabase db push
   ```

   This applies **only** SQL files under `supabase/migrations/`. It does **not** run `supabase/seed.sql`.

**Seed data (`seed.sql`):** Defined in `[db.seed]` in `supabase/config.toml` and executed **only** when you run **`supabase db reset`** against your **local** stack (`supabase start`). Hosted production is unaffected unless you manually paste seed SQL into the Dashboard (don’t). Keep sample rows out of migration files.

Alternatively you can paste migration SQL into the Dashboard SQL editor once; using the CLI keeps drift visible and repeatable.

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

| Variable                         | Required                       | Used by                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_TRANSPORT`                | No                             | `resend` or `smtp` (Mailpit). If unset: **Resend** when `VERCEL_ENV` is `production` or `preview`, or when **`RESEND_API_KEY`** is set (skips host Mailpit during local `vercel dev`); otherwise **SMTP**. `NODE_ENV=test` → **SMTP** unless overridden. |
| `RESEND_API_KEY`                 | When using Resend              | `POST /api/register` confirmation, `POST /api/lookup-request`, `POST /api/resend-confirmation`, `api/confirm.js`, `/api/remind`                                                                                                                          |
| `CONVENTION_MAIL_FROM`           | **Yes** in strict production\* | From header for convention mail (`api/confirm.js`, `/api/remind`). Bare email or full `Name <email>`.                                                                                                                                                    |
| `CONVENTION_MAIL_REPLY_TO`       | **Yes** in strict production\* | Reply-To for those sends.                                                                                                                                                                                                                                |
| `CONVENTION_ZELLE_EMAIL`         | **Yes** in strict production\* | Zelle address shown in balance-due confirmation copy.                                                                                                                                                                                                    |
| `CONVENTION_STAFF_NOTIFY_EMAILS` | **Yes** in strict production\* | Staff list for NEW REGISTRATION (comma/newline; deduped). If unset outside strict mode, falls back to a legacy dev list.                                                                                                                                 |
| `CONVENTION_CONFIRM_SECRET`      | If using `POST /api/confirm`   | Bearer token for manual confirm endpoint; if unset, route returns 503.                                                                                                                                                                                   |
| `MAILPIT_SMTP_HOST`              | No                             | SMTP host for Mailpit / dev relay. Default `127.0.0.1`.                                                                                                                                                                                                  |
| `MAILPIT_SMTP_PORT`              | No                             | If unset: **54325** when `SUPABASE_URL` is local CLI (`http://127.0.0.1:54321` etc.—shared Mailpit with Auth); else **1025** (standalone Mailpit). Set explicitly if your relay differs.                                                                 |

\* **Strict production:** `VERCEL_ENV=production` **or** (`NODE_ENV=production` and `VERCEL` is not `1`, e.g. self‑hosted Node). Vercel Preview (`VERCEL=1`, `VERCEL_ENV=preview`) may omit these and still use legacy defaults.

**Local SMTP:** With **Supabase CLI** (`supabase start`, `SUPABASE_URL` pointing at `:54321`), transactional mail uses Mailpit SMTP **:54325** by default (same inbox as staff magic links; web UI **<http://127.0.0.1:54324>**). **Standalone** Mailpit is usually **:1025** (UI often **:8025**). You can instead set `EMAIL_TRANSPORT=resend` and `RESEND_API_KEY` and skip Mailpit.

**Production / preview:** Set `RESEND_API_KEY` in Vercel (transport stays Resend automatically when `VERCEL_ENV` is `production` or `preview`).

**Routing (debugging):** Logic lives in `api/_lib/email-send.js` (`resolveEmailTransport`, `resolveMailpitSmtpPort`). If `EMAIL_TRANSPORT` is unset: **Resend** when `VERCEL_ENV` is `production` or `preview`, or when **`RESEND_API_KEY` is set** (so local `vercel dev` does not require host-reachable Mailpit—GoTrue still uses Docker-internal SMTP). Otherwise **SMTP**. `NODE_ENV=test` forces **SMTP** unless you set `EMAIL_TRANSPORT`. Hosts without `VERCEL_ENV` (non-Vercel production) with no `RESEND_API_KEY` default to SMTP—set `EMAIL_TRANSPORT=resend` if you want Resend there. When `MAILPIT_SMTP_HOST` is unset, SMTP tries **127.0.0.1** then **localhost** on each port. When `MAILPIT_SMTP_PORT` is unset and **:54325** refuses on both hosts, the client **retries :1025** on those hosts before failing. **Staff magic-link** messages are sent by **Supabase Auth**, not this module.

**Staff magic links vs transactional mail:** `SMTP_*` / `RESEND_API_KEY` / `EMAIL_TRANSPORT` in **this app’s** `.env.local` (Vercel) control **only** convention transactional email (`email-send.js`). **Staff** sign-in (`admin-sync.html` → `signInWithOtp`) is delivered by **Supabase Auth (GoTrue)**. Configure **Custom SMTP** per hosted project in the [Dashboard → Authentication → SMTP](https://supabase.com/docs/guides/auth/auth-smtp), or optional `[auth.email.smtp]` in [`supabase/config.toml`](./supabase/config.toml) for local `supabase start` (CLI reads project-root `.env` for `env()`, not `.env.local`). The local branded template source is [`supabase/templates/magic-link.html`](./supabase/templates/magic-link.html), wired through `[auth.email.template.magic_link]` in [`supabase/config.toml`](./supabase/config.toml); copy the same HTML into the hosted Supabase project's **Authentication → Email Templates → Magic Link**. Production, preview, and local stacks each have **separate** Auth mail settings—a preview deployment still needs SMTP and template config on **that** Supabase project if default Auth mail is not enough.

**Email go-live checklist (registration + reminders):**

- Set **`RESEND_API_KEY`** (or SMTP / Mailpit for local) per the table above.
- In **strict production** (`VERCEL_ENV=production`, or `NODE_ENV=production` on non-Vercel hosts where `VERCEL` is not `1`), set **`CONVENTION_MAIL_FROM`**, **`CONVENTION_MAIL_REPLY_TO`**, **`CONVENTION_ZELLE_EMAIL`**, and a non-empty **`CONVENTION_STAFF_NOTIFY_EMAILS`** (comma/newline-separated). Omitting these causes confirmation sends to fail fast. Vercel Preview may still rely on legacy defaults when unset.
- Set **`CONVENTION_CONFIRM_SECRET`** if you still use **`POST /api/confirm`** from tooling; send `Authorization: Bearer <secret>`. Without the secret, the route returns 503.
- Smoke-test: free registration, paid registration with **$0** pay-today intent, paid with partial intent; confirm Mailpit or inbox receives **CRM 2026 Registration Confirmed** and staff **NEW REGISTRATION** (register path only; **`POST /api/resend-confirmation`** is registrant-only).
- Logs: watch for `register.email_failed_after_persist`, `confirm.registration_email_failed`, `confirm.staff_notification_failed`, `resend_confirmation.email_failed`.

**Integration tests** (`RUN_INTEGRATION=1`): `test/load-env.mjs` sets `EMAIL_TRANSPORT=resend` by default so Resend is still mocked via `fetch`; override `EMAIL_TRANSPORT=smtp` if you run Mailpit for integration.

### Site & tokens

| Variable                   | Required             | Used by                                                                                                                            |
| -------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                 | Strongly recommended | Canonical links in emails (confirmation, lookup links, reminders). Example: `https://your-domain.vercel.app` (no trailing slash).  |
| `LOOKUP_TOKEN_SECRET`      | Yes (Phase 3)        | Signing lookup JWTs for `/#return?token=...`                                                                                       |
| `LOOKUP_TOKEN_TTL_SECONDS` | No                   | Override default lookup-link lifetime (seconds). Default **7 days** if unset; max **365 days**. Use for explicit longer campaigns. |

### Rate limiting (Phase 3, optional)

If unset, register / lookup-request / resend-confirmation still work; limits are only enforced when Upstash is configured.

| Variable                   | Required | Used by                  |
| -------------------------- | -------- | ------------------------ |
| `UPSTASH_REDIS_REST_URL`   | Optional | `api/_lib/rate-limit.js` |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Same                     |

### Cron (Phase 4 reminders)

| Variable      | Required | Used by                                                                 |
| ------------- | -------- | ----------------------------------------------------------------------- |
| `CRON_SECRET` | Yes      | `GET /api/remind` — `Authorization: Bearer <CRON_SECRET>` or `?secret=` |

Reminder emails are operational payment reminders. They currently include support contact information only; there is no built-in unsubscribe or reply-to-stop workflow.

### Staff admin (Phase 4)

| Variable                | Required | Used by                                                                                                                                                                                                                                                                                        |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAFF_EMAIL_ALLOWLIST` | Yes      | Comma- or newline-separated emails allowed after Supabase magic-link sign-in. If empty, **all** staff API calls return 403. Changes require updating Vercel (or host) env and **redeploy**; see [PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md) → _Staff email allowlist (launch) and offboarding_. |
| `STAFF_ORIGINS`         | No\*     | Allowed browser `Origin` values for `/api/admin/*` CORS (comma/newline-separated; echoed back with `Vary: Origin`). Never `*`.                                                                                                                                                                 |
| `STAFF_ORIGIN`          | No\*     | Single origin when you only need one; ignored if `STAFF_ORIGINS` is set.                                                                                                                                                                                                                       |

\*If both are unset, CORS allowlist falls back to **`SITE_URL`** (typical same-deployment admin + API). Add explicit origins for previews or when `SITE_URL` does not match where `admin-sync.html` is opened (e.g. `http://localhost:3000`).

**Staff login (hosted):** In Supabase Dashboard → Authentication → Providers, enable **Email** (magic link). Under **URL configuration**, add every origin staff use for `admin-sync.html` (production, preview, local). Misconfigured redirects cause `signInWithOtp` errors even when SMTP is fine. For production mail delivery, enable **Custom SMTP** on that project (see **Staff magic links vs transactional mail** above)—do not rely on Vercel `SMTP_*` alone. Staff sign in with an allowlisted email; the SPA then sends `Authorization: Bearer <session JWT>` to `/api/admin/*`. The anon key is returned from `/api/admin/auth-config` for Auth bootstrap (same anon key the public client would use; staff data still requires a valid staff session and allowlist). Staff APIs only emit `Access-Control-Allow-Origin` for allowlisted origins (see `STAFF_ORIGINS` / `SITE_URL`).

**Reminder cron:** Vercel Cron invokes `GET /api/remind` per `vercel.json`. Set `CRON_SECRET` in Vercel and configure the cron job to send `Authorization: Bearer <CRON_SECRET>` (the handler also accepts `?secret=` for manual curls).

**Rate limiting:** Configure Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) to enforce limits on `POST /api/register`, `POST /api/lookup-request`, and `POST /api/resend-confirmation`. If these variables are omitted, those routes still function without Redis-backed limits.

**Transactional email:** See **### Email** (Vercel `production` / `preview` → Resend; otherwise SMTP and Mailpit ports documented there). Staff magic links use **Supabase Auth**, not `email-send.js`.

### Example `.env.local`

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...service_role...
SUPABASE_ANON_KEY=eyJ...anon...
# Production / preview: Resend (omit or set EMAIL_TRANSPORT=smtp for local Mailpit only).
RESEND_API_KEY=re_...
# Optional: force transport — resend | smtp (see “Email” table above).
# EMAIL_TRANSPORT=resend
SITE_URL=https://crmusa2026-convention.crm-na.org
LOOKUP_TOKEN_SECRET=use-a-long-random-string
# Optional: lookup link TTL in seconds (default 604800 = 7 days; max 31536000).
# LOOKUP_TOKEN_TTL_SECONDS=2592000
CRON_SECRET=another-long-random-secret
STAFF_EMAIL_ALLOWLIST=finance@example.org,ops@example.org

# Optional: admin API CORS (defaults to SITE_URL if unset). Add previews/extra hosts as needed.
# STAFF_ORIGINS=https://crmusa2026-convention.crm-na.org

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
- `POST /api/lookup-request` — email + pledge → **identical generic JSON on every HTTP 200** (anti-enumeration); optional transactional email (Resend or SMTP per `EMAIL_TRANSPORT`)
- `POST /api/resend-confirmation` — same **200 / anti-enumeration** contract as lookup-request; resends **registrant** confirmation only (no staff blast)
- `POST /api/confirm` — manual tooling only; requires `Authorization: Bearer <CONVENTION_CONFIRM_SECRET>`; returns **503** if secret unset

### Staff (Bearer = Supabase session JWT, email on allowlist)

- `GET /api/admin/auth-config` — `{ supabase_url, supabase_anon_key }` for the admin UI
- `GET /api/admin/registrations` — list / search / lookup
- `POST /api/admin/payments/manual` — manual payment (RPC)
- `POST /api/admin/import/zeffy/preview` — CSV preview
- `POST /api/admin/import/zeffy/apply` — apply selected rows

### Cron / legacy

- `GET /api/remind` — balance reminders (`CRON_SECRET`)
- Legacy **`POST /api/admin`** was removed; old clients get **404**.

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

- **Live site:** <https://crmusa2026-convention.crm-na.org>
- **GitHub:** <https://github.com/oxofoegbu/crmusa2026-convention>

---

## Legacy

- `supabase_migration.sql` — pointer only; authoritative schema is under `supabase/migrations/`.
