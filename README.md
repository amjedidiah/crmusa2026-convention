# CRM USA National Convention 2026

Official convention website for Charismatic Renewal Ministries USA.

**Event:** July 29 – August 2, 2026  
**Venue:** Holiday Inn NW Houston, 3539 N Sam Houston Pkwy West, Houston, TX 77086

---

## What’s implemented (Phases 1–5)

| Phase | Scope                                                                                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Versioned schema (`registrations`, `registration_payments`), cents-based money, RLS locked to service role, seed data for local testing.                                                                                                                                                     |
| **2** | `POST /api/register` only for new registrations; confirmation email via Resend; public site has no direct DB writes.                                                                                                                                                                         |
| **3** | Tokenized return flow: `GET /api/lookup`, `POST /api/lookup-request`, signed links in email, optional Upstash rate limits on register + lookup-request.                                                                                                                                      |
| **4** | Staff tools: Supabase Auth magic link + email allowlist; `GET /api/admin/registrations`, `POST /api/admin/payments/manual`, Zeffy `preview`/`apply`; RPC `staff_apply_registration_payment`; weekly `/api/remind` with `last_reminder_at`.                                                   |
| **5** | Ops hardening: structured JSON logs (`api/_lib/server-log.js`), [OPERATIONS.md](./OPERATIONS.md) runbook, `.env.example`, CI (`npm test`), optional DB integration tests (`RUN_INTEGRATION=1`), optional HTTP smoke (`SMOKE_BASE_URL`); RPC returns `payment_id` (migration `202605070003`). |

Public pages: `index.html` (register + returning guest). Staff: `admin-sync.html` + `admin-sync-app.js`.

---

## Prerequisites

| Tool                                      | Why                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Node.js 18+**                           | Vercel-style API routes; run `npm install` for `@upstash/*` (optional rate limiting).                       |
| **Docker Desktop** (or compatible engine) | Required by **Supabase CLI** for `supabase start` (local Postgres, Auth, Studio, etc.).                     |
| **Supabase CLI**                          | Local DB, migrations, `db reset`, link to hosted projects. [Install](https://supabase.com/docs/guides/cli). |

---

## Local Supabase (Phase 1 foundation + Phase 4 RPC)

Local Supabase runs in Docker containers. Ensure Docker is running, then:

```bash
cd crmusa2026-convention
npm install
supabase start
supabase db reset    # applies all migrations in supabase/migrations + seed.sql
supabase status      # API URL, anon key, service_role key — copy into .env.local
```

**Migrations (apply in order):**

- `supabase/migrations/202605070001_phase1_foundation.sql` — tables, RLS, triggers
- `supabase/migrations/202605070002_staff_apply_registration_payment.sql` — atomic payment RPC
- `supabase/migrations/202605070003_staff_apply_return_payment_id.sql` — RPC response includes `payment_id` for ops logs

**Typical loop:** `supabase start` → change SQL → `supabase db reset` (recreates DB from all migrations + `seed.sql`) → run `npm test` and, when ready, `RUN_INTEGRATION=1 npm run test:integration` with `.env.local` pointing at that instance.

**Useful files:**

- `supabase/config.toml` — local project settings
- `supabase/seed.sql` — sample registrations / payments for dev
- `supabase_migration.sql` — legacy pointer; prefer `supabase/migrations/`

**Hosted Supabase:** push the same migrations via CLI (`supabase db push`) or run SQL from those files in the dashboard SQL editor (not ideal long-term).

---

## Environment variables (Phases 1–5)

Create **`.env.local`** for Vercel CLI / local experiments, and set the same keys in the **Vercel** project (or your host).

### Supabase

| Variable               | Required      | Used by                                                                                                                                                                           |
| ---------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`         | Yes           | All server routes using REST/RPC                                                                                                                                                  |
| `SUPABASE_SERVICE_KEY` | Yes           | Server-only: `service_role` JWT for PostgREST (bypasses RLS). **Never** expose to the browser.                                                                                    |
| `SUPABASE_ANON_KEY`    | Yes (Phase 4) | `/api/admin/auth-config` (loads admin UI), and `GET /auth/v1/user` when validating staff JWTs. **Public** in admin page; still not used for registration data from the main site. |

### Email

| Variable         | Required         | Used by                                                                                        |
| ---------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY` | Yes (prod email) | `POST /api/register` confirmation, `POST /api/lookup-request`, `api/confirm.js`, `/api/remind` |

### Site & tokens

| Variable              | Required             | Used by                                                                                                                           |
| --------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`            | Strongly recommended | Canonical links in emails (confirmation, lookup links, reminders). Example: `https://your-domain.vercel.app` (no trailing slash). |
| `LOOKUP_TOKEN_SECRET` | Yes (Phase 3)        | Signing lookup JWTs for `/#return?token=...`                                                                                      |

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

| Variable                | Required | Used by                                                                                                                     |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `STAFF_EMAIL_ALLOWLIST` | Yes      | Comma- or newline-separated emails allowed after Supabase magic-link sign-in. If empty, **all** staff API calls return 403. |

**Staff login (hosted):** In Supabase Dashboard → Authentication → Providers, enable **Email** (magic link). Under URL configuration, add the production and preview origins for `admin-sync.html` (for example `https://<project>.vercel.app/admin-sync.html`). Staff open the admin page, sign in with an allowlisted email, and the SPA sends `Authorization: Bearer <session JWT>` to `/api/admin/*`. The anon key is exposed only to that admin page for Auth session bootstrap—not for public registration data.

**Reminder cron:** Vercel Cron invokes `GET /api/remind` per `vercel.json`. Set `CRON_SECRET` in Vercel and configure the cron job to send `Authorization: Bearer <CRON_SECRET>` (the handler also accepts `?secret=` for manual curls).

**Rate limiting:** Configure Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) to enforce limits on `POST /api/register` and `POST /api/lookup-request`. If these variables are omitted, both routes still function without Redis-backed limits.

