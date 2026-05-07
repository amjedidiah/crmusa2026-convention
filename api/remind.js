/* ─────────────────────────────────────────────────────────────────────
   /api/remind  —  Weekly balance reminder cron job
   Schedule: every Monday 9 am Eastern (14:00 UTC)  →  vercel.json
   Secured by Authorization: Bearer ${CRON_SECRET}
   Also callable manually: GET /api/remind?secret=YOUR_CRON_SECRET
───────────────────────────────────────────────────────────────────── */

const FROM_ADDRESS = 'pastor@gracelifecenter.com';
const REPLY_TO     = 'mok2003@gmail.com';
const BREEZE_URL   = 'https://gracelifecenter.breezechms.com/give/online';
const SITE_URL     = 'https://crmusa2026-convention.vercel.app';

const TIER_LABELS = {
  earlybird : 'Early Bird (Apr 1 – Jun 15)',
  regular   : 'Regular (Jun 16 – Jul 16)',
  late      : 'Late (Jul 17+)',
};

function pledgedTotalUSD(reg) {
  const raw =
    reg.total_pledged != null && reg.total_pledged !== ''
      ? reg.total_pledged
      : reg.total_amount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function amountPaidUSD(reg) {
  const n = Number(reg.amount_paid);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  /* ── Auth: Vercel cron sends Authorization header automatically.
        Also accept ?secret= for manual testing.            ── */
  const authHeader = req.headers['authorization'] || '';
  const querySecret = req.query.secret || '';
  const cronSecret  = process.env.CRON_SECRET || '';

  const authorized =
    authHeader === `Bearer ${cronSecret}` ||
    querySecret === cronSecret;

  if (!cronSecret || !authorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  /* ── Fetch all partial/pending registrations from Supabase ── */
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: 'Supabase env vars not set' });
  }

  const supaRes = await fetch(
    `${supaUrl}/rest/v1/registrations?status=in.(pending,partial)&select=*`,
    {
      headers: {
        'apikey'       : supaKey,
        'Authorization': `Bearer ${supaKey}`,
        'Content-Type' : 'application/json',
      },
    }
  );

  if (!supaRes.ok) {
    const err = await supaRes.text();
    console.error('Supabase fetch error:', err);
    return res.status(500).json({ error: 'Supabase query failed', detail: err });
  }

  const registrations = await supaRes.json();

  if (!Array.isArray(registrations) || registrations.length === 0) {
    console.log('No outstanding registrations. Nothing to remind.');
    return res.status(200).json({ sent: 0, skipped: 0, message: 'No outstanding registrations' });
  }

  /* ── Send reminder to each ── */
  let sent = 0, skipped = 0, failed = 0;
  const errors = [];

  for (const reg of registrations) {
    const total = pledgedTotalUSD(reg);
    const paid = amountPaidUSD(reg);
    const remaining = Math.max(0, total - paid);
    if (remaining <= 0 || !reg.email) { skipped++; continue; }

    const html = buildReminderEmail(reg, remaining, total, paid);

    const resendRes = await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({
        from    : `CRM 2026 Convention <${FROM_ADDRESS}>`,
        to      : [reg.email],
        reply_to: REPLY_TO,
        subject : `CRM 2026 — Balance Reminder: $${remaining}.00 remaining`,
        html,
      }),
    });

    if (resendRes.ok) {
      sent++;
    } else {
      failed++;
      const errText = await resendRes.text();
      console.error(`Failed for ${reg.email}:`, errText);
      errors.push({ email: reg.email, error: errText });
    }

    /* Small delay to avoid Resend rate limits */
    await sleep(120);
  }

  console.log(`Reminder job done — sent: ${sent}, skipped: ${skipped}, failed: ${failed}`);
  return res.status(200).json({ sent, skipped, failed, errors });
}

