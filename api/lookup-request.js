import { sendLookupLinkEmail } from './confirm.js';
import { serverLog } from './_lib/server-log.js';
import { LOOKUP_LINK_GENERIC_MESSAGE } from './_lib/public-registration-messages.js';
import { normalizeEmail } from './_lib/registration.js';
import { normalizePledgeCode } from './_lib/pledge.js';
import { enforceRateLimit, getLookupRequestRateLimiter } from './_lib/rate-limit.js';
import { buildLookupUrlForRegistration } from './_lib/site.js';
import { supabaseRestRequest } from './_lib/supabase.js';

/** Every successful registration lookup returns the same JSON; see public-registration-messages.js. */

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    return res.status(200).json({ ok: true, message: LOOKUP_LINK_GENERIC_MESSAGE });
  }

  const encEmail = encodeURIComponent(emailNormalized);
  const encPledge = encodeURIComponent(pledgeNormalized);
  const lookup = await supabaseRestRequest(
    'GET',
    `registrations?email_normalized=eq.${encEmail}&pledge_code=eq.${encPledge}&select=id,lookup_token_version,first_name,email`
  );

  if (!lookup.ok || !Array.isArray(lookup.data) || lookup.data.length !== 1) {
    return res.status(200).json({ ok: true, message: LOOKUP_LINK_GENERIC_MESSAGE });
  }

  const reg = lookup.data[0];
  const lookupUrl = buildLookupUrlForRegistration(req, reg);

  if (!lookupUrl) {
    serverLog('error', 'lookup_request.misconfigured', {
      route: '/api/lookup-request',
      registration_id: reg.id,
      detail: 'missing_site_url_or_lookup_secret',
    });
    return res.status(200).json({ ok: true, message: LOOKUP_LINK_GENERIC_MESSAGE });
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

  return res.status(200).json({ ok: true, message: LOOKUP_LINK_GENERIC_MESSAGE });
}
