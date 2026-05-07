import { serverLog } from './_lib/server-log.js';
import { supabaseRestRequest } from './_lib/supabase.js';
import { verifyLookupToken } from './_lib/tokens.js';
import { isUuid } from './_lib/uuid.js';

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

  const payload = verified.payload;
  if (!payload || !isUuid(payload.registration_id)) {
    serverLog('warn', 'lookup.token_payload_invalid', {
      route: '/api/lookup',
      reason: 'missing_or_bad_registration_id',
    });
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  if (
    payload.lookup_token_version == null ||
    payload.lookup_token_version === ''
  ) {
    serverLog('warn', 'lookup.token_payload_invalid', {
      route: '/api/lookup',
      reason: 'missing_lookup_token_version',
    });
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  const registration_id = payload.registration_id;
  const tokenVersion = Number(payload.lookup_token_version);
  if (!Number.isFinite(tokenVersion)) {
    serverLog('warn', 'lookup.token_payload_invalid', {
      route: '/api/lookup',
      reason: 'lookup_token_version_not_numeric',
    });
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  let rowResponse;
  try {
    rowResponse = await supabaseRestRequest(
      'GET',
      `registrations?id=eq.${registration_id}&select=id,lookup_token_version,first_name,last_name,pledge_code,tier,total_cents,amount_paid_cents,status,attendees_json`
    );
  } catch (error) {
    serverLog('error', 'lookup.db_request_error', {
      route: '/api/lookup',
      registration_id,
      detail: error instanceof Error ? error.message : 'unknown_error',
    });
    return res.status(500).json({ error: 'server_error' });
  }

  if (!rowResponse.ok) {
    serverLog('error', 'lookup.db_response_error', {
      route: '/api/lookup',
      registration_id,
      status: rowResponse.status,
    });
    return res.status(500).json({ error: 'server_error' });
  }

  if (!Array.isArray(rowResponse.data) || !rowResponse.data[0]) {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  const row = rowResponse.data[0];
  const rowVersion = Number(row.lookup_token_version);
  if (
    !Number.isFinite(rowVersion) ||
    rowVersion !== tokenVersion
  ) {
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
