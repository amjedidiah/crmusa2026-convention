/**
 * Opt-in DB integration tests (Supabase REST + RPC via service role).
 * Most tests hit REST/RPC directly; register persistence exercises /api/register
 * against the same local Supabase instance with Resend mocked.
 *
 * Run: RUN_INTEGRATION=1 bun run test:integration
 * Requires: migrations + seed, `.env.local` with SUPABASE_URL, SUPABASE_SERVICE_KEY, LOOKUP_TOKEN_SECRET,
 * and a **reachable** Supabase API (e.g. `supabase start` for local :54321).
 *
 * If every test is skipped with "cannot reach Supabase", start Docker + run `supabase start`.
 *
 * For HTTP-level checks against a running app, use: SMOKE_BASE_URL=… bun run test:smoke-http
 */

import assert from "node:assert/strict";
import test from "node:test";
import { consola } from "consola";

import "../load-env.mjs";

import registerHandler from "../../api/register.js";
import resendConfirmationHandler from "../../api/resend-confirmation.js";
import { staffApplyRegistrationPayment } from "../../api/_lib/apply-payment.js";
import {
  activeTierForDate,
  calculateRegistrationTotalCents,
} from "../../api/_lib/registration.js";
import { createLookupToken, verifyLookupToken } from "../../api/_lib/tokens.js";
import { supabaseRestRequest } from "../../api/_lib/supabase.js";

const RUN = process.env.RUN_INTEGRATION === "1";

/** Set true only after a successful lightweight REST probe (see preflight below). */
let integrationSupabaseReachable = false;

