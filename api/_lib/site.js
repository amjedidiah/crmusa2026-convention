import { createLookupToken } from './tokens.js';

export function getRequestOrigin(req) {
  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/+$/, '');
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    forwardedProto ||
    (req.headers.host && req.headers.host.includes('localhost') ? 'http' : 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  if (!host) {
    return null;
  }

  return `${proto}://${host}`;
}

export function buildLookupUrlForRegistration(req, registration) {
  const origin = getRequestOrigin(req);
  if (!origin || !process.env.LOOKUP_TOKEN_SECRET) {
    return null;
  }

  const token = createLookupToken({
    registration_id: registration.id,
    lookup_token_version: registration.lookup_token_version,
  });

  return `${origin}/#return?token=${encodeURIComponent(token)}`;
}
