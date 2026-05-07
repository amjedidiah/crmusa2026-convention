# Production Plan: Server-Side Registration to SEO/Legal/Accessibility

## Summary

Keep the public site as a static Vercel frontend, but move every state-changing and state-revealing workflow behind Vercel server-side functions/route handlers. Launch on a manual-reconciliation payment model: Zelle and Zeffy remain accepted, but only staff-recorded or imported payments can change registration balance or status. Replace public direct Supabase access and shared-PIN admin access with server-owned APIs, strict database policies, tokenized self-service lookup, staff authentication, and a production baseline for policy, SEO, and accessibility. Build and test the production plan against a local Supabase instance backed by versioned migrations and seed data.

## Phased Implementation

### Phase 1: Server-Side Data and Security Foundation

- [x] Replace the checked-in migration with a v2 schema that matches the current product model and supports production operations.
- [ ] Stand up a local Supabase instance for development and testing via the Supabase CLI.
- [x] Store schema changes only as versioned migrations and keep local/dev/prod in sync from migrations rather than dashboard-only edits.
- [x] Add seed data for realistic local testing: sample registrations, outstanding balances, complete registrations, and payment events.
- [x] Make local database reset/reseed part of the standard developer workflow for reproducible testing.
- [x] Make the database service-owned only: no browser inserts or selects against Supabase; anon RLS access becomes unnecessary.
- [x] Standardize money as integer cents in the new model and backfill legacy numeric values during migration.
- [x] Add unique/indexed identifiers:
  - [x] `registrations.pledge_code` unique
  - [x] normalized email index
  - [x] `registration_payments.external_ref` unique per source
- [x] Add production fields required by the new flows:
  - [x] `registrations`: `pledge_code`, `email_normalized`, `tier`, `total_cents`, `amount_paid_cents`, `status`, `attendees_json`, `lookup_token_version`, `last_reminder_at`, timestamps
  - [x] `registration_payments`: `registration_id`, `source`, `external_ref`, `amount_cents`, `received_at`, `notes`, `raw_payload`, timestamps
- [x] Remove dead PayPal assumptions from docs and schema.
- [x] Introduce shared server utilities for validation, pricing, status calculation, pledge-code generation, token signing, and email payload construction.

### Phase 2: Server-Side Registration Creation

- [x] Replace client-side registration persistence with `POST /api/register`.
- [x] Ensure registration creation runs only in a Vercel server-side function/route handler, never in browser-to-Supabase code.
- [x] Make `POST /api/register` the only registration creation path and ensure it:
  - [x] validates contact and attendee payload
  - [x] computes the active pricing tier server-side
  - [x] calculates total server-side
  - [x] generates a unique pledge code server-side
  - [x] creates the registration transactionally
  - [x] sets `status = complete` only when total is zero, else `pending`
  - [x] creates a signed self-service lookup token after insert
  - [x] sends confirmation email only after the insert succeeds
- [x] Change the frontend so success UI appears only after the API returns a persisted registration.
- [x] If email delivery fails after persistence, still show a successful registration result with a "registration saved, email retry pending" message and log the failure for follow-up.
- [x] Keep the public payment UI informational only. The user may indicate how much they intend to pay today, but that value must not update paid state and must be treated only as email copy or omitted entirely if it creates ambiguity.
- [x] Define and implement registration flow UI states:
  - [x] idle/default form state
  - [x] client-side validating state
  - [x] submitting/loading state with submit disabled
  - [x] persisted success state with confirmation details
  - [x] recoverable error state with retry path
  - [x] fatal error state with support guidance
- [x] Define validation behavior for registration:
  - [x] inline field-level validation for contact and attendee inputs
  - [x] form-level summary for blocking errors
  - [x] server validation error mapping back to the correct fields/messages
  - [x] duplicate-submit prevention and safe retry UX
- [x] Define registration confirmation UI content:
  - [x] final persisted registration summary
  - [x] pledge code display and copy action
  - [x] lookup/recovery guidance
  - [x] truthful payment-state messaging that does not imply funds were received
- [x] Standardize form UI presentation for production:
  - [x] consistent label/help/error text styling
  - [x] readable mobile spacing and hierarchy
  - [x] clear success/warning/error visual states without relying on color alone

