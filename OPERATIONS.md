# Operations runbook (CRM USA 2026 convention backend)

This document complements [README.md](./README.md) for production and on-call tasks.

## Structured logs

Server routes emit **one JSON object per line** to stdout/stderr (searchable in Vercel logs or any log drain). Common fields:

| Field | Meaning |
| ----- | ------- |
| `ts` | ISO timestamp |
| `level` | `info`, `warn`, or `error` |
| `event` | Stable dot-separated name (for example `register.persisted`, `payment.manual_applied`) |
| `route` | HTTP path or logical module |
| `registration_id` | UUID when known |
| `payment_id` | UUID from `staff_apply_registration_payment` when a row was inserted |
| `payment_external_ref` | Idempotency key (`source` + `external_ref` in DB) when `payment_id` is not yet known or for context |
| `detail` | Short non-PII diagnostic (errors); truncate upstream bodies here |

**Do not** rely on logs for PII; registrant email appears only in legacy reminder failure payloads—prefer registration id when investigating.

## Registration failures

1. Check Vercel logs for `register.save_failed` (database / validation from PostgREST) vs `register.persisted` (row created).
2. If `register.persisted` appears but `confirm.registration_email_failed` follows, the row exists; use Supabase Studio or `GET /api/admin/registrations` (staff) to confirm and resend instructions manually if needed.
3. Duplicate pledge codes are retried server-side; sustained failures indicate DB connectivity or constraint issues—check Supabase status and migrations.

## Email delivery failures

1. Confirm `RESEND_API_KEY` and domain verification in Resend.
2. Search logs for `confirm.registration_email_failed`, `confirm.lookup_link_email_sent`, `lookup_request.email_failed`, `remind.email_send_failed`.
3. Registration and lookup-request endpoints are designed to **return success to the client** after persistence even when email fails; treat missing email as an ops follow-up, not a silent user failure.

## Zeffy import mismatches

1. Always run **preview** before apply; review flags `unmatched`, `duplicate`, `overpayment`, skipped refunds.
2. Unmatched pledge codes: verify the CSV column maps to pledge codes as exported; normalize spelling with the registrant and correct the CSV or registration record before re-preview.
3. Duplicates: `external_ref` already posted — safe to skip; investigate accidental double export from Zeffy.
4. Overpayments: require explicit staff confirmation in the admin UI / `confirm_overpayment` on apply.

## Manual payment corrections

1. Prefer recording **adjustment** payments with clear `notes` and a fresh `external_ref` rather than editing rows by hand (service role only).
2. If aggregates drift from payment rows, restore from `registration_payments` sums and fix with a controlled SQL fix in Supabase (maintenance window), not from the public site.

## Reminder job failures

1. Cron hits `GET /api/remind` with `Authorization: Bearer $CRON_SECRET` (see `vercel.json` schedule).
2. **`RESEND_API_KEY` must be set** before the job queries registrants. If it is missing, the handler returns **500** once with `remind.resend_not_configured` in logs (fail-fast). This avoids querying Supabase and then failing each send with `Bearer undefined`.
3. Logs: `remind.supabase_query_failed`, `remind.email_send_failed`, `remind.last_reminder_stamp_failed`, `remind.batch_complete`.
4. If email succeeds but `last_reminder_stamp_failed`, the same registrant may receive duplicate reminders next cycle—PATCH `last_reminder_at` manually if needed after fixing permissions/network.

## Database backups

Hosted Supabase: enable **Point-in-time recovery** / automated backups per your Supabase plan; document the restore procedure for your org. This repo does not automate backups.

## Pre-launch smoke checklist

Automated **HTTP smoke** (status codes only): `SMOKE_BASE_URL=https://… npm run test:smoke-http` (see `test/smoke-http.mjs`).

Run manual checks against **staging** or production after deploy:

- [ ] **Register**: submit a test registration; receive 201 and correct pledge code; optional email received.
- [ ] **Lookup**: open emailed lookup link (`/#return?token=...`); summary matches DB.
- [ ] **Lookup recovery**: `POST /api/lookup-request` with test email + pledge; generic JSON response; email received.
- [ ] **Staff auth**: magic link sign-in on `admin-sync.html`; non-allowlisted email rejected on API.
- [ ] **Manual payment**: record a small test payment; balances and status update.
- [ ] **Zeffy**: preview sample CSV; apply one approved row; idempotent re-apply skips duplicate `external_ref`.
- [ ] **Reminders**: call `/api/remind` with valid secret; 401 without secret; authorized call returns JSON summary.

After smoke tests on shared environments, reset or void test registrations as appropriate.
