/**
 * Convention transactional email identities (Resend / SMTP).
 *
 * Strict config (explicit env, no legacy fallbacks for required fields) when:
 * - `VERCEL_ENV=production` (Vercel production), or
 * - `NODE_ENV=production` on non-Vercel hosts (`VERCEL` is not `1` — e.g. self‑hosted Node).
 *
 * Vercel Preview (`VERCEL=1`, `VERCEL_ENV=preview`) keeps legacy defaults if env is unset.
 */

const LEGACY_STAFF_NOTIFY = [
  'Jessybenn@yahoo.com',
  'modims2@yahoo.com',
  'pastortonycbz@yahoo.com',
  'soinikori@gmail.com',
  'pastorpeter.crmnano@gmail.com',
  'emekaok@hotmail.com',
  'inyeredave@gmail.com',
  'emekaok77@gmail.com',
  'pastor@gracelifecenter.com',
  'mike.u.ekwem@gmail.com',
  'fellyokey@gmail.com',
  'mok2003@gmail.com',
  'ezekwennap@gmail.com',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @deprecated Use isConventionMailEnvStrict() for required CONVENTION_* env checks. */
export function isVercelProduction() {
  return process.env.VERCEL_ENV === 'production';
}

/** When true, convention From/Reply/Zelle/staff list must come from env (no silent legacy). */
export function isConventionMailEnvStrict() {
  if (process.env.VERCEL_ENV === 'production') return true;
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL !== '1') {
    return true;
  }
  return false;
}

/** Full From header value for Resend/nodemailer. */
export function resolveConventionMailFrom() {
  const env = process.env.CONVENTION_MAIL_FROM?.trim();
  if (env) {
    if (env.includes('<')) return env;
    return `CRM 2026 Convention <${env}>`;
  }
  if (isConventionMailEnvStrict()) {
    throw new Error('CONVENTION_MAIL_FROM is required in production');
  }
  /** Align with SMTP auth / mailbox domain (e.g. GoDaddy rejects mismatched MAIL FROM). */
  const smtpMailbox =
    process.env.SMTP_USER?.trim() || process.env.MAILPIT_SMTP_USER?.trim();
  if (smtpMailbox && EMAIL_RE.test(smtpMailbox)) {
    return `CRM 2026 Convention <${smtpMailbox}>`;
  }
  return 'CRM 2026 Convention <pastor@gracelifecenter.com>';
}

export function resolveConventionMailReplyTo() {
  const env = process.env.CONVENTION_MAIL_REPLY_TO?.trim();
  if (env) return env;
  if (isConventionMailEnvStrict()) {
    throw new Error('CONVENTION_MAIL_REPLY_TO is required in production');
  }
  return 'mok2003@gmail.com';
}

/** Shown in confirmation HTML when balance is due. */
export function resolveZelleRecipientEmail() {
  const env = process.env.CONVENTION_ZELLE_EMAIL?.trim();
  if (env) return env;
  if (isConventionMailEnvStrict()) {
    throw new Error('CONVENTION_ZELLE_EMAIL is required in production');
  }
  return 'crmnaexec@gmail.com';
}

/**
 * Deduped lowercase staff notify list. Non-production: empty env → legacy list.
 * Production: empty env → [] (caller must throw before send).
 */
export function parseStaffNotifyEmails() {
  const raw = process.env.CONVENTION_STAFF_NOTIFY_EMAILS?.trim();
  if (!raw) {
    if (isConventionMailEnvStrict()) return [];
    return [...LEGACY_STAFF_NOTIFY.map((e) => e.toLowerCase())];
  }
  const parts = raw
    .split(/[\n,]+/)
    .flatMap((s) => s.split(/\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq = [...new Set(parts.map((p) => p.toLowerCase()))];
  return uniq.filter((e) => EMAIL_RE.test(e));
}

/**
 * Outbound identity for any transactional mail (e.g. lookup link).
 */
export function assertConventionOutboundIdentity() {
  resolveConventionMailFrom();
  resolveConventionMailReplyTo();
}

/**
 * Full checks before registration confirmation HTML is built (includes Zelle copy).
 */
export function assertConventionConfirmationRouting({ includeStaffNotification }) {
  resolveConventionMailFrom();
  resolveConventionMailReplyTo();
  resolveZelleRecipientEmail();
  if (includeStaffNotification) {
    const list = parseStaffNotifyEmails();
    if (isConventionMailEnvStrict() && list.length === 0) {
      throw new Error(
        'CONVENTION_STAFF_NOTIFY_EMAILS must list at least one email in production when sending staff notifications'
      );
    }
  }
}
