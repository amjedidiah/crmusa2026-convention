import { decodeJwtPayload } from './jwt-payload.js';
import { normalizeEmail } from './registration.js';
import { serverLog } from './server-log.js';

let warnedStaffCorsAllowlistEmpty = false;

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
 * Verifies Supabase Auth JWT and allowlisted staff email via GET /auth/v1/user.
 *
 * The `apikey` header must match what the browser Supabase client uses (normally the
 * project **anon** key). We do **not** read `SUPABASE_SERVICE_KEY` here. Values from
 * `SUPABASE_ANON_KEY` / `SUPABASE_AUTH_KEY` are rejected if they decode as `service_role`,
 * so pasting the service JWT into those vars fails closed instead of widening trust.
 *
 * Required: `SUPABASE_ANON_KEY` (unless you set an explicit override below).
 * Optional: `SUPABASE_AUTH_KEY` — use only when you deliberately want a different key
 * for this Auth API call (document why in your deployment); must still be anon-class,
 * not service_role.
 */
export async function getStaffFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!match) {
    return { ok: false, status: 401, error: "missing_bearer_token" };
  }

  const accessToken = match[1];
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const apiKey = (
    process.env.SUPABASE_AUTH_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
  ).trim();

  if (!supabaseUrl) {
    return { ok: false, status: 500, error: "server_misconfigured" };
  }

  if (!apiKey) {
    serverLog("error", "staff_auth.verify_api_key_missing", {
      route: "staff-auth",
      detail:
        "Set SUPABASE_ANON_KEY for staff JWT verification (or SUPABASE_AUTH_KEY only as a documented override).",
    });
    return {
      ok: false,
      status: 500,
      error: "staff_auth_verify_key_unconfigured",
    };
  }

  if (decodeJwtPayload(apiKey)?.role === "service_role") {
    serverLog("error", "staff_auth.verify_api_key_service_role_rejected", {
      route: "staff-auth",
      detail:
        "SUPABASE_ANON_KEY / SUPABASE_AUTH_KEY must be the anon JWT for Auth apikey, not service_role.",
    });
    return {
      ok: false,
      status: 500,
      error: "staff_auth_verify_key_misconfigured",
    };
  }

  let userRes;
  try {
    userRes = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    serverLog("error", "staff_auth.user_fetch_failed", {
      route: "staff-auth",
      detail: error instanceof Error ? error.message : String(error),
      timedOut:
        error?.name === "TimeoutError" || error?.name === "AbortError",
    });
    return { ok: false, status: 503, error: "staff_auth_unavailable" };
  }

  if (!userRes.ok) {
    if (userRes.status === 401 || userRes.status === 403) {
      return { ok: false, status: 401, error: "invalid_or_expired_session" };
    }
    serverLog("error", "staff_auth.user_fetch_failed", {
      route: "staff-auth",
      detail: `Supabase responded with ${userRes.status}`,
    });
    return { ok: false, status: 503, error: "staff_auth_unavailable" };
  }

  let user;
  try {
    user = await userRes.json();
  } catch {
    return { ok: false, status: 401, error: "invalid_or_expired_session" };
  }

  const email = normalizeEmail(user?.email);
  if (!email || user?.id == null || user.id === "") {
    return { ok: false, status: 401, error: "invalid_or_expired_session" };
  }

  const allow = parseStaffAllowlist();
  if (allow.size === 0) {
    serverLog("warn", "staff_auth.allowlist_empty", { route: "staff-auth" });
    return { ok: false, status: 403, error: "staff_allowlist_not_configured" };
  }

  if (!allow.has(email)) {
    return { ok: false, status: 403, error: "email_not_allowlisted" };
  }

  return {
    ok: true,
    email,
    userId: user.id,
  };
}

function normalizeCorsOrigin(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/\/+$/, '');
  return s || null;
}

/**
 * Allowed origins for browser cross-origin calls to `/api/admin/*`.
 * Semicolon-, comma-, or newline-separated `STAFF_ORIGINS`, else single `STAFF_ORIGIN`,
 * else `SITE_URL` when admin ships on the same deployment (same-site admin + API).
 */
function staffCorsAllowedOrigins() {
  const multi = process.env.STAFF_ORIGINS;
  if (multi && String(multi).trim()) {
    return new Set(
      String(multi)
        .split(/[,;\n]+/)
        .map(normalizeCorsOrigin)
        .filter(Boolean)
    );
  }
  const single = normalizeCorsOrigin(process.env.STAFF_ORIGIN);
  if (single) return new Set([single]);
  const site = normalizeCorsOrigin(process.env.SITE_URL);
  if (site) return new Set([site]);
  return new Set();
}

/**
 * @returns {string | null} Echo this value as Access-Control-Allow-Origin, or null to omit (browser blocks cross-origin JS).
 */
export function resolveStaffCorsOrigin(req) {
  const requestOrigin = normalizeCorsOrigin(req.headers?.origin);
  if (!requestOrigin) return null;
  const allowed = staffCorsAllowedOrigins();
  if (allowed.size === 0) {
    if (!warnedStaffCorsAllowlistEmpty) {
      warnedStaffCorsAllowlistEmpty = true;
      serverLog('warn', 'staff_cors.allowlist_empty', {
        route: 'staff-auth',
        detail:
          'Set STAFF_ORIGINS or STAFF_ORIGIN (or SITE_URL when admin is same origin as API).',
      });
    }
    return null;
  }
  return allowed.has(requestOrigin) ? requestOrigin : null;
}

/**
 * CORS for staff routes only. Never uses `*` — reflects an allowlisted Origin + Vary.
 * Same-origin admin (typical Vercel: HTML + /api on one host) does not send Origin; headers may be omitted.
 */
export function staffCorsHeaders(req) {
  const origin = resolveStaffCorsOrigin(req);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return headers;
}

export function handleStaffOptions(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(staffCorsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));
    res.status(204).end();
    return true;
  }
  return false;
}
