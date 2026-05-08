import nodemailer from "nodemailer";
import { serverLog } from "./server-log.js";

const RESEND_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 15_000;

/**
 * Transactional email (register, lookup link, confirm, remind).
 * Operator notes (Vercel vs local, Mailpit ports, staff Auth): **README.md** → section **Email**.
 *
 * Where transactional email goes:
 * - `resend` — production API (Vercel production/preview, or explicit), and **local dev when
 *   `RESEND_API_KEY` is set** (Mailpit SMTP from `vercel dev` often cannot reach Docker-bound Mailpit).
 * - `smtp` — Mailpit or any SMTP relay (local dev, CI, `NODE_ENV=test`).
 *
 * Override with `EMAIL_TRANSPORT=resend` or `EMAIL_TRANSPORT=smtp` (alias: `mailpit`).
 *
 * SMTP default port: `SMTP_PORT` or `MAILPIT_SMTP_PORT` if set; else **587** when only `SMTP_HOST` is set;
 * else **54325** when `SUPABASE_URL` is the local CLI API (e.g. `http://127.0.0.1:54321`);
 * else **1025** (standalone Mailpit). If Mailpit **:54325** refuses (`ECONNREFUSED`), one retry uses **:1025**.
 * When `MAILPIT_SMTP_HOST` / `SMTP_HOST` is unset, tries **127.0.0.1** then **localhost** on each port (loopback / OS quirks).
 *
 * **Praise Center parity:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` (same as `crm_praise_center` client). These override `MAILPIT_SMTP_*` when both are set (`SMTP_*` wins for host/port/auth; see `resolveMailpitSmtpPort`).
 */
export function resolveEmailTransport() {
  const explicit = (process.env.EMAIL_TRANSPORT || "").trim().toLowerCase();
  if (explicit === "resend") return "resend";
  if (explicit === "smtp" || explicit === "mailpit") return "smtp";

  if (process.env.NODE_ENV === "test") return "smtp";

  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") return "resend";

  /* Local `vercel dev`: host SMTP to Mailpit :54325 often fails (GoTrue uses Docker-internal SMTP). */
  if (process.env.RESEND_API_KEY?.trim()) return "resend";

  return "smtp";
}

/**
 * SMTP port: `SMTP_PORT` or `MAILPIT_SMTP_PORT` when set; else **587** if `SMTP_HOST` is set (external relay, port omitted); else Mailpit defaults from Supabase URL.
 * Supabase CLI exposes Mailpit SMTP on **54325** (UI **54324**); standalone Mailpit is usually **1025**.
 */
export function resolveMailpitSmtpPort() {
  const fromEnv = (process.env.SMTP_PORT || process.env.MAILPIT_SMTP_PORT || "").trim();
  if (fromEnv) {
    const n = parseInt(fromEnv, 10);
    return Number.isFinite(n) && n > 0 ? n : 1025;
  }
  if ((process.env.SMTP_HOST || "").trim()) {
    return 587;
  }
  const urlStr = (process.env.SUPABASE_URL || "").trim();
  try {
    if (urlStr) {
      const u = new URL(urlStr);
      const apiPort = u.port || (u.protocol === "https:" ? "443" : "80");
      const localApi =
        (u.hostname === "127.0.0.1" ||
          u.hostname === "localhost" ||
          u.hostname === "[::1]") &&
        apiPort === "54321";
      if (localApi) return 54325;
    }
  } catch {
    /* ignore */
  }
  return 1025;
}