async function runIntegrationPreflight() {
  if (!RUN) return;
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_KEY ||
    !process.env.LOOKUP_TOKEN_SECRET
  ) {
    return;
  }
  try {
    const r = await supabaseRestRequest("GET", "registrations?select=id&limit=1", {
      timeoutMs: 4000,
    });
    if (r.ok) {
      integrationSupabaseReachable = true;
      return;
    }
    consola.warn(
      `SKIP integration: Supabase HTTP ${r.status} — check SUPABASE_URL and SUPABASE_SERVICE_KEY`,
    );
  } catch (e) {
    const code = e?.cause?.code ?? e?.code;
    const name = e?.name;
    if (name === "AbortError") {
      consola.warn(
        "SKIP integration: Supabase request timed out — is the API up?",
      );
      return;
    }
    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      consola.warn(
        `SKIP integration: cannot reach Supabase (${code} at ${process.env.SUPABASE_URL}). Run \`supabase start\` or fix SUPABASE_URL.`,
      );
      return;
    }
    consola.warn(
      `SKIP integration: Supabase probe error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

await runIntegrationPreflight();
const SEED_PENDING_ID = "11111111-1111-1111-1111-111111111111";
const SEED_PARTIAL_ID = "33333333-3333-3333-3333-333333333333";
const INTEGRATION_MANUAL_REF = "integration-static-test-ref";
const INTEGRATION_OVERPAY_REF = "integration-overpay-test-ref";
const INTEGRATION_TWO_STEP_REF_A = "integration-two-step-a";
const INTEGRATION_TWO_STEP_REF_B = "integration-two-step-b";
const INTEGRATION_PARTIAL_TOPUP_REF = "integration-partial-topup";
const INTEGRATION_ALLOW_OVERPAY_REF = "integration-allow-overpay-ref";

function requireEnvOrSkip() {
  if (!RUN) return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    consola.warn(
      "SKIP integration: SUPABASE_URL / SUPABASE_SERVICE_KEY not set",
    );
    return false;
  }
  if (!process.env.LOOKUP_TOKEN_SECRET) {
    consola.warn("SKIP integration: LOOKUP_TOKEN_SECRET not set");
    return false;
  }
  if (!integrationSupabaseReachable) {
    return false;
  }
  return true;
}

function createMockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };
}

/** Resolve `fetch` first argument to a URL string for Resend interception. */
function fetchInputToUrlString(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url;
}

async function withMockedResend(run) {
  const originalFetch = globalThis.fetch;
  const resendCalls = [];
  globalThis.fetch = async function mockFetch(input, init) {
    const url = fetchInputToUrlString(input);
    if (url === "https://api.resend.com/emails") {
      resendCalls.push(init?.body ? JSON.parse(init.body) : {});
      return new Response(
        JSON.stringify({ id: `re_mock_${resendCalls.length}` }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return originalFetch(input, init);
  };
  try {
    return await run(resendCalls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function deleteRegistrationIfPresent(id) {
  if (!id) return;
  const dr = await supabaseRestRequest(
    "DELETE",
    `registrations?id=eq.${encodeURIComponent(id)}`,
  );
  assert.ok(
    dr.ok,
    `cleanup DELETE failed for registration ${id}: ${JSON.stringify(dr.data)}`,
  );
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
    const dr = await supabaseRestRequest(
      "DELETE",
      `registration_payments?registration_id=eq.${SEED_PENDING_ID}&external_ref=eq.${encodeURIComponent(ref)}`,
    );
    assert.ok(
      dr.ok,
      `reset DELETE failed for ref ${ref}: ${JSON.stringify(dr.data)}`,
    );
  }
  const pr = await supabaseRestRequest(
    "PATCH",
    `registrations?id=eq.${SEED_PENDING_ID}`,
    {
      body: {
        amount_paid_cents: 0,
        status: "pending",
      },
      headers: { Prefer: "return=minimal" },
    },
  );
  assert.ok(pr.ok, `reset PATCH failed: ${JSON.stringify(pr.data)}`);
}

async function resetSeedPartialRegistration() {
  const dr = await supabaseRestRequest(
    "DELETE",
    `registration_payments?registration_id=eq.${SEED_PARTIAL_ID}&external_ref=eq.${encodeURIComponent(INTEGRATION_PARTIAL_TOPUP_REF)}`,
  );
  assert.ok(dr.ok, `reset partial DELETE failed: ${JSON.stringify(dr.data)}`);
  const pr = await supabaseRestRequest(
    "PATCH",
    `registrations?id=eq.${SEED_PARTIAL_ID}`,
    {
      body: {
        amount_paid_cents: 20000,
        status: "partial",
      },
      headers: { Prefer: "return=minimal" },
    },
  );
  assert.ok(pr.ok, `reset partial PATCH failed: ${JSON.stringify(pr.data)}`);
}

async function fetchRegistrationRow(id) {
  const r = await supabaseRestRequest(
    "GET",
    `registrations?id=eq.${id}&select=id,total_cents,amount_paid_cents,status&limit=1`,
  );
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.data) && r.data[0]);
  return r.data[0];
}

test(
  "integration: registration row + lookup token version match",
  { skip: !requireEnvOrSkip() },
  async () => {
    const get = await supabaseRestRequest(
      "GET",
      `registrations?id=eq.${SEED_PENDING_ID}&select=id,lookup_token_version,pledge_code`,
    );
    assert.equal(get.ok, true);
    const row = get.data[0];
    const token = createLookupToken(
      {
        registration_id: row.id,
        lookup_token_version: row.lookup_token_version,
      },
      { secret: process.env.LOOKUP_TOKEN_SECRET },
    );
    const v = verifyLookupToken(token, {
      secret: process.env.LOOKUP_TOKEN_SECRET,
    });
    assert.equal(v.valid, true);
  },
);

test(
  "integration: POST /api/register persists registration with expected pledge code / totals",
  { skip: !requireEnvOrSkip() },
  async () => {
    const attendees = [
      { name: "Integration Adult", age: 40 },
      { name: "Integration Child", age: 9 },
    ];
    const expectedTier = activeTierForDate();
    const expectedTotal = calculateRegistrationTotalCents(
      attendees,
      expectedTier,
    );
    const uniqueEmail = `integration.register.${Date.now()}@example.com`;
    const prevSiteUrl = process.env.SITE_URL;
    const prevResendKey = process.env.RESEND_API_KEY;
    let insertedId = null;
    let responseBody = null;

    process.env.SITE_URL = "https://integration.example.test";
    process.env.RESEND_API_KEY = "integration-resend-key";

    try {
      await withMockedResend(async (resendCalls) => {
        const req = {
          method: "POST",
          headers: {},
          body: {
            contact: {
              first_name: "Integration",
              last_name: "Register",
              email: uniqueEmail,
              phone: "555-0199",
              church: "Integration Chapel",
              city: "Houston",
            },
            attendees,
            payment_intent_cents: 0,
          },
        };
        const res = createMockRes();

        await registerHandler(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body?.ok, true);
        assert.equal(res.body?.registration?.tier, expectedTier);
        assert.equal(res.body?.registration?.total_cents, expectedTotal);
        assert.equal(res.body?.registration?.amount_paid_cents, 0);
        assert.equal(res.body?.registration?.remaining_cents, expectedTotal);
        assert.equal(res.body?.registration?.status, "pending");
        assert.match(
          res.body?.registration?.pledge_code,
          /^[A-HJ-NP-Z2-9]{6}$/,
        );
        assert.match(
          res.body?.registration?.lookup_url,
          /^https:\/\/integration\.example\.test\/#return\?token=/,
        );
        assert.equal(res.body?.email?.confirm_sent, true);
        assert.equal(res.body?.email?.notification_sent, true);
        assert.equal(resendCalls.length, 2);
        assert.ok(
          resendCalls.some(
            (call) => Array.isArray(call.to) && call.to.includes(uniqueEmail),
          ),
        );

        insertedId = res.body.registration.id;
        responseBody = res.body;
      });

      const persisted = await supabaseRestRequest(
        "GET",
        `registrations?id=eq.${encodeURIComponent(insertedId)}&select=id,pledge_code,first_name,last_name,email,email_normalized,tier,total_cents,amount_paid_cents,status,lookup_token_version,attendees_json,metadata&limit=1`,
      );
      assert.equal(persisted.ok, true);
      const row = persisted.data?.[0];
      assert.ok(row);
      assert.equal(row.email, uniqueEmail);
      assert.equal(row.email_normalized, uniqueEmail);
      assert.equal(row.tier, expectedTier);
      assert.equal(row.total_cents, expectedTotal);
      assert.equal(row.amount_paid_cents, 0);
      assert.equal(row.status, "pending");
      assert.equal(row.lookup_token_version, 1);
      assert.equal(row.metadata?.source, "public-site");
      assert.equal(row.metadata?.payment_intent_cents, 0);
      assert.ok(typeof row.metadata?.payment_intent_submitted_at === "string");
      assert.deepEqual(row.attendees_json, attendees);

      const tokenRaw = String(
        responseBody?.registration?.lookup_url || "",
      ).split("#return?token=")[1];
      assert.ok(tokenRaw, "lookup token should be present in lookup_url");
      const verified = verifyLookupToken(decodeURIComponent(tokenRaw), {
        secret: process.env.LOOKUP_TOKEN_SECRET,
      });
      assert.equal(verified.valid, true);
      assert.equal(verified.payload.registration_id, insertedId);
      assert.equal(
        verified.payload.lookup_token_version,
        row.lookup_token_version,
      );
    } finally {
      if (prevSiteUrl === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = prevSiteUrl;
      if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevResendKey;
      await deleteRegistrationIfPresent(insertedId);
    }
  },
);

test(
  "integration: POST /api/register rejects duplicate email with contact gate",
  { skip: !requireEnvOrSkip() },
  async () => {
    const attendees = [{ name: "Dup Email Person", age: 40 }];
    const uniqueEmail = `integration.dupemail.${Date.now()}@example.com`;
    const sharedPhone = "555-200-0001";
    const prevSiteUrl = process.env.SITE_URL;
    const prevResendKey = process.env.RESEND_API_KEY;
    let firstId = null;

    process.env.SITE_URL = "https://integration.example.test";
    process.env.RESEND_API_KEY = "integration-resend-key";

    try {
      await withMockedResend(async () => {
        const req1 = {
          method: "POST",
          headers: {},
          body: {
            contact: {
              first_name: "First",
              last_name: "Submit",
              email: uniqueEmail,
              phone: sharedPhone,
              church: "Chapel",
              city: "Houston",
            },
            attendees,
            payment_intent_cents: 0,
          },
        };
        const res1 = createMockRes();
        await registerHandler(req1, res1);
        assert.equal(res1.statusCode, 201);
        firstId = res1.body?.registration?.id;

        const req2 = {
          method: "POST",
          headers: {},
          body: {
            contact: {
              first_name: "Second",
              last_name: "Submit",
              email: uniqueEmail,
              phone: "555-200-0002",
              church: "Chapel",
              city: "Dallas",
            },
            attendees,
            payment_intent_cents: 0,
          },
        };
        const res2 = createMockRes();
        await registerHandler(req2, res2);
        assert.equal(res2.statusCode, 400);
        assert.equal(res2.body?.ok, false);
        assert.equal(res2.body?.step, "contact");
        assert.ok(res2.body?.fieldErrors?.email);
      });
    } finally {
      if (prevSiteUrl === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = prevSiteUrl;
      if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevResendKey;
      await deleteRegistrationIfPresent(firstId);
    }
  },
);

test(
  "integration: POST /api/register rejects duplicate normalized phone",
  { skip: !requireEnvOrSkip() },
  async () => {
    const attendees = [{ name: "Dup Phone Person", age: 40 }];
    const email1 = `integration.dupphone.a.${Date.now()}@example.com`;
    const email2 = `integration.dupphone.b.${Date.now()}@example.com`;
    const prevSiteUrl = process.env.SITE_URL;
    const prevResendKey = process.env.RESEND_API_KEY;
    let firstId = null;

    process.env.SITE_URL = "https://integration.example.test";
    process.env.RESEND_API_KEY = "integration-resend-key";

    try {
      await withMockedResend(async () => {
        const req1 = {
          method: "POST",
          headers: {},
          body: {
            contact: {
              first_name: "A",
              last_name: "Phone",
              email: email1,
              phone: "+1 (555) 201-3344",
              church: "Chapel",
              city: "Houston",
            },
            attendees,
            payment_intent_cents: 0,
          },
        };
        const res1 = createMockRes();
        await registerHandler(req1, res1);
        assert.equal(res1.statusCode, 201);
        firstId = res1.body?.registration?.id;

        const req2 = {
          method: "POST",
          headers: {},
          body: {
            contact: {
              first_name: "B",
              last_name: "Phone",
              email: email2,
              phone: "5552013344",
              church: "Chapel",
              city: "Dallas",
            },
            attendees,
            payment_intent_cents: 0,
          },
        };
        const res2 = createMockRes();
        await registerHandler(req2, res2);
        assert.equal(res2.statusCode, 400);
        assert.equal(res2.body?.ok, false);
        assert.equal(res2.body?.step, "contact");
        assert.ok(res2.body?.fieldErrors?.phone);
      });
    } finally {
      if (prevSiteUrl === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = prevSiteUrl;
      if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevResendKey;
      await deleteRegistrationIfPresent(firstId);
    }
  },
);

test(
  "integration: POST /api/register stores payment_intent_cents and references it in confirmation email",
  { skip: !requireEnvOrSkip() },
  async () => {
    const attendees = [
      { name: "Intent Adult", age: 40 },
      { name: "Intent Child", age: 9 },
    ];
    const expectedTier = activeTierForDate();
    const expectedTotal = calculateRegistrationTotalCents(
      attendees,
      expectedTier,
    );
    const paymentIntentCents = Math.min(15_000, expectedTotal);
    const intentUsd = (paymentIntentCents / 100).toFixed(2);
    const uniqueEmail = `integration.intent.${Date.now()}@example.com`;
    const prevSiteUrl = process.env.SITE_URL;
    const prevResendKey = process.env.RESEND_API_KEY;
    let insertedId = null;

    process.env.SITE_URL = "https://integration.example.test";
    process.env.RESEND_API_KEY = "integration-resend-key";

    try {
      await withMockedResend(async (resendCalls) => {
        const req = {
          method: "POST",
          headers: {},
          body: {
            contact: {
              first_name: "Intent",
              last_name: "Pay",
              email: uniqueEmail,
              phone: "555-0100",
              church: "Integration Chapel",
              city: "Houston",
            },
            attendees,
            payment_intent_cents: paymentIntentCents,
          },
        };
        const res = createMockRes();
        await registerHandler(req, res);
        assert.equal(res.statusCode, 201);
        assert.equal(res.body?.email?.confirm_sent, true);
        insertedId = res.body.registration.id;

        const registrantCall = resendCalls.find(
          (c) => Array.isArray(c.to) && c.to.includes(uniqueEmail),
        );
        assert.ok(registrantCall?.html);
        assert.ok(
          registrantCall.html.includes(`$${intentUsd}`),
          "confirmation HTML should mention stated pay-today amount",
        );
        assert.ok(
          /not[\s\S]*recorded until staff reconcile Zelle or Zeffy/i.test(
            registrantCall.html,
          ),
          "confirmation HTML should clarify intent is not yet posted",
        );
      });

      const persisted = await supabaseRestRequest(
        "GET",
        `registrations?id=eq.${encodeURIComponent(insertedId)}&select=metadata&limit=1`,
      );
      assert.equal(persisted.ok, true);
      assert.equal(
        persisted.data?.[0]?.metadata?.payment_intent_cents,
        paymentIntentCents,
      );
    } finally {
      if (prevSiteUrl === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = prevSiteUrl;
      if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevResendKey;
      await deleteRegistrationIfPresent(insertedId);
    }
  },
);

test(
  "integration: POST /api/resend-confirmation sends one registrant email (no staff notification)",
  { skip: !requireEnvOrSkip() },
  async () => {
    const attendees = [{ name: "Resend Solo", age: 40 }];
    const uniqueEmail = `integration.resend.${Date.now()}@example.com`;
    const prevSiteUrl = process.env.SITE_URL;
    const prevResendKey = process.env.RESEND_API_KEY;
    let insertedId = null;
    let pledgeCode = null;

    process.env.SITE_URL = "https://integration.example.test";
    process.env.RESEND_API_KEY = "integration-resend-key";

    try {
      await withMockedResend(async () => {
        const req = {
          method: "POST",
          headers: {},
          body: {
            contact: {
              first_name: "Resend",
              last_name: "Test",
              email: uniqueEmail,
              phone: "555-0101",
              church: "Integration Chapel",
              city: "Houston",
            },
            attendees,
            payment_intent_cents: 0,
          },
        };
        const res = createMockRes();
        await registerHandler(req, res);
        assert.equal(res.statusCode, 201);
        insertedId = res.body.registration.id;
        pledgeCode = res.body.registration.pledge_code;
      });

      await withMockedResend(async (calls) => {
        const res = createMockRes();
        await resendConfirmationHandler(
          {
            method: "POST",
            headers: {},
            body: {
              email: uniqueEmail,
              pledge_code: pledgeCode,
            },
          },
          res,
        );
        assert.equal(res.statusCode, 200);
        assert.equal(res.body?.ok, true);
        assert.ok(String(res.body?.message).length > 20);
        assert.equal(calls.length, 1);
        const to = calls[0].to;
        const toList = Array.isArray(to) ? to : [to];
        assert.ok(toList.includes(uniqueEmail));
        assert.match(
          calls[0].subject || "",
          /Registration Confirmed/i,
          "expected registrant subject, not staff NEW REGISTRATION",
        );
        assert.doesNotMatch(calls[0].subject || "", /^NEW REGISTRATION:/);
      });
    } finally {
      if (prevSiteUrl === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = prevSiteUrl;
      if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevResendKey;
      await deleteRegistrationIfPresent(insertedId);
    }
  },
);

test(
  "integration: staff_apply_registration_payment and duplicate_external_ref",
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPendingRegistration();

    const first = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: "zelle_manual",
      externalRef: INTEGRATION_MANUAL_REF,
      amountCents: 100,
      receivedAt: "2026-05-01T12:00:00.000Z",
      notes: "integration test",
      rawPayload: { test: true },
      createdBy: "integration-test",
      createdByStaffUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdByStaffEmail: "integration.staff@example.com",
      allowOverpayment: false,
    });

    assert.equal(first.ok, true);
    const payload = Array.isArray(first.data) ? first.data[0] : first.data;
    assert.ok(payload.payment_id);
    assert.equal(payload.amount_paid_cents, 100);

    const paymentRow = await supabaseRestRequest(
      "GET",
      `registration_payments?registration_id=eq.${SEED_PENDING_ID}&external_ref=eq.${encodeURIComponent(INTEGRATION_MANUAL_REF)}&select=created_by,created_by_staff_user_id,created_by_staff_email,import_batch_id,source&limit=1`,
    );
    assert.equal(paymentRow.ok, true);
    assert.equal(paymentRow.data?.[0]?.created_by, "integration-test");
    assert.equal(
      paymentRow.data?.[0]?.created_by_staff_user_id,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    assert.equal(
      paymentRow.data?.[0]?.created_by_staff_email,
      "integration.staff@example.com",
    );
    assert.equal(paymentRow.data?.[0]?.import_batch_id, null);
    assert.equal(paymentRow.data?.[0]?.source, "zelle_manual");

    const second = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: "zelle_manual",
      externalRef: INTEGRATION_MANUAL_REF,
      amountCents: 100,
      receivedAt: "2026-05-01T12:00:00.000Z",
      notes: "duplicate",
      rawPayload: { test: true },
      createdBy: "integration-test",
      allowOverpayment: false,
    });

    assert.equal(second.ok, false);
    const msg =
      typeof second.data === "string"
        ? second.data
        : second.data?.message || "";
    assert.match(msg, /duplicate_external_ref/i);

    await resetSeedPendingRegistration();
  },
);

test(
  "integration: overpayment rejected unless RPC allow flag",
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPendingRegistration();

    const over = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: "zelle_manual",
      externalRef: INTEGRATION_OVERPAY_REF,
      amountCents: 99999999,
      receivedAt: "2026-05-02T12:00:00.000Z",
      notes: "integration overpay attempt",
      rawPayload: { test: true },
      createdBy: "integration-test",
      allowOverpayment: false,
    });

    assert.equal(over.ok, false);
    const msg =
      typeof over.data === "string" ? over.data : over.data?.message || "";
    assert.match(msg, /overpayment_not_allowed/i);

    await resetSeedPendingRegistration();
  },
);

test(
  "integration: pending → partial → complete via two RPC calls",
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPendingRegistration();

    const row0 = await fetchRegistrationRow(SEED_PENDING_ID);
    assert.equal(row0.total_cents, 30000);
    assert.equal(row0.amount_paid_cents, 0);
    assert.equal(row0.status, "pending");

    const first = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: "zelle_manual",
      externalRef: INTEGRATION_TWO_STEP_REF_A,
      amountCents: 15000,
      receivedAt: "2026-05-10T10:00:00.000Z",
      notes: "integration partial payment",
      rawPayload: { step: 1 },
      createdBy: "integration-test",
      allowOverpayment: false,
    });
    assert.equal(first.ok, true);
    const p1 = Array.isArray(first.data) ? first.data[0] : first.data;
    assert.equal(p1.status, "partial");
    assert.equal(p1.amount_paid_cents, 15000);
    assert.equal(p1.remaining_cents, 15000);

    const row1 = await fetchRegistrationRow(SEED_PENDING_ID);
    assert.equal(row1.amount_paid_cents, 15000);
    assert.equal(row1.status, "partial");

    const second = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: "zeffy",
      externalRef: INTEGRATION_TWO_STEP_REF_B,
      amountCents: 15000,
      receivedAt: "2026-05-11T11:00:00.000Z",
      notes: "integration final payment",
      rawPayload: { step: 2 },
      createdBy: "integration-test",
      allowOverpayment: false,
    });
    assert.equal(second.ok, true);
    const p2 = Array.isArray(second.data) ? second.data[0] : second.data;
    assert.equal(p2.status, "complete");
    assert.equal(p2.amount_paid_cents, 30000);
    assert.equal(p2.remaining_cents, 0);

    const row2 = await fetchRegistrationRow(SEED_PENDING_ID);
    assert.equal(row2.amount_paid_cents, 30000);
    assert.equal(row2.status, "complete");

    await resetSeedPendingRegistration();
  },
);

test(
  "integration: partial seed row → complete with one RPC (exact balance)",
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPartialRegistration();

    const before = await fetchRegistrationRow(SEED_PARTIAL_ID);
    assert.equal(before.total_cents, 90000);
    assert.equal(before.amount_paid_cents, 20000);
    assert.equal(before.status, "partial");

    const applied = await staffApplyRegistrationPayment({
      registrationId: SEED_PARTIAL_ID,
      source: "zelle_manual",
      externalRef: INTEGRATION_PARTIAL_TOPUP_REF,
      amountCents: 70000,
      receivedAt: "2026-05-12T12:00:00.000Z",
      notes: "integration pay remainder",
      rawPayload: { phase: "partial_to_complete" },
      createdBy: "integration-test",
      allowOverpayment: false,
    });
    assert.equal(applied.ok, true);
    const payload = Array.isArray(applied.data)
      ? applied.data[0]
      : applied.data;
    assert.equal(payload.status, "complete");
    assert.equal(payload.amount_paid_cents, 90000);
    assert.equal(payload.remaining_cents, 0);

    const after = await fetchRegistrationRow(SEED_PARTIAL_ID);
    assert.equal(after.amount_paid_cents, 90000);
    assert.equal(after.status, "complete");

    await resetSeedPartialRegistration();
  },
);

test(
  "integration: overpayment allowed when RPC flag is true",
  { skip: !requireEnvOrSkip() },
  async () => {
    await resetSeedPendingRegistration();

    const applied = await staffApplyRegistrationPayment({
      registrationId: SEED_PENDING_ID,
      source: "zelle_manual",
      externalRef: INTEGRATION_ALLOW_OVERPAY_REF,
      amountCents: 45000,
      receivedAt: "2026-05-13T13:00:00.000Z",
      notes: "integration intentional overpay",
      rawPayload: { allow_overpay: true },
      createdBy: "integration-test",
      allowOverpayment: true,
    });
    assert.equal(applied.ok, true);
    const payload = Array.isArray(applied.data)
      ? applied.data[0]
      : applied.data;
    assert.equal(payload.status, "complete");
    assert.equal(payload.amount_paid_cents, 45000);
    assert.equal(payload.total_cents, 30000);
    assert.equal(payload.remaining_cents, 0);

    const row = await fetchRegistrationRow(SEED_PENDING_ID);
    assert.equal(row.amount_paid_cents, 45000);
    assert.equal(row.status, "complete");

    await resetSeedPendingRegistration();
  },
);

test(
  "integration: reminder query scope (pending/partial)",
  { skip: !requireEnvOrSkip() },
  async () => {
    const res = await supabaseRestRequest(
      "GET",
      "registrations?status=in.(pending,partial)&select=id,status,total_cents,amount_paid_cents,last_reminder_at&limit=5",
    );
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.data));
  },
);
