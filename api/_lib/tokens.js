import crypto from 'node:crypto';

/** Default TTL when `LOOKUP_TOKEN_TTL_SECONDS` is unset (least-privilege default). */
const DEFAULT_LOOKUP_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Upper bound for env-configured TTL (misconfiguration guard). */
const MAX_LOOKUP_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365;

/** Minimum TTL from env (below this falls back to default). */
const MIN_LOOKUP_TOKEN_TTL_SECONDS = 60;

function resolveDefaultLookupTokenTtlSeconds() {
  const raw = process.env.LOOKUP_TOKEN_TTL_SECONDS;
  if (raw == null || String(raw).trim() === '') {
    return DEFAULT_LOOKUP_TOKEN_TTL_SECONDS;
  }
  const n = Number.parseInt(String(raw).trim(), 10);
  if (
    !Number.isFinite(n) ||
    n < MIN_LOOKUP_TOKEN_TTL_SECONDS ||
    n > MAX_LOOKUP_TOKEN_TTL_SECONDS
  ) {
    return DEFAULT_LOOKUP_TOKEN_TTL_SECONDS;
  }
  return n;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function createLookupToken(
  payload,
  {
    secret = process.env.LOOKUP_TOKEN_SECRET,
    nowSeconds = Math.floor(Date.now() / 1000),
    ttlSeconds = resolveDefaultLookupTokenTtlSeconds(),
  } = {}
) {
  if (!secret) {
    throw new Error('LOOKUP_TOKEN_SECRET is required to create lookup tokens.');
  }

  if (!payload?.registration_id || !payload?.lookup_token_version) {
    throw new Error(
      "payload must include registration_id and lookup_token_version.",
    );
  }

  const tokenPayload = {
    registration_id: payload.registration_id,
    lookup_token_version: payload.lookup_token_version,
    exp: nowSeconds + ttlSeconds,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const signature = signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyLookupToken(
  token,
  {
    secret = process.env.LOOKUP_TOKEN_SECRET,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = {}
) {
  if (!secret) {
    throw new Error('LOOKUP_TOKEN_SECRET is required to verify lookup tokens.');
  }

  if (!token || !String(token).includes('.')) {
    return { valid: false, reason: 'malformed' };
  }

  const [encodedPayload, providedSignature] = String(token).split('.', 2);
  const expectedSignature = signValue(encodedPayload, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return { valid: false, reason: 'signature' };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (error) {
    return { valid: false, reason: 'payload' };
  }

  if (!payload.registration_id || !payload.lookup_token_version) {
    return { valid: false, reason: 'claims' };
  }

  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