### Phase 3: Tokenized Self-Service Lookup

- [x] Replace public direct lookup with tokenized self-service.
- [x] Ensure all self-service lookup and lookup recovery logic runs only in Vercel server-side functions/route handlers.
- [x] Include a signed lookup link to the returning-registrant page in confirmation emails.
- [x] Add `GET /api/lookup?token=...` to return a sanitized registration summary for a valid signed token.
- [x] Add `POST /api/lookup-request` as the fallback recovery flow:
  - [x] input: `email` + `pledge_code`
  - [x] behavior: on a valid match, email a fresh signed lookup link
  - [x] response: always generic success text to avoid account enumeration
- [x] Implement tokens that:
  - [x] contain registration id and `lookup_token_version`
  - [x] expire after 30 days
  - [x] are reissuable without changing the registration record
  - [x] are revocable by incrementing `lookup_token_version`
- [x] Add rate limiting to `POST /api/register` and `POST /api/lookup-request` using a server-side store such as Upstash Redis.
- [x] Keep generic error responses for public lookup recovery and registration abuse controls.
- [x] Define and implement self-service lookup UI states:
  - [x] token loading state
  - [x] valid token with outstanding balance state
  - [x] valid token with fully paid state
  - [x] valid token with free registration state
  - [x] invalid or expired token state with recovery CTA
  - [x] lookup-request submitted state
  - [x] generic recovery response state that avoids account enumeration
- [x] Add UI guards for self-service lookup:
  - [x] stale or reused token handling
  - [x] disabled actions while token or recovery request is pending
  - [x] retry path for transient server failures
  - [x] support fallback messaging when recovery cannot be completed immediately
- [x] Standardize balance/data display states:
  - [x] loaded summary state with clear totals and labels
  - [x] empty/no-data state where appropriate
  - [x] error state copy that is informative but non-leaky

### Phase 4: Authoritative Payment State and Staff Operations

- [x] Treat payment state as staff-controlled only for v1 production.
- [x] Ensure all payment updates, imports, reporting reads, and reminder queries run only in Vercel server-side functions/route handlers.
- [x] Remove any public path that can set `amount_paid` or `status`. (`POST /api/register` sets initial `amount_paid_cents = 0` and derived `status` only at creation; `/api/confirm` sends email only and does not mutate balances.)
- [x] Replace the PIN-based admin API with staff authentication via Supabase Auth magic-link and a server-side allowlist of staff emails.
- [x] Split the admin surface into explicit authenticated endpoints:
  - [x] `POST /api/admin/payments/manual` for single payment entry
  - [x] `POST /api/admin/import/zeffy/preview` for CSV preview/matching
  - [x] `POST /api/admin/import/zeffy/apply` for applying matched rows
  - [x] `GET /api/admin/registrations` for reporting/search
- [x] Ensure every payment write:
  - [x] inserts a `registration_payments` row first-class
  - [x] uses `external_ref` idempotency for imports
  - [x] updates registration aggregates transactionally
  - [x] recalculates `status` as `pending`, `partial`, or `complete`
- [x] Lock Zeffy CSV import behavior to:
  - [x] parse client-side or server-side for preview
  - [x] match on pledge code
  - [x] flag unmatched, refunded, duplicate, and overpayment rows before apply
  - [x] apply only approved rows
- [x] Lock Zelle manual entry behavior to:
  - [x] lookup by staff
  - [x] create a manual payment event
  - [x] allow overpayment only with an explicit staff confirmation flag
- [x] Keep the reminder cron weekly, querying authoritative outstanding balances only and stamping `last_reminder_at` so one registration does not get duplicate reminders in the same cycle.
- [x] Define and implement admin/payment UI states:
  - [x] loading/searching state for registration lookup
  - [x] no-result state for staff lookup
  - [x] ready-to-record payment state
  - [x] payment recorded success state with updated totals
  - [x] partial failure state when write or aggregate update fails
  - [x] session-expired/auth-expired recovery state
