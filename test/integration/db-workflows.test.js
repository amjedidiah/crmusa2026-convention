/**
 * Opt-in DB integration tests (Supabase REST + RPC via service role).
 * Does not invoke Vercel route handlers or staff JWT auth.
 *
 * Run: RUN_INTEGRATION=1 npm run test:integration
 * Requires: migrations + seed, `.env.local` with SUPABASE_URL, SUPABASE_SERVICE_KEY, LOOKUP_TOKEN_SECRET.
 *
 * For HTTP-level checks against a running app, use: SMOKE_BASE_URL=… npm run test:smoke-http
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import '../load-env.mjs';

import { staffApplyRegistrationPayment } from '../../api/_lib/apply-payment.js';
import { createLookupToken, verifyLookupToken } from '../../api/_lib/tokens.js';
import { supabaseRestRequest } from '../../api/_lib/supabase.js';

const RUN = process.env.RUN_INTEGRATION === '1';
const SEED_PENDING_ID = '11111111-1111-1111-1111-111111111111';
const SEED_PARTIAL_ID = '33333333-3333-3333-3333-333333333333';
const INTEGRATION_MANUAL_REF = 'integration-static-test-ref';
const INTEGRATION_OVERPAY_REF = 'integration-overpay-test-ref';
const INTEGRATION_TWO_STEP_REF_A = 'integration-two-step-a';
const INTEGRATION_TWO_STEP_REF_B = 'integration-two-step-b';
const INTEGRATION_PARTIAL_TOPUP_REF = 'integration-partial-topup';
const INTEGRATION_ALLOW_OVERPAY_REF = 'integration-allow-overpay-ref';

function requireEnvOrSkip() {
  if (!RUN) return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.warn('SKIP integration: SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
    return false;
  }
  if (!process.env.LOOKUP_TOKEN_SECRET) {
    console.warn('SKIP integration: LOOKUP_TOKEN_SECRET not set');
    return false;
  }
  return true;
}

async function resetSeedPendingRegistration() {
  const pendingIntegrationRefs = [
    INTEGRATION_MANUAL_REF,
    INTEGRATION_OVERPAY_REF,
    INTEGRATION_TWO_STEP_REF_A,
    INTEGRATION_TWO_STEP_REF_B,
    INTEGRATION_ALLOW_OVERPAY_REF,
  ];
  for (const ref of pendingIntegrationRefs) {
    await supabaseRestRequest(
      'DELETE',
      `registration_payments?registration_id=eq.${SEED_PENDING_ID}&external_ref=eq.${encodeURIComponent(ref)}`
    );
  }
  await supabaseRestRequest('PATCH', `registrations?id=eq.${SEED_PENDING_ID}`, {
    body: {
      amount_paid_cents: 0,
      status: 'pending',
    },
    headers: { Prefer: 'return=minimal' },
  });
}

async function resetSeedPartialRegistration() {
  await supabaseRestRequest(
    'DELETE',
    `registration_payments?registration_id=eq.${SEED_PARTIAL_ID}&external_ref=eq.${encodeURIComponent(INTEGRATION_PARTIAL_TOPUP_REF)}`
  );
  await supabaseRestRequest('PATCH', `registrations?id=eq.${SEED_PARTIAL_ID}`, {
    body: {
      amount_paid_cents: 20000,
      status: 'partial',
    },
    headers: { Prefer: 'return=minimal' },
  });
}

async function fetchRegistrationRow(id) {
  const r = await supabaseRestRequest(
    'GET',
    `registrations?id=eq.${id}&select=id,total_cents,amount_paid_cents,status&limit=1`
  );
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.data) && r.data[0]);
  return r.data[0];
}

test(
  'integration: registration row + lookup token version match',
  { skip: !requireEnvOrSkip() },
  async () => {
    const get = await supabaseRestRequest(
      'GET',
      `registrations?id=eq.${SEED_PENDING_ID}&select=id,lookup_token_version,pledge_code`
    );
    assert.equal(get.ok, true);
    const row = get.data[0];
    const token = createLookupToken(
      {
        registration_id: row.id,
        lookup_token_version: row.lookup_token_version,
      },
      { secret: process.env.LOOKUP_TOKEN_SECRET }
    );
    const v = verifyLookupToken(token, { secret: process.env.LOOKUP_TOKEN_SECRET });
    assert.equal(v.valid, true);
  }
);

test(
  'integration: staff_apply_registration_payment and duplicate_external_ref',
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPendingRegistration();

    const first = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: 'zelle_manual',
      externalRef: INTEGRATION_MANUAL_REF,
      amountCents: 100,
      receivedAt: '2026-05-01T12:00:00.000Z',
      notes: 'integration test',
      rawPayload: { test: true },
      createdBy: 'integration-test',
      allowOverpayment: false,
    });

    assert.equal(first.ok, true);
    const payload = Array.isArray(first.data) ? first.data[0] : first.data;
    assert.ok(payload.payment_id);
    assert.equal(payload.amount_paid_cents, 100);

    const second = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: 'zelle_manual',
      externalRef: INTEGRATION_MANUAL_REF,
      amountCents: 100,
      receivedAt: '2026-05-01T12:00:00.000Z',
      notes: 'duplicate',
      rawPayload: { test: true },
      createdBy: 'integration-test',
      allowOverpayment: false,
    });

    assert.equal(second.ok, false);
    const msg = typeof second.data === 'string' ? second.data : second.data?.message || '';
    assert.match(msg, /duplicate_external_ref/i);

    await resetSeedPendingRegistration();
  }
);

test(
  'integration: overpayment rejected unless RPC allow flag',
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPendingRegistration();

    const over = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: 'zelle_manual',
      externalRef: INTEGRATION_OVERPAY_REF,
      amountCents: 99999999,
      receivedAt: '2026-05-02T12:00:00.000Z',
      notes: 'integration overpay attempt',
      rawPayload: { test: true },
      createdBy: 'integration-test',
      allowOverpayment: false,
    });

    assert.equal(over.ok, false);
    const msg = typeof over.data === 'string' ? over.data : over.data?.message || '';
    assert.match(msg, /overpayment_not_allowed/i);

    await resetSeedPendingRegistration();
  }
);

test(
  'integration: pending → partial → complete via two RPC calls',
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPendingRegistration();

    const row0 = await fetchRegistrationRow(SEED_PENDING_ID);
    assert.equal(row0.total_cents, 40000);
    assert.equal(row0.amount_paid_cents, 0);
    assert.equal(row0.status, 'pending');

    const first = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: 'zelle_manual',
      externalRef: INTEGRATION_TWO_STEP_REF_A,
      amountCents: 15000,
      receivedAt: '2026-05-10T10:00:00.000Z',
      notes: 'integration partial payment',
      rawPayload: { step: 1 },
      createdBy: 'integration-test',
      allowOverpayment: false,
    });
    assert.equal(first.ok, true);
    const p1 = Array.isArray(first.data) ? first.data[0] : first.data;
    assert.equal(p1.status, 'partial');
    assert.equal(p1.amount_paid_cents, 15000);
    assert.equal(p1.remaining_cents, 25000);

    const row1 = await fetchRegistrationRow(SEED_PENDING_ID);
    assert.equal(row1.amount_paid_cents, 15000);
    assert.equal(row1.status, 'partial');

    const second = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: 'zeffy',
      externalRef: INTEGRATION_TWO_STEP_REF_B,
      amountCents: 25000,
      receivedAt: '2026-05-11T11:00:00.000Z',
      notes: 'integration final payment',
      rawPayload: { step: 2 },
      createdBy: 'integration-test',
      allowOverpayment: false,
    });
    assert.equal(second.ok, true);
    const p2 = Array.isArray(second.data) ? second.data[0] : second.data;
    assert.equal(p2.status, 'complete');
    assert.equal(p2.amount_paid_cents, 40000);
    assert.equal(p2.remaining_cents, 0);

    const row2 = await fetchRegistrationRow(SEED_PENDING_ID);
    assert.equal(row2.amount_paid_cents, 40000);
    assert.equal(row2.status, 'complete');

    await resetSeedPendingRegistration();
  }
);

test(
  'integration: partial seed row → complete with one RPC (exact balance)',
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPartialRegistration();

    const before = await fetchRegistrationRow(SEED_PARTIAL_ID);
    assert.equal(before.total_cents, 60000);
    assert.equal(before.amount_paid_cents, 20000);
    assert.equal(before.status, 'partial');

    const applied = await staffApplyRegistrationPayment({
      registrationId: SEED_PARTIAL_ID,
      source: 'zelle_manual',
      externalRef: INTEGRATION_PARTIAL_TOPUP_REF,
      amountCents: 40000,
      receivedAt: '2026-05-12T12:00:00.000Z',
      notes: 'integration pay remainder',
      rawPayload: { phase: 'partial_to_complete' },
      createdBy: 'integration-test',
      allowOverpayment: false,
    });
    assert.equal(applied.ok, true);
    const payload = Array.isArray(applied.data) ? applied.data[0] : applied.data;
    assert.equal(payload.status, 'complete');
    assert.equal(payload.amount_paid_cents, 60000);
    assert.equal(payload.remaining_cents, 0);

    const after = await fetchRegistrationRow(SEED_PARTIAL_ID);
    assert.equal(after.amount_paid_cents, 60000);
    assert.equal(after.status, 'complete');

    await resetSeedPartialRegistration();
  }
);

test(
  'integration: overpayment allowed when RPC flag is true',
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPendingRegistration();

    const applied = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: 'zelle_manual',
      externalRef: INTEGRATION_ALLOW_OVERPAY_REF,
      amountCents: 45000,
      receivedAt: '2026-05-13T13:00:00.000Z',
      notes: 'integration intentional overpay',
      rawPayload: { allow_overpay: true },
      createdBy: 'integration-test',
      allowOverpayment: true,
    });
    assert.equal(applied.ok, true);
    const payload = Array.isArray(applied.data) ? applied.data[0] : applied.data;
    assert.equal(payload.status, 'complete');
    assert.equal(payload.amount_paid_cents, 45000);
    assert.equal(payload.total_cents, 40000);
    assert.equal(payload.remaining_cents, 0);

    const row = await fetchRegistrationRow(SEED_PENDING_ID);
    assert.equal(row.amount_paid_cents, 45000);
    assert.equal(row.status, 'complete');

    await resetSeedPendingRegistration();
  }
);

test(
  'integration: reminder query scope (pending/partial)',
  { skip: !requireEnvOrSkip() },
  async () => {
    const res = await supabaseRestRequest(
      'GET',
      'registrations?status=in.(pending,partial)&select=id,status,total_cents,amount_paid_cents,last_reminder_at&limit=5'
    );
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.data));
  }
);
