import { serverLog } from './_lib/server-log.js';
import { supabaseRestRequest } from './_lib/supabase.js';
import { verifyLookupToken } from './_lib/tokens.js';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.query?.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  let verified;
  try {
    verified = verifyLookupToken(token);
  } catch (error) {
    serverLog('error', 'lookup.token_verify_error', {
      route: '/api/lookup',
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
    return res.status(500).json({ error: 'server_error' });
  }

  if (!verified.valid) {
    serverLog('info', 'lookup.token_rejected', {
      route: '/api/lookup',
      reason: verified.reason || 'unknown',
    });
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  const { registration_id, lookup_token_version } = verified.payload;
  if (!isUuid(registration_id)) {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  const rowResponse = await supabaseRestRequest(
    'GET',
    `registrations?id=eq.${registration_id}&select=id,lookup_token_version,first_name,last_name,pledge_code,tier,total_cents,amount_paid_cents,status,attendees_json`
  );

  if (!rowResponse.ok || !Array.isArray(rowResponse.data) || !rowResponse.data[0]) {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  const row = rowResponse.data[0];
  if (Number(row.lookup_token_version) !== Number(lookup_token_version)) {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  const attendees = Array.isArray(row.attendees_json) ? row.attendees_json : [];
  const totalCents = Number(row.total_cents) || 0;
  const paidCents = Number(row.amount_paid_cents) || 0;
  const remainingCents = Math.max(0, totalCents - paidCents);

  serverLog('info', 'lookup.summary_ok', {
    route: '/api/lookup',
    registration_id: row.id,
    status: row.status,
  });

  return res.status(200).json({
    ok: true,
    registration: {
      first_name: row.first_name,
      last_name: row.last_name,
      pledge_code: row.pledge_code,
      tier: row.tier,
      total_cents: totalCents,
      amount_paid_cents: paidCents,
      remaining_cents: remainingCents,
      status: row.status,
      attendee_count: attendees.length,
    },
  });
}
