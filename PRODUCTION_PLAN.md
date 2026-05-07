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
- [ ] Define and implement registration flow UI states:
  - [ ] idle/default form state
  - [ ] client-side validating state
  - [ ] submitting/loading state with submit disabled
  - [ ] persisted success state with confirmation details
  - [ ] recoverable error state with retry path
  - [ ] fatal error state with support guidance
- [ ] Define validation behavior for registration:
  - [ ] inline field-level validation for contact and attendee inputs
  - [ ] form-level summary for blocking errors
  - [ ] server validation error mapping back to the correct fields/messages
  - [ ] duplicate-submit prevention and safe retry UX
- [ ] Define registration confirmation UI content:
  - [ ] final persisted registration summary
  - [ ] pledge code display and copy action
  - [ ] lookup/recovery guidance
  - [ ] truthful payment-state messaging that does not imply funds were received
- [ ] Standardize form UI presentation for production:
  - [ ] consistent label/help/error text styling
  - [ ] readable mobile spacing and hierarchy
  - [ ] clear success/warning/error visual states without relying on color alone

### Phase 3: Tokenized Self-Service Lookup

- [ ] Replace public direct lookup with tokenized self-service.
- [ ] Ensure all self-service lookup and lookup recovery logic runs only in Vercel server-side functions/route handlers.
- [ ] Include a signed lookup link to the returning-registrant page in confirmation emails.
- [ ] Add `GET /api/lookup?token=...` to return a sanitized registration summary for a valid signed token.
- [ ] Add `POST /api/lookup-request` as the fallback recovery flow:
  - [ ] input: `email` + `pledge_code`
  - [ ] behavior: on a valid match, email a fresh signed lookup link
  - [ ] response: always generic success text to avoid account enumeration
- [ ] Implement tokens that:
  - [ ] contain registration id and `lookup_token_version`
  - [ ] expire after 30 days
  - [ ] are reissuable without changing the registration record
  - [ ] are revocable by incrementing `lookup_token_version`
- [ ] Add rate limiting to `POST /api/register` and `POST /api/lookup-request` using a server-side store such as Upstash Redis.
- [ ] Keep generic error responses for public lookup recovery and registration abuse controls.
- [ ] Define and implement self-service lookup UI states:
  - [ ] token loading state
  - [ ] valid token with outstanding balance state
  - [ ] valid token with fully paid state
  - [ ] valid token with free registration state
  - [ ] invalid or expired token state with recovery CTA
  - [ ] lookup-request submitted state
  - [ ] generic recovery response state that avoids account enumeration
- [ ] Add UI guards for self-service lookup:
  - [ ] stale or reused token handling
  - [ ] disabled actions while token or recovery request is pending
  - [ ] retry path for transient server failures
  - [ ] support fallback messaging when recovery cannot be completed immediately
- [ ] Standardize balance/data display states:
  - [ ] loaded summary state with clear totals and labels
  - [ ] empty/no-data state where appropriate
  - [ ] error state copy that is informative but non-leaky

### Phase 4: Authoritative Payment State and Staff Operations

- [ ] Treat payment state as staff-controlled only for v1 production.
- [ ] Ensure all payment updates, imports, reporting reads, and reminder queries run only in Vercel server-side functions/route handlers.
- [ ] Remove any public path that can set `amount_paid` or `status`.
- [ ] Replace the PIN-based admin API with staff authentication via Supabase Auth magic-link and a server-side allowlist of staff emails.
- [ ] Split the admin surface into explicit authenticated endpoints:
  - [ ] `POST /api/admin/payments/manual` for single payment entry
  - [ ] `POST /api/admin/import/zeffy/preview` for CSV preview/matching
  - [ ] `POST /api/admin/import/zeffy/apply` for applying matched rows
  - [ ] `GET /api/admin/registrations` for reporting/search
- [ ] Ensure every payment write:
  - [ ] inserts a `registration_payments` row first-class
  - [ ] uses `external_ref` idempotency for imports
  - [ ] updates registration aggregates transactionally
  - [ ] recalculates `status` as `pending`, `partial`, or `complete`
