import { sendConfirmationEmails } from './confirm.js';
import { RESEND_CONFIRMATION_GENERIC_MESSAGE } from './_lib/public-registration-messages.js';
import { normalizePledgeCode } from './_lib/pledge.js';
import { normalizeEmail, parseAttendeesFromColumn } from './_lib/registration.js';
import { enforceRateLimit, getResendConfirmationRateLimiter } from './_lib/rate-limit.js';
import { buildLookupUrlForRegistration } from './_lib/site.js';
import { supabaseRestRequest } from './_lib/supabase.js';
import { serverLog } from './_lib/server-log.js';

/** Same anti-enumeration contract as lookup-request.js — identical 200 body for all match outcomes. */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limited = await enforceRateLimit(req, getResendConfirmationRateLimiter);
  if (!limited.ok) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { email, pledge_code: pledgeCodeRaw } = req.body || {};
  const emailNormalized = normalizeEmail(email);
  const pledgeNormalized = normalizePledgeCode(pledgeCodeRaw);

  if (
    !emailNormalized ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalized) ||
    pledgeNormalized.length < 4 ||
    pledgeNormalized.length > 12
  ) {
    return res.status(200).json({ ok: true, message: RESEND_CONFIRMATION_GENERIC_MESSAGE });
  }

  const encEmail = encodeURIComponent(emailNormalized);
  const encPledge = encodeURIComponent(pledgeNormalized);
  const lookup = await supabaseRestRequest(
    'GET',
    'registrations?' +
      `email_normalized=eq.${encEmail}&pledge_code=eq.${encPledge}&select=` +
      'id,lookup_token_version,first_name,last_name,email,phone,church,tier,' +
      'total_cents,amount_paid_cents,pledge_code,attendees_json,metadata'
  );

  if (!lookup.ok || !Array.isArray(lookup.data) || lookup.data.length !== 1) {
    return res.status(200).json({ ok: true, message: RESEND_CONFIRMATION_GENERIC_MESSAGE });
  }

  const row = lookup.data[0];
  const lookupUrl = buildLookupUrlForRegistration(req, row);

  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const intentRaw = meta.payment_intent_cents;
  let paymentIntentCents = 0;
  if (intentRaw !== undefined && intentRaw !== null && intentRaw !== '') {
    const n = Number(intentRaw);
    if (Number.isFinite(n)) paymentIntentCents = Math.max(0, Math.floor(n));
  }

  const attendees = parseAttendeesFromColumn(row.attendees_json);
  const amountPaid = (Number(row.amount_paid_cents) || 0) / 100;

  try {
    await sendConfirmationEmails({
      registration_id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone: row.phone,
      church: row.church,
      pledge_code: row.pledge_code,
      tier: row.tier,
      total_pledged: (Number(row.total_cents) || 0) / 100,
      amount_paid: amountPaid,
      payment_intent_cents: paymentIntentCents,
      attendees,
      lookup_url: lookupUrl,
      include_staff_notification: false,
    });
  } catch (error) {
    serverLog('error', 'resend_confirmation.email_failed', {
      route: '/api/resend-confirmation',
      registration_id: row.id,
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
  }

  return res.status(200).json({ ok: true, message: RESEND_CONFIRMATION_GENERIC_MESSAGE });
}