/* ── Build reminder email HTML ── */
function buildReminderEmail(reg, remaining, total, paid) {
  const pct       = total > 0 ? Math.round((paid / total) * 100) : 0;
  const tierLabel = TIER_LABELS[reg.tier] || reg.tier || '';
  const firstName = reg.first_name || 'Friend';

  /* Progress bar width (capped at 100%) */
  const barPct = Math.min(100, pct);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#EDE8DF;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EDE8DF;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0"
    style="background:#0B1628;max-width:600px;border:1px solid rgba(200,168,90,0.15);">

  <!-- HEADER -->
  <tr>
    <td align="center" style="padding:30px 40px 24px;
        border-bottom:1px solid rgba(200,168,90,0.15);">
      <p style="margin:0 0 5px;font-size:10px;letter-spacing:4px;text-transform:uppercase;
          color:rgba(200,168,90,0.5);">Charismatic Renewal Ministries USA</p>
      <h1 style="margin:0 0 5px;font-size:24px;font-weight:300;font-style:italic;
          color:#E8C87A;">Convention 2026 · Balance Reminder</h1>
      <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;
          color:rgba(245,239,224,0.3);">Houston, TX · July 29 – August 2</p>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td style="padding:30px 40px;">
      <p style="margin:0 0 16px;font-size:15px;color:rgba(245,239,224,0.8);">
        Hi ${esc(firstName)},</p>
      <p style="margin:0 0 24px;font-size:14px;color:rgba(245,239,224,0.6);line-height:1.75;">
        This is a friendly reminder that you have an outstanding balance for the
        <strong style="color:#E8C87A;">CRM USA 2026 National Convention</strong>.
        You can pay any amount at any time using your pledge code below.
      </p>

      <!-- PROGRESS BAR -->
      <table width="100%" cellpadding="0" cellspacing="0"
          style="background:rgba(200,168,90,0.06);border:1px solid rgba(200,168,90,0.2);
                 margin-bottom:24px;">
        <tr>
          <td style="padding:18px 22px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:11px;letter-spacing:2px;text-transform:uppercase;
                    color:rgba(200,168,90,0.55);">Payment Progress</td>
                <td style="text-align:right;font-size:13px;
                    color:rgba(245,239,224,0.5);">${pct}% complete</td>
              </tr>
            </table>
            <!-- bar track -->
            <div style="background:rgba(255,255,255,0.07);height:8px;
                border-radius:4px;margin:10px 0;">
              <div style="background:#C8A85A;height:8px;border-radius:4px;
                  width:${barPct}%;"></div>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:12px;color:#7dbf80;">Paid: $${paid}.00</td>
                <td style="text-align:right;font-size:12px;
                    color:rgba(245,239,224,0.4);">Total: $${total}.00</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- BALANCE -->
      <table width="100%" cellpadding="0" cellspacing="0"
          style="border:1px solid rgba(200,168,90,0.15);margin-bottom:24px;">
        <tr style="background:rgba(200,168,90,0.07);">
          <td colspan="2" style="padding:10px 16px;font-size:10px;letter-spacing:2px;
              text-transform:uppercase;color:rgba(200,168,90,0.55);">
              ${esc(tierLabel)} · Pledge Code:
              <strong style="color:#E8C87A;letter-spacing:3px;
              font-family:'Courier New',monospace;">${reg.pledge_code}</strong>
          </td>
        </tr>
        <tr style="border-top:1px solid rgba(200,168,90,0.08);">
          <td style="padding:10px 16px;font-size:13px;
              color:rgba(245,239,224,0.55);">Total Pledged</td>
          <td style="padding:10px 16px;font-size:15px;color:#E8C87A;
              text-align:right;font-family:Georgia,serif;">$${total}.00</td>
        </tr>
        <tr style="border-top:1px solid rgba(200,168,90,0.08);">
          <td style="padding:10px 16px;font-size:13px;
              color:rgba(245,239,224,0.55);">Amount Paid</td>
          <td style="padding:10px 16px;font-size:15px;color:#7dbf80;
              text-align:right;font-family:Georgia,serif;">$${paid}.00</td>
        </tr>
        <tr style="border-top:1px solid rgba(200,168,90,0.15);">
          <td style="padding:12px 16px;font-size:14px;
              color:#F5EFE0;font-weight:bold;">Balance Due</td>
          <td style="padding:12px 16px;font-size:20px;color:#E8C87A;
              text-align:right;font-family:Georgia,serif;font-weight:bold;">
              $${remaining}.00</td>
        </tr>
      </table>

      <!-- HOW TO PAY -->
      <table width="100%" cellpadding="0" cellspacing="0"
          style="background:rgba(200,168,90,0.05);border:1px solid rgba(200,168,90,0.18);
                 margin-bottom:24px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 12px;font-size:10px;letter-spacing:3px;
                text-transform:uppercase;color:rgba(200,168,90,0.55);">How to Pay</p>
            <ol style="margin:0;padding-left:18px;font-size:13px;
                color:rgba(245,239,224,0.6);line-height:2.2;">
              <li>Click the button below to open the giving portal</li>
              <li>Select <strong style="color:#E8C87A;">2026 CRM USA Conference</strong> as the fund</li>
              <li>Enter any amount you'd like to pay today</li>
              <li>In the <strong style="color:#E8C87A;">Comments field</strong>, enter:
                  <strong style="color:#E8C87A;letter-spacing:3px;
                  font-family:'Courier New',monospace;">${reg.pledge_code}</strong></li>
            </ol>
            <div style="text-align:center;margin-top:18px;">
              <a href="${BREEZE_URL}" style="display:inline-block;padding:12px 32px;
                  background:#C8A85A;color:#0B1628;text-decoration:none;
                  font-size:11px;letter-spacing:2px;text-transform:uppercase;
                  font-weight:700;margin-right:10px;">
                Pay Now →
              </a>
              <a href="${SITE_URL}#register" style="display:inline-block;padding:12px 22px;
                  background:transparent;border:1px solid rgba(200,168,90,0.4);
                  color:#C8A85A;text-decoration:none;font-size:11px;
                  letter-spacing:2px;text-transform:uppercase;">
                Check Balance
              </a>
            </div>
          </td>
        </tr>
      </table>

      <!-- CONVENTION REMINDER -->
      <p style="margin:0 0 10px;font-size:13px;color:rgba(245,239,224,0.55);
          line-height:1.75;text-align:center;">
        📅 <strong style="color:#E8C87A;">July 29 – August 2, 2026</strong>
        &nbsp;·&nbsp; Holiday Inn NW Houston &nbsp;·&nbsp; 3539 N Sam Houston Pkwy West
      </p>

      <p style="margin:16px 0 0;font-size:11px;color:rgba(245,239,224,0.25);
          line-height:1.8;text-align:center;">
        To unsubscribe from these reminders, reply with "unsubscribe".<br/>
        Questions? <a href="mailto:${REPLY_TO}"
        style="color:#C8A85A;">${REPLY_TO}</a>
      </p>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td align="center" style="padding:16px 40px;
        border-top:1px solid rgba(200,168,90,0.08);">
      <p style="margin:0;font-size:10px;color:rgba(245,239,224,0.18);">
        © 2026 Charismatic Renewal Ministries USA · Houston, Texas
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