export function assertTransactionalEmailReady() {
  const t = resolveEmailTransport();
  if (t === "resend") {
    if (!process.env.RESEND_API_KEY?.trim()) {
      throw new Error(
        "RESEND_API_KEY is not configured (EMAIL_TRANSPORT is resend)",
      );
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
  if (transport === "resend") {
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
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
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
    return { provider: "resend", id };
  } finally {
    clearTimeout(tid);
  }
}

function resolveSmtpAuth() {
  const user = (process.env.SMTP_USER || process.env.MAILPIT_SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || process.env.MAILPIT_SMTP_PASS || "").trim();
  return {
    user: user || undefined,
    pass: pass || undefined,
  };
}

/** @param {number} port */
function resolveSmtpSecure(port) {
  const raw = (process.env.SMTP_SECURE || "").trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return port === 465;
}

function createSmtpTransport(host, port) {
  const { user, pass } = resolveSmtpAuth();
  const secure = resolveSmtpSecure(port);
  return nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user || pass ? { auth: { user: user || "", pass: pass || "" } } : {}),
  });
}

async function sendMailOnceSmtp(opts, host, port) {
  const transport = createSmtpTransport(host, port);
  const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
  const info = await transport.sendMail({
    from: opts.from,
    to: toList,
    replyTo: opts.replyTo || undefined,
    subject: opts.subject,
    html: opts.html,
    text: opts.text || undefined,
  });
  return { provider: "smtp", id: info.messageId || "smtp" };
}

/** Short guidance for operators when SMTP to Mailpit fails. */
function smtpFailureHint(detail, host, port) {
  const d = String(detail || "");
  if (!/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(d)) return undefined;
  const h = String(host || "");
  const p = Number(port);
  if (p === 54325) {
    return "Supabase local Mailpit SMTP (:54325). Run `supabase start`, use standalone Mailpit on :1025, or set MAILPIT_SMTP_PORT / EMAIL_TRANSPORT=resend.";
  }
  if (p === 1025 && (h === "127.0.0.1" || h === "localhost" || h === "[::1]")) {
    return "Start Mailpit on :1025 (see project README), or set RESEND_API_KEY and EMAIL_TRANSPORT=resend in .env.local.";
  }
  return "Verify SMTP_HOST / SMTP_PORT (or MAILPIT_SMTP_*) and that an SMTP server is reachable.";
}

/** Hosts for outbound SMTP when `SMTP_HOST` / `MAILPIT_SMTP_HOST` is unset (GoTrue inside Docker can still reach Mailpit). */
function smtpConnectHosts() {
  const raw = (process.env.SMTP_HOST || process.env.MAILPIT_SMTP_HOST || "").trim();
  if (raw) return [raw];
  return ["127.0.0.1", "localhost"];
}

async function sendViaSmtp(opts) {
  const hosts = smtpConnectHosts();
  const explicitPort = (
    process.env.SMTP_PORT ||
    process.env.MAILPIT_SMTP_PORT ||
    ""
  ).trim();
  const primary = resolveMailpitSmtpPort();
  const externalSmtp = !!(process.env.SMTP_HOST || "").trim();
  const ports =
    explicitPort.length > 0
      ? [primary]
      : !externalSmtp && primary === 54325
        ? [54325, 1025]
        : [primary];

  for (let pi = 0; pi < ports.length; pi++) {
    const port = ports[pi];
    if (
      !explicitPort.length &&
      pi === 1 &&
      ports[0] === 54325 &&
      port === 1025
    ) {
      serverLog("warn", "email.smtp_fallback_port", {
        route: "email-send",
        detail:
          "SMTP :54325 unreachable on all tried hosts. Retrying standalone Mailpit :1025.",
      });
    }

    for (let hi = 0; hi < hosts.length; hi++) {
      const host = hosts[hi];
      try {
        return await sendMailOnceSmtp(opts, host, port);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const refused = /ECONNREFUSED/i.test(detail);

        if (refused && hi < hosts.length - 1) continue;

        if (refused && pi < ports.length - 1) break;

        const hint = smtpFailureHint(detail, host, port);
        serverLog("error", "email.smtp_send_failed", {
          route: "email-send",
          detail,
          host: String(host),
          port: String(port),
          ...(hint ? { hint } : {}),
        });
        throw err;
      }
    }
  }

  throw new Error("SMTP send failed");
}