- [x] Define and implement import/report UI states:
  - [x] empty report state
  - [x] populated report state
  - [x] empty import preview state
  - [x] unmatched rows state
  - [x] duplicate rows state
  - [x] overpayment warning state
  - [x] apply-in-progress state
  - [x] apply-complete state
  - [x] apply-partial-failure state with actionable row-level feedback
- [x] Add admin-side validation and guards:
  - [x] prevent duplicate manual submissions while pending
  - [x] require explicit confirmation for overpayments or suspicious entries
  - [x] verify imported rows before apply
  - [x] keep destructive or irreversible actions behind a review step
- [x] Standardize admin data presentation:
  - [x] readable table typography and density on desktop
  - [x] usable mobile/tablet fallback behavior where needed
  - [x] consistent status badges, alerts, and row-level feedback
- [ ] **Audit trail for staff payment actions:** Log Supabase Auth staff user id (`sub`) and email when available for every `registration_payments` insert from manual entry or Zeffy import apply; include registration id, payment id/source, and timestamp in structured logs.
- [ ] **Durable attribution (optional but recommended):** Add nullable `created_by_staff_user_id` and/or `created_by_staff_email` on `registration_payments` (migration + writes from staff routes) so reconciliation and disputes do not depend only on log retention. For imports, also log a single **batch identifier** (e.g. request id or timestamp + staff id) to correlate many rows.
- [ ] Document in the operational runbook how to trace a payment event back to a staff member and which logs/tables to use for reconciliation audits.

### Phase 5: Operations, Deployment, and Hardening

- [x] Clean up deployment/docs to match the real system:
  - [x] remove PayPal references (none remain in app/docs beyond this plan’s history)
  - [x] document all required env vars
  - [x] document staff login, reminder cron secret, rate-limit store, and email provider setup
- [x] Document the local Supabase development workflow, including start, reset, migrate, seed, and test steps.
- [x] Define and document required env vars:
  - [x] `SUPABASE_URL`
  - [x] `SUPABASE_SERVICE_KEY`
  - [x] `SUPABASE_ANON_KEY` required for staff JWT verification (`staff-auth.js` uses anon only; no silent fallback to service_role). Optional `SUPABASE_AUTH_KEY` overrides that Auth `apikey` when explicitly documented.
  - [x] `RESEND_API_KEY`
  - [x] `CRON_SECRET`
  - [x] `SITE_URL`
  - [x] `LOOKUP_TOKEN_SECRET`
  - [x] `UPSTASH_REDIS_REST_URL`
  - [x] `UPSTASH_REDIS_REST_TOKEN`
  - [x] `STAFF_EMAIL_ALLOWLIST` or an equivalent allowlist source
  - [x] `STAFF_ORIGINS` / `STAFF_ORIGIN` (optional; staff `/api/admin/*` CORS allowlist; defaults from `SITE_URL` when unset)
- [x] Add structured server logs keyed by registration id and payment id.
- [ ] **Staff identity in payment logs:** Extend manual entry and import-apply paths so structured logs always include staff Auth `sub` and email when present (see Phase 4 audit checklist).
- [x] Add an operational runbook for:
  - [x] registration failures
  - [x] email delivery failures
  - [x] Zeffy import mismatch handling
  - [x] manual payment corrections
  - [x] reminder job failures
  - [ ] **staff payment disputes and reconciliation:** how to correlate `registration_payments` rows and structured logs with a staff member and time window
- [x] Verify database backups and establish a pre-launch smoke checklist covering register, lookup, admin payment update, import, and reminder cron auth.
- [x] Add integration testing against a local or hosted Supabase instance using **direct REST/RPC** (`RUN_INTEGRATION=1 npm run test:integration`): lookup token vs seed row, manual payment RPC idempotency, reminder-scope query.
- [ ] Extend integration tests to cover **`POST /api/register` persistence** against local Supabase (e.g. inserted row, pledge code, totals)—**primary automated pre-launch gate** for registration. Staff JWT-protected routes may remain validated via manual checks plus HTTP smoke **401** coverage unless extended later.
- [x] Add optional **HTTP smoke** checks (`SMOKE_BASE_URL` + `npm run test:smoke-http`) for core route status codes without browser automation. **Pre-launch:** run smoke against the **release candidate URL**; strengthen assertions when feasible (e.g. response body shape, pledge code on successful register—not only status codes).
- [x] Run **unit tests in CI** on push/PR (`.github/workflows/ci.yml`).
- [x] Adopt a right-sized automated testing strategy:
  - [x] require unit tests for pure logic and validation rules
  - [x] require integration tests for database workflows used by payments (RPC + REST), plus registration persistence once the integration test above lands
  - [x] optional HTTP smoke for deployed route handlers; browser E2E remains minimal/deferred
  - [x] optional **E2E registration** on staging: `E2E_REGISTER=1` for full-browser validation before launch when the team chooses to run it
  - [x] defer broad visual regression and large snapshot-based UI suites unless later justified by change volume

