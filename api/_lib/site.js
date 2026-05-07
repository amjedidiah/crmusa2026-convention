import { createLookupToken } from './tokens.js';

/** First hop when proxies append comma-separated forwarded headers. */
function firstForwardedSegment(header) {
  if (header == null) return undefined;
  const v = Array.isArray(header) ? header[0] : String(header);
  const part = v.split(',')[0]?.trim();
  return part || undefined;
}

/** Only allow schemes forwarders use; ignore spoofed garbage. */
function normalizeForwardedProto(header) {
  const raw = firstForwardedSegment(header)?.toLowerCase();
  if (raw === 'http' || raw === 'https') return raw;
  return undefined;
}

function hasHeaderInjection(host) {
  return typeof host === 'string' && /[\r\n]/.test(host);
}

/**
 * True for typical local dev hosts only — avoids `*.localhost` substring false
 * positives (e.g. notlocalhost.com).
 */
function isLikelyLocalDevHost(hostHeader) {
  if (!hostHeader || typeof hostHeader !== 'string' || hasHeaderInjection(hostHeader)) {
    return false;
  }
  const h = hostHeader.trim().toLowerCase();
  return (
    h === 'localhost' ||
    h.startsWith('localhost:') ||
    h === '127.0.0.1' ||
    h.startsWith('127.0.0.1:') ||
    h === '[::1]' ||
    h.startsWith('[::1]:')
  );
}

export function getRequestOrigin(req) {
  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/+$/, '');
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    normalizeForwardedProto(forwardedProto) ||
    (isLikelyLocalDevHost(req.headers?.host) ? 'http' : 'https');

  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    firstForwardedSegment(forwardedHost) || req.headers?.host;

  if (!host || hasHeaderInjection(host)) {
    return null;
  }

  return `${proto}://${String(host).trim()}`;
}

export function buildLookupUrlForRegistration(req, registration) {
  const origin = getRequestOrigin(req);
  if (
    !origin ||
    !process.env.LOOKUP_TOKEN_SECRET ||
    !registration?.id ||
    registration?.lookup_token_version == null
  ) {
    return null;
  }

  const token = createLookupToken({
    registration_id: registration.id,
    lookup_token_version: registration.lookup_token_version,
  });

  return `${origin}/#return?token=${encodeURIComponent(token)}`;
}
