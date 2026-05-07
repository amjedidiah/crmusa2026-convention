import { normalizeEmail } from './registration.js';
import { serverLog } from './server-log.js';

export function parseStaffAllowlist() {
  const raw = process.env.STAFF_EMAIL_ALLOWLIST || '';
  return new Set(
    raw
      .split(/[,;\n]+/)
      .map((s) => normalizeEmail(s))
      .filter(Boolean)
  );
}

/**
 * Verifies Supabase Auth JWT and allowlisted staff email.
 * Uses anon or service key as apikey (same as Supabase client).
 */
export async function getStaffFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!match) {
    return { ok: false, status: 401, error: 'missing_bearer_token' };
  }

  const accessToken = match[1];
  const supabaseUrl = process.env.SUPABASE_URL;
  const apiKey =
    process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !apiKey) {
    return { ok: false, status: 500, error: 'server_misconfigured' };
  }

  let userRes;
  try {
    userRes = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
      },
    });
  } catch (error) {
    serverLog('error', 'staff_auth.user_fetch_failed', {
      route: 'staff-auth',
      detail: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, status: 503, error: 'staff_auth_unavailable' };
  }

  if (!userRes.ok) {
    return { ok: false, status: 401, error: 'invalid_or_expired_session' };
  }

  let user;
  try {
    user = await userRes.json();
  } catch {
    return { ok: false, status: 401, error: 'invalid_or_expired_session' };
  }

  const email = normalizeEmail(user?.email);
  if (!email) {
    return { ok: false, status: 401, error: 'invalid_or_expired_session' };
  }

  const allow = parseStaffAllowlist();
  if (allow.size === 0) {
    serverLog('warn', 'staff_auth.allowlist_empty', { route: 'staff-auth' });
    return { ok: false, status: 403, error: 'staff_allowlist_not_configured' };
  }

  if (!allow.has(email)) {
    return { ok: false, status: 403, error: 'email_not_allowlisted' };
  }

  return {
    ok: true,
    email,
    userId: user.id,
    accessToken,
  };
}

export function staffCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function handleStaffOptions(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(staffCorsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    res.status(204).end();
    return true;
  }
  return false;
}