#### Staff email allowlist (launch) and offboarding

- **Management (v1):** `STAFF_EMAIL_ALLOWLIST` is comma-separated in Vercel (or host) env. **Adding or removing** an email requires updating the var and **redeploying**. After deploy: confirm added staff reach admin APIs and removed addresses receive **403** on staff routes.
- **Audit trail (v1):** The allowlist is not stored in Postgres until a future DB-backed source lands; for access reviews and incidents, correlate changes with **host deployment/env history** (e.g. Vercel env snapshots tied to deployments) and a **short ticket or deploy note** (who changed what, when, why).
- **JWT session caveat:** JWTs may remain valid until expiry, but **every staff API request** checks the allowlist. After an email is removed and redeployed, the **next** call to a staff route should receive **403**. For urgent offboarding, combine allowlist removal with Supabase Dashboard steps if needed (e.g. sign-out, user disable per your security policy) and verify **403** on admin APIs.
- **Offboarding checklist:** Remove email from `STAFF_EMAIL_ALLOWLIST` → redeploy → verify former staff cannot call staff APIs → record removal date and owner in launch/sign-off documentation (see Pre-launch verification).
- **Future enhancement:** Store allowlist in a database table with an admin UI for updates without redeploy and a clearer change audit trail.

### Phase 6: SEO, Legal, and Accessibility Baseline

- [x] Add production metadata to the public site:
  - [x] meta description
  - [x] canonical URL
  - [x] Open Graph tags
  - [x] Twitter card tags
  - [x] `robots.txt`
  - [x] `sitemap.xml`
  - [x] organization/event JSON-LD
- [x] Add launch-baseline policy pages or equivalent routed documents:
  - [x] Privacy Policy
  - [x] Terms of Use
  - [x] Refund/Cancellation Policy
  - [x] Accessibility Statement
- [x] Add explicit consent copy at registration submit covering:
  - [x] collection and use of personal/contact data
  - [x] payment follow-up and reminder emails
  - [x] staff reconciliation of Zelle/Zeffy payments
- [x] Meet the accessibility baseline:
  - [x] semantic landmarks and heading order
  - [x] labeled form controls and programmatic error associations
  - [x] keyboard-only navigation for registration and return flows
  - [x] focus management on step changes and error states
  - [x] sufficient contrast for all text/actions
  - [x] reduced-motion handling for hero animations
  - [x] accessible iframe/title handling for Zeffy embeds
  - [x] no information conveyed by color alone
- [x] Validate animation and motion behavior:
  - [x] page-load and reveal motion feels intentional without delaying interaction
  - [x] reduced-motion fallback disables or simplifies non-essential animation
  - [x] motion does not cause layout shift or content jump during load and step changes
  - [x] no blocking, auto-looping, or distracting motion interferes with reading or form completion

## Public APIs and Interfaces

- `POST /api/register`
  - Request: contact info, attendees, optional intended payment amount
  - Response: persisted registration summary, pledge code, lookup link status, remaining balance
- `GET /api/lookup?token=...`
  - Response: sanitized registration and balance summary only
- `POST /api/lookup-request`
  - Request: `email`, `pledge_code`
  - Response: generic success message regardless of match result
- `POST /api/admin/payments/manual`
  - Authenticated staff-only
  - Request: registration id, amount, method, received date, notes, optional overpayment confirmation
