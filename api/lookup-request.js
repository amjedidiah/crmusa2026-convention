import { sendLookupLinkEmail } from './confirm.js';
import { serverLog } from './_lib/server-log.js';
import { normalizeEmail } from './_lib/registration.js';
import { enforceRateLimit, getLookupRequestRateLimiter } from './_lib/rate-limit.js';
import { buildLookupUrlForRegistration } from './_lib/site.js';
import { supabaseRestRequest } from './_lib/supabase.js';

/** Same copy for every outcome (anti-enumeration). Strong enough to act on without implying we confirmed a match. */
const GENERIC_MESSAGE =
  'If the email and pledge code you entered match a registration on file, we emailed a secure link to that address. ' +
  'Most messages arrive within a few minutes. Check inbox, spam, and promotions. ' +
  'Look for the subject line: "Your CRM 2026 registration link." ' +
  'If nothing arrives after about 15 minutes, try again or contact convention@crmusanational.org.';

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizePledgeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limited = await enforceRateLimit(req, getLookupRequestRateLimiter);
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
    return res.status(200).json({ ok: true, message: GENERIC_MESSAGE });
  }

  const encEmail = encodeURIComponent(emailNormalized);
  const encPledge = encodeURIComponent(pledgeNormalized);
  const lookup = await supabaseRestRequest(
    'GET',
    `registrations?email_normalized=eq.${encEmail}&pledge_code=eq.${encPledge}&select=id,lookup_token_version,first_name,email`
  );

  if (!lookup.ok || !Array.isArray(lookup.data) || lookup.data.length !== 1) {
    return res.status(200).json({ ok: true, message: GENERIC_MESSAGE });
  }

  const reg = lookup.data[0];
  const lookupUrl = buildLookupUrlForRegistration(req, reg);

  if (!lookupUrl) {
    serverLog('error', 'lookup_request.misconfigured', {
      route: '/api/lookup-request',
      registration_id: reg.id,
      detail: 'missing_site_url_or_lookup_secret',
    });
    return res.status(200).json({ ok: true, message: GENERIC_MESSAGE });
  }

  try {
    await sendLookupLinkEmail({
      email: reg.email,
      first_name: reg.first_name,
      lookup_url: lookupUrl,
      registration_id: reg.id,
    });
  } catch (firstError) {
    serverLog('warn', 'lookup_request.email_retry', {
      route: '/api/lookup-request',
      registration_id: reg.id,
      detail: firstError instanceof Error ? firstError.message : 'unknown_error',
    });
    try {
      await delay(900);
      await sendLookupLinkEmail({
        email: reg.email,
        first_name: reg.first_name,
        lookup_url: lookupUrl,
        registration_id: reg.id,
      });
    } catch (error) {
      serverLog('error', 'lookup_request.email_failed', {
        route: '/api/lookup-request',
        registration_id: reg.id,
        detail: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  return res.status(200).json({ ok: true, message: GENERIC_MESSAGE });
}