- [ ] Lock Zeffy CSV import behavior to:
  - [ ] parse client-side or server-side for preview
  - [ ] match on pledge code
  - [ ] flag unmatched, refunded, duplicate, and overpayment rows before apply
  - [ ] apply only approved rows
- [ ] Lock Zelle manual entry behavior to:
  - [ ] lookup by staff
  - [ ] create a manual payment event
  - [ ] allow overpayment only with an explicit staff confirmation flag
- [ ] Keep the reminder cron weekly, querying authoritative outstanding balances only and stamping `last_reminder_at` so one registration does not get duplicate reminders in the same cycle.
- [ ] Define and implement admin/payment UI states:
  - [ ] loading/searching state for registration lookup
  - [ ] no-result state for staff lookup
  - [ ] ready-to-record payment state
  - [ ] payment recorded success state with updated totals
  - [ ] partial failure state when write or aggregate update fails
  - [ ] session-expired/auth-expired recovery state
- [ ] Define and implement import/report UI states:
  - [ ] empty report state
  - [ ] populated report state
  - [ ] empty import preview state
  - [ ] unmatched rows state
  - [ ] duplicate rows state
  - [ ] overpayment warning state
  - [ ] apply-in-progress state
  - [ ] apply-complete state
  - [ ] apply-partial-failure state with actionable row-level feedback
- [ ] Add admin-side validation and guards:
  - [ ] prevent duplicate manual submissions while pending
  - [ ] require explicit confirmation for overpayments or suspicious entries
  - [ ] verify imported rows before apply
  - [ ] keep destructive or irreversible actions behind a review step
- [ ] Standardize admin data presentation:
  - [ ] readable table typography and density on desktop
  - [ ] usable mobile/tablet fallback behavior where needed
  - [ ] consistent status badges, alerts, and row-level feedback

### Phase 5: Operations, Deployment, and Hardening

- [ ] Clean up deployment/docs to match the real system:
  - [ ] remove PayPal references
  - [ ] document all required env vars
  - [ ] document staff login, reminder cron secret, rate-limit store, and email provider setup