- `POST /api/admin/import/zeffy/preview`
  - Authenticated staff-only
  - Request: CSV payload
  - Response: matched/unmatched/duplicate/refund preview rows
- `POST /api/admin/import/zeffy/apply`
  - Authenticated staff-only
  - Request: approved preview rows
  - Response: applied count, skipped count, errors
- `GET /api/admin/registrations`
  - Authenticated staff-only
  - Query by pledge code, email, or list/report filters

## Test Plan

The checklist is grouped into **Integration** (automated tests you can run from the repo), **E2E** (browser automation), and **Manual** (human or staging-only verification).

### Pre-launch verification and sign-off

Complete the **Manual Tests** sections below before production launch and **record results** in one agreed place.

| Topic | Guidance |
|--------|----------|
| **Ownership** | Name a **launch owner** (e.g. tech lead or PM) who coordinates execution; individual scenarios may be run by dev, QA, or product as assigned. |
| **Sign-off criteria** | Default: **all launch-critical manual scenarios pass** (Registration, Lookup, Payments/admin, Reminders, and baseline accessibility). Waivers for non-critical items require **written** acceptance by the launch owner with a short risk note. |
| **Staging / preview** | Use a **staging or preview** URL for failure simulation and email-dependent checks. Env vars should match **production categories** (same email provider class, Redis, Supabase roles—not necessarily production data volume). Document which URL is used for the final run. |
| **Results storage** | Keep a single artifact: e.g. this checklist with dates/initials, a shared spreadsheet, or test tickets—**link it from launch notes** for audits and postmortems. |

**Automated gate (recommended order):** `RUN_INTEGRATION=1` including **registration persistence** once implemented → **HTTP smoke** on the release candidate URL (tighten assertions when the harness allows) → optional **`E2E_REGISTER=1`** on staging for full-browser registration.

### Integration

**Unit — `npm test` (`test/unit/*.test.js`)**

- [x] pricing and tier cutoff rules (`activeTierForDate`, attendee totals)
- [x] server-side validation helpers (`validateContact`, `validateAttendees`)
- [x] status calculation helpers (`deriveRegistrationStatus`)
- [x] token signing/verification helpers
- [x] Zeffy CSV parsing, stable external ref, and skipped refunded rows (`parseZeffyCsvText`)
- [x] RPC error shaping helper (`rpcErrorMessage`)

**Database / RPC — `RUN_INTEGRATION=1 npm run test:integration` (`test/integration/db-workflows.test.js`; service role + seeded rows)**

- [x] signed lookup token matches seeded registration row (`lookup_token_version`)
- [x] `staff_apply_registration_payment`: duplicate `external_ref` rejected (`duplicate_external_ref`)
- [x] overpayment rejected without RPC allow flag (`overpayment_not_allowed`)
- [x] overpayment allowed when `p_allow_overpayment` / client passes confirm flag
- [x] pending → partial → complete via two RPC calls (mixed `zelle_manual` / `zeffy` sources)
- [x] partial seed registration → complete with one RPC (exact remainder)
- [x] reminder candidate query shape (`status in pending/partial`)
- [ ] `POST /api/register` persists a registration row with expected pledge code / totals against local Supabase (**planned**—primary automated gate for registration; track with Phase 5 integration item)

**HTTP smoke — `SMOKE_BASE_URL=… npm run test:smoke-http` (`test/smoke-http.mjs`; status codes only, no secrets)**

- [x] `POST /api/register` empty body → 400
- [x] `GET /api/lookup` without token → 400
- [x] `POST /api/lookup-request` short pledge → generic 200
- [x] `GET /api/remind` without cron secret → 401
- [x] staff routes without `Authorization` → 401 (`GET /api/admin/registrations`, `POST` Zeffy preview/apply, manual payment)
- [x] `GET /api/admin/auth-config` → 200 or 500 (config-dependent)
- [x] static policy/sitemap/robots URLs → 200 (`privacy-policy.html`, `sitemap.xml`, `robots.txt`)

**Pre-launch:** Run smoke against the **deploy URL under test**; extend checks beyond status codes when practical (see Phase 5).

### E2E

Playwright specs live in `e2e/` with `playwright.config.js` at the project root.

**Run:**