**Email:** Create a Resend API key and verify the sending domain (or use Resend’s trial constraints). All transactional email uses `RESEND_API_KEY`.

### Example `.env.local`

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...service_role...
SUPABASE_ANON_KEY=eyJ...anon...
RESEND_API_KEY=re_...
SITE_URL=https://crmusa2026-convention.vercel.app
LOOKUP_TOKEN_SECRET=use-a-long-random-string
CRON_SECRET=another-long-random-secret
STAFF_EMAIL_ALLOWLIST=finance@example.org,ops@example.org

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
- `POST /api/lookup-request` — email + pledge → generic response + optional Resend

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
- `package.json` — `@upstash/ratelimit`, `@upstash/redis` (optional)
- `vercel.json` — cron schedule for `/api/remind`
- `supabase/` — CLI project, migrations, seed

---

## Deploy notes

- Configure **all** env vars in the Vercel project; the app does **not** rely on embedding a Supabase anon key in `index.html` anymore.
- **`deploy_v1.sh` is disabled** (exits with an error). Do not run it; use Git push + Vercel env vars + migrations as documented above.

---

## Phase 5: Logs, tests, and operations

- **Structured logs:** Handlers emit single-line JSON (see [OPERATIONS.md](./OPERATIONS.md)) with `registration_id` and `payment_id` where applicable. Search Vercel logs by `event` (for example `payment.manual_applied`, `register.persisted`).
- **Env template:** Copy [.env.example](./.env.example) when onboarding; production keys live in Vercel / Supabase dashboards only.
- **Unit tests:** `npm test` — pricing, validation, tokens, Zeffy CSV helpers (runs on push/PR via `.github/workflows/ci.yml`).
- **DB integration (opt-in):** `RUN_INTEGRATION=1 npm run test:integration` — calls Supabase REST/RPC directly (same paths as the payment RPC used by manual + Zeffy apply). Does **not** exercise staff JWT auth or HTTP framing for admin/Zeffy preview routes.
- **HTTP smoke (opt-in):** against a running deployment or `vercel dev`:

  ```bash
    SMOKE_BASE_URL=https://your-host.vercel.app npm run test:smoke-http
  ```

  Sends real HTTP requests to public/admin/cron routes for status-code sanity checks (see `test/smoke-http.mjs`). Not a replacement for manual checkout or browser E2E.
- **E2E (Playwright):** `npm run test:e2e:install` then, with `vercel dev` (or a deployed URL) running, `E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e`. Add `E2E_REGISTER=1` to include one real `POST /api/register` journey. See `e2e/` and `PRODUCTION_PLAN.md` → Test Plan → E2E.
- **Strategy:** Unit + targeted integration + HTTP smoke + optional Playwright; admin and token-return flows remain mostly manual.

---

## URLs

- **Live site:** <https://crmusa2026-convention.vercel.app>
- **GitHub:** <https://github.com/oxofoegbu/crmusa2026-convention>

---

## Legacy

- `supabase_migration.sql` — pointer only; authoritative schema is under `supabase/migrations/`.
