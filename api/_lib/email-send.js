import nodemailer from 'nodemailer';
import { serverLog } from './server-log.js';

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 15_000;

/**
 * Where transactional email goes:
 * - `resend` — production API (Vercel production/preview, or explicit).
 * - `smtp` — Mailpit or any SMTP relay (local dev, CI, NODE_ENV=test).
 *
 * Override with `EMAIL_TRANSPORT=resend` or `EMAIL_TRANSPORT=smtp` (alias: `mailpit`).
 */
export function resolveEmailTransport() {
  const explicit = (process.env.EMAIL_TRANSPORT || '').trim().toLowerCase();
  if (explicit === 'resend') return 'resend';
  if (explicit === 'smtp' || explicit === 'mailpit') return 'smtp';

  if (process.env.NODE_ENV === 'test') return 'smtp';

  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === 'production' || vercelEnv === 'preview') return 'resend';

  return 'smtp';
}

export function assertTransactionalEmailReady() {
  const t = resolveEmailTransport();
  if (t === 'resend') {
    if (!process.env.RESEND_API_KEY?.trim()) {
      throw new Error('RESEND_API_KEY is not configured (EMAIL_TRANSPORT is resend)');
    }
    return;
  }
  // SMTP: Mailpit etc.; connection errors surface on first send
}

/**
 * @param {object} opts
 * @param {string} opts.from
 * @param {string[]} opts.to
 * @param {string} [opts.replyTo]
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]
 */
export async function sendTransactionalEmail(opts) {
  const transport = resolveEmailTransport();
  if (transport === 'resend') {
    return sendViaResend(opts);
  }
  return sendViaSmtp(opts);
}

async function sendViaResend({ from, to, replyTo, subject, html, text }) {
  assertTransactionalEmailReady();
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const body = {
      from,
      to,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(text ? { text } : {}),
    };
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const textBody = await res.text();
    if (!res.ok) {
      throw new Error(textBody || `Resend HTTP ${res.status}`);
    }
    let id = null;
    try {
      id = JSON.parse(textBody)?.id ?? null;
    } catch {
      /* ignore */
    }
    return { provider: 'resend', id };
  } finally {
    clearTimeout(tid);
  }
}

function createSmtpTransport() {
  const host = process.env.MAILPIT_SMTP_HOST || '127.0.0.1';
  const port = parseInt(process.env.MAILPIT_SMTP_PORT || '1025', 10);
  const user = process.env.MAILPIT_SMTP_USER || undefined;
  const pass = process.env.MAILPIT_SMTP_PASS || undefined;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    ...(user || pass ? { auth: { user: user || '', pass: pass || '' } } : {}),
  });
}

async function sendViaSmtp({ from, to, replyTo, subject, html, text }) {
  const transport = createSmtpTransport();
  const toList = Array.isArray(to) ? to : [to];
  try {
    const info = await transport.sendMail({
      from,
      to: toList,
      replyTo: replyTo || undefined,
      subject,
      html,
      text: text || undefined,
    });
    return { provider: 'smtp', id: info.messageId || 'smtp' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    serverLog('error', 'email.smtp_send_failed', {
      route: 'email-send',
      detail,
      host: process.env.MAILPIT_SMTP_HOST || '127.0.0.1',
      port: process.env.MAILPIT_SMTP_PORT || '1025',
    });
    throw err;
  }
}