- [ ] Document the local Supabase development workflow, including start, reset, migrate, seed, and test steps.
- [ ] Define and document required env vars:
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_SERVICE_KEY`
  - [ ] `SUPABASE_ANON_KEY` only if needed for staff auth/session bootstrap, not for public data access
  - [ ] `RESEND_API_KEY`
  - [ ] `CRON_SECRET`
  - [ ] `SITE_URL`
  - [ ] `LOOKUP_TOKEN_SECRET`
  - [ ] `UPSTASH_REDIS_REST_URL`
  - [ ] `UPSTASH_REDIS_REST_TOKEN`
  - [ ] `STAFF_EMAIL_ALLOWLIST` or an equivalent allowlist source
- [ ] Add structured server logs keyed by registration id and payment id.
- [ ] Add an operational runbook for:
  - [ ] registration failures
  - [ ] email delivery failures
  - [ ] Zeffy import mismatch handling
  - [ ] manual payment corrections
  - [ ] reminder job failures
- [ ] Verify database backups and establish a pre-launch smoke checklist covering register, lookup, admin payment update, import, and reminder cron auth.
- [ ] Add integration testing against the local Supabase instance for registration creation, token lookup, manual payment recording, Zeffy import preview/apply, and reminder queries.
- [ ] Adopt a right-sized automated testing strategy:
  - [ ] require unit tests for pure logic and validation rules
  - [ ] require integration tests for server-side endpoints and database workflows
  - [ ] keep E2E coverage minimal and focused on a few critical end-to-end flows
  - [ ] defer broad visual regression and large snapshot-based UI suites unless later justified by change volume

### Phase 6: SEO, Legal, and Accessibility Baseline

- [ ] Add production metadata to the public site:
  - [ ] meta description
  - [ ] canonical URL
  - [ ] Open Graph tags
  - [ ] Twitter card tags
  - [ ] `robots.txt`
  - [ ] `sitemap.xml`
  - [ ] organization/event JSON-LD
- [ ] Add launch-baseline policy pages or equivalent routed documents:
  - [ ] Privacy Policy
  - [ ] Terms of Use
  - [ ] Refund/Cancellation Policy
  - [ ] Accessibility Statement
- [ ] Add explicit consent copy at registration submit covering:
  - [ ] collection and use of personal/contact data
  - [ ] payment follow-up and reminder emails
  - [ ] staff reconciliation of Zelle/Zeffy payments
- [ ] Meet the accessibility baseline:
  - [ ] semantic landmarks and heading order
  - [ ] labeled form controls and programmatic error associations
  - [ ] keyboard-only navigation for registration and return flows
  - [ ] focus management on step changes and error states
  - [ ] sufficient contrast for all text/actions
  - [ ] reduced-motion handling for hero animations
  - [ ] accessible iframe/title handling for Zeffy embeds
  - [ ] no information conveyed by color alone

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

- [ ] Unit tests for pure logic:
  - [ ] pricing and tier cutoff rules
  - [ ] server-side validation helpers
  - [ ] status calculation helpers
  - [ ] token signing/verification helpers
  - [ ] import matching, deduplication, and idempotency helpers
- [ ] Registration:
  - [ ] valid paid registration
  - [ ] valid free registration
  - [ ] invalid email
  - [ ] incomplete attendee data
  - [ ] duplicate submit/retry behavior
  - [ ] pricing cutover boundaries on the tier dates
  - [ ] DB failure before save
  - [ ] email failure after save
  - [ ] loading/submitting state disables duplicate submit
  - [ ] server validation errors render in the correct UI locations
  - [ ] success state shows persisted data, not optimistic placeholder data
- [ ] Lookup:
  - [ ] valid token
  - [ ] expired token
  - [ ] revoked token
  - [ ] fallback request with valid pair
  - [ ] fallback request with invalid pair
  - [ ] rate-limited fallback abuse
  - [ ] no account-enumeration leakage in responses
  - [ ] invalid/expired token state offers the correct recovery CTA
  - [ ] fully paid, outstanding, and free-registration data states render correctly
- [ ] Payments/admin:
  - [ ] staff login allowlist enforcement
  - [ ] manual payment updates pending to partial to complete
  - [ ] overpayment flow
  - [ ] duplicate Zeffy import row idempotence
  - [ ] unmatched pledge code preview
  - [ ] refunded/cancelled Zeffy rows skipped
  - [ ] report totals equal payment-event sums
  - [ ] empty, loading, success, and partial-failure admin states render correctly
- [ ] Reminders:
  - [ ] unauthorized cron rejected
  - [ ] authorized cron sends only to outstanding balances
  - [ ] no duplicate reminder in one cycle
- [ ] Site quality:
  - [ ] keyboard navigation through all registration steps
  - [ ] screen-reader-readable labels/errors
  - [ ] Lighthouse/axe checks for metadata, contrast, and basic accessibility
  - [ ] `robots.txt`, `sitemap.xml`, canonical, and OG tags present in production output
  - [ ] typography hierarchy is readable and consistent across form, summary, table, empty, and error states
- [ ] Minimal E2E coverage:
  - [ ] one happy-path new registration flow
  - [ ] one returning-registrant token lookup/recovery flow
  - [ ] one admin-side payment or import flow
- [ ] Explicitly defer as non-launch-critical:
  - [ ] broad visual regression coverage
  - [ ] large snapshot-based UI test suites
  - [ ] exhaustive page-by-page browser automation

## Assumptions and Fixed Defaults

- Payment authority for production launch is `Manual Reconciliation v1`: Zeffy and Zelle remain manual until staff import/entry confirms payment.
- Returning registrant access uses `Tokenized Self-Serve`: emailed signed links are primary; code+email is fallback only to request a fresh link.
- Legal/compliance target is `Launch Baseline`, not counsel-led redrafting.
- Staff authentication uses Supabase Auth magic-link plus an email allowlist; shared PIN auth is removed.
- Pricing and registration date cutoffs are computed server-side in `America/Chicago`.
- The public marketing frontend remains on Vercel and continues to use the current single-page site structure unless a later implementation step makes file splitting necessary.
- “Vercel server-side functions/route handlers” is the required backend constraint; this plan does not require a Next.js Server Actions rewrite.
- Local development uses a Supabase CLI-managed instance as the source of truth for migrations, seeds, and integration testing before deploying to shared environments.