1. Start the app so `/` serves `index.html` **and** `/api/*` works (e.g. `vercel dev`, or point at a preview deployment).
2. `npm run test:e2e:install` once (Chromium).
3. `E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e` — smoke + wizard validation (no writes).
4. Optional full registration against a real backend: `E2E_REGISTER=1 E2E_BASE_URL=… npm run test:e2e`. Recommended on **staging** before launch when integration tests and smoke alone are not enough confidence.

Returning-registrant and `admin-sync.html` flows are still manual or future specs (magic-link auth).

### Manual Tests

#### Registration (public site)

- [ ] valid paid registration (full flow, real email optional)
- [ ] valid free registration
- [ ] invalid email and incomplete attendee data (inline + summary behavior)
- [ ] duplicate submit / retry behavior and disabled state while submitting
- [ ] simulate or observe DB failure before save and email failure after save (staging)
- [ ] server validation errors appear on the correct fields
- [ ] success UI reflects persisted API response, not placeholders

#### Lookup

- [ ] expired lookup token handling and messaging
- [ ] revoked token after `lookup_token_version` bump
- [ ] recovery: valid email + pledge pair receives link; invalid pair still shows generic copy
- [ ] rate-limited abuse behavior on recovery endpoint
- [ ] no account-enumeration leakage in JSON or UI copy
- [ ] invalid/expired token screen shows correct recovery CTA
- [ ] balance UI for fully paid, outstanding balance, and free registration

#### Payments / admin (`admin-sync.html`)

- [ ] staff allowlist: signed-in Supabase user not on `STAFF_EMAIL_ALLOWLIST` gets 403 on staff APIs
- [ ] optional UI walkthrough: pending → partial → complete (RPC already covered in integration)
- [ ] Zeffy CSV preview: unmatched pledge rows, duplicates, overpay rows + confirm checkbox
- [ ] report totals vs sum of payment events (spot-check against Supabase)
- [ ] confirm loading, empty, success, and partial-failure states match expectations in the admin UI

#### Reminders

- [ ] authorized cron (`CRON_SECRET`) only targets registrations with outstanding balance
- [ ] no duplicate send within the same cooldown window (`last_reminder_at`)

#### Site quality / accessibility

- [ ] keyboard-only path through registration and return flow
- [ ] screen reader: labels, errors, live regions as needed
- [ ] Lighthouse / axe on key pages (metadata, contrast, basics)
- [ ] typography and hierarchy across form, summary, tables, empty and error states

#### Explicitly defer (non-launch-critical)

- [ ] broad visual regression
- [ ] large snapshot-based UI suites
- [ ] exhaustive page-by-page browser automation

## Assumptions and Fixed Defaults

- Payment authority for production launch is `Manual Reconciliation v1`: Zeffy and Zelle remain manual until staff import/entry confirms payment.
- Returning registrant access uses `Tokenized Self-Serve`: emailed signed links are primary; code+email is fallback only to request a fresh link.
- Legal/compliance target is `Launch Baseline`, not counsel-led redrafting.
- Staff authentication uses Supabase Auth magic-link plus an email allowlist (`STAFF_EMAIL_ALLOWLIST`); changes require env update and **redeploy** unless a future DB-backed allowlist replaces it (see Phase 5). Shared PIN auth is removed.
- Pricing and registration date cutoffs are computed server-side in `America/Chicago`.
- The public marketing frontend remains on Vercel and continues to use the current single-page site structure unless a later implementation step makes file splitting necessary.
- “Vercel server-side functions/route handlers” is the required backend constraint; this plan does not require a Next.js Server Actions rewrite.
- Local development uses a Supabase CLI-managed instance as the source of truth for migrations, seeds, and integration testing before deploying to shared environments.
- **Schema (Phase 1):** `registration_payments` rows are **positive amounts only**; negative/refund lines are **not** modeled in v1 (documented on constraints). **`amount_paid_cents`** may **exceed** **`total_cents`** when staff confirms **intentional overpayment** (`staff_apply_registration_payment`). **`registration_payments.registration_id`** uses **`ON DELETE RESTRICT`** so deleting a registration cannot silently erase payment audit rows.
