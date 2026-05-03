/* ─────────────────────────────────────────────────────────────────────
   /api/confirm  —  Send registration confirmation email via Resend
   POST  { first_name, last_name, email, phone, church, pledge_code,
           tier, total_pledged, amount_paid, attendees[] }
───────────────────────────────────────────────────────────────────── */

const FROM_ADDRESS  = 'pastor@gracelifecenter.com';
const REPLY_TO      = 'mok2003@gmail.com';
const NOTIFY_LIST   = [
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
const BREEZE_URL    = 'https://gracelifecenter.breezechms.com/give/online';
const SITE_URL      = 'https://crmusa2026-convention.vercel.app';

const TIER_LABELS = {
  earlybird : 'Early Bird (Apr 1 – Jun 15)',
  regular   : 'Regular (Jun 16 – Jul 16)',
  late      : 'Late (Jul 17+)',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    first_name, last_name, email, pledge_code,
    tier, total_pledged, amount_paid, attendees,
    church,
  } = req.body || {};

  if (!email || !pledge_code) {
    return res.status(400).json({ error: 'Missing email or pledge_code' });
  }

  const paid      = Number(amount_paid) || 0;
  const total     = Number(total_pledged) || 0;
  const remaining = Math.max(0, total - paid);
  const tierLabel = TIER_LABELS[tier] || tier || '';
  const fullName  = `${first_name || ''} ${last_name || ''}`.trim();

  /* ── Attendee rows ── */
  const attList = Array.isArray(attendees) ? attendees : [];
  const attRows = attList.map((a, i) => {
    const age = parseInt(a.age);
    const priceText = isNaN(age) ? '' : age <= 10 ? 'Free' : `$${calcPrice(age, tier)}`;
    return `
      <tr>
        <td style="padding:8px 16px;font-size:13px;color:rgba(245,239,224,0.65);
            border-bottom:1px solid rgba(200,168,90,0.05);">${i+1}. ${esc(a.name||'Attendee')}</td>
        <td style="padding:8px 16px;font-size:13px;color:rgba(245,239,224,0.45);
            border-bottom:1px solid rgba(200,168,90,0.05);">Age ${a.age||'?'}</td>
        <td style="padding:8px 16px;font-size:14px;color:#E8C87A;text-align:right;
            border-bottom:1px solid rgba(200,168,90,0.05);font-family:Georgia,serif;">
            ${priceText}</td>
      </tr>`;
  }).join('');

  /* ── Payment instructions block (only if balance remains) ── */
  const payInstructions = remaining > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0"
        style="background:rgba(200,168,90,0.06);border:1px solid rgba(200,168,90,0.2);
               margin-bottom:24px;">
      <tr>
        <td style="padding:18px 22px;">
          <p style="margin:0 0 10px;font-size:10px;letter-spacing:3px;text-transform:uppercase;
              color:rgba(200,168,90,0.6);">How to Pay Your Balance</p>
          <ol style="margin:0;padding-left:18px;font-size:13px;color:rgba(245,239,224,0.6);
              line-height:2.2;">
            <li>Visit our giving portal using the button below</li>
            <li>Select <strong style="color:#E8C87A;">2026 CRM USA Conference</strong> as the fund</li>
            <li>Enter any amount you'd like to pay today</li>
            <li>In the <strong style="color:#E8C87A;">Comments field</strong>, enter your
                pledge code exactly: <strong style="color:#E8C87A;letter-spacing:3px;
                font-family:'Courier New',monospace;">${pledge_code}</strong></li>
          </ol>
          <div style="text-align:center;margin-top:16px;">
            <a href="${BREEZE_URL}" style="display:inline-block;padding:11px 28px;
                background:#C8A85A;color:#0B1628;text-decoration:none;font-size:11px;
                letter-spacing:2px;text-transform:uppercase;font-weight:700;">
              Open Giving Portal →
            </a>
          </div>
        </td>
      </tr>
    </table>` : `
    <p style="margin:0 0 24px;font-size:13px;color:rgba(245,239,224,0.55);
        text-align:center;background:rgba(125,191,128,0.08);border:1px solid rgba(125,191,128,0.2);
        padding:14px;line-height:1.7;">
      ✓ Your registration is <strong style="color:#7dbf80;">fully paid.</strong>
      We look forward to seeing you in Houston!
    </p>`;

  /* ── Status summary line ── */
  let statusLine;
  /* amount_paid is always 0 at registration — payment confirmed by admin later */
  if (total === 0) {
    statusLine = `Your registration is <strong style="color:#7dbf80;">free</strong> — we look forward to seeing you in Houston!`;
  } else {
    statusLine = `Your registration is confirmed for a total of <strong style="color:#E8C87A;">$${total}.00</strong>. Please complete your payment using the Zelle or Zeffy instructions below — your balance will be updated within 3–5 business days once we receive your payment.`;
  }

  /* ── HTML email ── */
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#EDE8DF;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#EDE8DF;">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0"
    style="background:#0B1628;max-width:600px;border:1px solid rgba(200,168,90,0.15);">

  <!-- HEADER -->
  <tr>
    <td align="center" style="padding:36px 40px 28px;
        border-bottom:1px solid rgba(200,168,90,0.15);">
      <p style="margin:0 0 6px;font-size:10px;letter-spacing:4px;text-transform:uppercase;
          color:rgba(200,168,90,0.5);">Charismatic Renewal Ministries USA</p>
      <h1 style="margin:0 0 6px;font-size:28px;font-weight:300;font-style:italic;
          color:#E8C87A;">Bringing In The Harvest</h1>
      <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;
          color:rgba(245,239,224,0.35);">National Convention 2026 · Houston, TX</p>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td style="padding:32px 40px;">
      <p style="margin:0 0 18px;font-size:15px;color:rgba(245,239,224,0.8);">
        Dear ${esc(first_name || fullName)},</p>

      <p style="margin:0 0 24px;font-size:14px;color:rgba(245,239,224,0.65);line-height:1.75;">
        Your registration for the CRM USA 2026 National Convention has been confirmed.
        ${statusLine}
      </p>

      <!-- PLEDGE CODE -->
      <table width="100%" cellpadding="0" cellspacing="0"
          style="background:rgba(200,168,90,0.08);border:1px solid rgba(200,168,90,0.3);
                 margin-bottom:26px;">
        <tr>
          <td align="center" style="padding:22px 24px;">
            <p style="margin:0 0 8px;font-size:10px;letter-spacing:4px;
                text-transform:uppercase;color:rgba(200,168,90,0.6);">Your Pledge Code</p>
            <p style="margin:0 0 8px;font-size:38px;letter-spacing:14px;color:#E8C87A;
                font-family:'Courier New',monospace;font-weight:700;">${pledge_code}</p>
            <p style="margin:0;font-size:11px;color:rgba(245,239,224,0.38);line-height:1.7;">
              Save this code. Enter it in the <strong>Comments field</strong> when paying<br/>
              via the giving portal, and use it to look up your balance at any time.
            </p>
          </td>
        </tr>
      </table>

      <!-- BALANCE TABLE -->
      <table width="100%" cellpadding="0" cellspacing="0"
          style="border:1px solid rgba(200,168,90,0.15);margin-bottom:26px;">
        <tr style="background:rgba(200,168,90,0.07);">
          <td style="padding:10px 16px;font-size:10px;letter-spacing:2px;
              text-transform:uppercase;color:rgba(200,168,90,0.55);">
              Registration Summary</td>
          <td style="padding:10px 16px;font-size:10px;letter-spacing:2px;
              text-transform:uppercase;color:rgba(200,168,90,0.55);text-align:right;">
              ${esc(tierLabel)}</td>
        </tr>
        <tr style="border-top:1px solid rgba(200,168,90,0.08);">
          <td style="padding:10px 16px;font-size:13px;
              color:rgba(245,239,224,0.55);">Total Convention Cost</td>
          <td style="padding:10px 16px;font-size:16px;color:#E8C87A;
              text-align:right;font-family:Georgia,serif;">$${total}.00</td>
        </tr>
        <tr style="border-top:1px solid rgba(200,168,90,0.08);">
          <td style="padding:10px 16px;font-size:13px;
              color:rgba(245,239,224,0.55);">Paid Today</td>
          <td style="padding:10px 16px;font-size:16px;color:#7dbf80;
              text-align:right;font-family:Georgia,serif;">$${paid}.00</td>
        </tr>
        <tr style="border-top:1px solid rgba(200,168,90,0.15);">
          <td style="padding:12px 16px;font-size:14px;
              color:#F5EFE0;font-weight:bold;">Remaining Balance</td>
          <td style="padding:12px 16px;font-size:20px;
              color:${remaining > 0 ? '#E8C87A' : '#7dbf80'};
              text-align:right;font-family:Georgia,serif;font-weight:bold;">
              ${remaining > 0 ? `$${remaining}.00` : 'Fully Paid ✓'}</td>
        </tr>
      </table>

      <!-- ATTENDEES -->
      <p style="margin:0 0 10px;font-size:10px;letter-spacing:3px;text-transform:uppercase;
          color:rgba(200,168,90,0.55);">Registered Attendees</p>
      <table width="100%" cellpadding="0" cellspacing="0"
          style="border:1px solid rgba(200,168,90,0.1);margin-bottom:26px;">
        ${attRows}
      </table>

      <!-- PAYMENT INSTRUCTIONS OR FULLY PAID MESSAGE -->
      ${payInstructions}

      <!-- CONVENTION DETAILS -->
      <table width="100%" cellpadding="0" cellspacing="0"
          style="background:rgba(200,168,90,0.05);border:1px solid rgba(200,168,90,0.13);
                 margin-bottom:24px;">
        <tr>
          <td style="padding:22px 26px;">
            <p style="margin:0 0 14px;font-size:10px;letter-spacing:3px;
                text-transform:uppercase;color:rgba(200,168,90,0.55);">Convention Details</p>
            <p style="margin:0 0 6px;font-size:15px;font-style:italic;
                color:#E8C87A;">Bringing In The Harvest</p>
            <p style="margin:0 0 4px;font-size:13px;
                color:rgba(245,239,224,0.7);">📅&nbsp; July 29 – August 2, 2026</p>
            <p style="margin:0 0 4px;font-size:13px;
                color:rgba(245,239,224,0.7);">📍&nbsp; Holiday Inn NW Houston</p>
            <p style="margin:0 0 16px;font-size:12px;
                color:rgba(245,239,224,0.38);">3539 N Sam Houston Pkwy West · Houston, TX 77086</p>
            <a href="${SITE_URL}" style="display:inline-block;padding:9px 22px;
                background:#C8A85A;color:#0B1628;text-decoration:none;
                font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">
              View Convention Site →
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:12px;color:rgba(245,239,224,0.3);line-height:1.8;">
        Questions? Reply to this email or write to
        <a href="mailto:${REPLY_TO}" style="color:#C8A85A;">${REPLY_TO}</a>
      </p>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td align="center" style="padding:18px 40px;
        border-top:1px solid rgba(200,168,90,0.1);">
      <p style="margin:0;font-size:10px;color:rgba(245,239,224,0.2);">
        © 2026 Charismatic Renewal Ministries USA · Houston, Texas
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  /* ── Send via Resend ── */
  const resendRes = await fetch('https://api.resend.com/emails', {
    method : 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({
      from    : `CRM 2026 Convention <${FROM_ADDRESS}>`,
      to      : [email],
      reply_to: REPLY_TO,
      subject : `Your CRM 2026 Registration is Confirmed — Code: ${pledge_code}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error('Resend error:', errText);
    return res.status(500).json({ error: 'Email send failed', detail: errText });
  }

  /* ── Send staff notification ── */
  const notifyHtml = `
    <div style="font-family:Arial,sans-serif;padding:24px;background:#f5f5f5;">
      <h2 style="color:#0B1628;margin:0 0 16px;">New Convention Registration</h2>
      <table style="background:#fff;border-collapse:collapse;width:100%;max-width:500px;">
        <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;color:#666;width:140px;">Name</td>
            <td style="padding:10px 16px;border-bottom:1px solid #eee;font-weight:bold;">\${fullName}</td></tr>
        <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;color:#666;">Email</td>
            <td style="padding:10px 16px;border-bottom:1px solid #eee;">\${email}</td></tr>
        <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;color:#666;">Church</td>
            <td style="padding:10px 16px;border-bottom:1px solid #eee;">\${esc(church || '—')}</td></tr>
        <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;color:#666;">Pledge Code</td>
            <td style="padding:10px 16px;border-bottom:1px solid #eee;font-family:monospace;font-size:18px;color:#C8A85A;letter-spacing:4px;">\${pledge_code}</td></tr>
        <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;color:#666;">Tier</td>
            <td style="padding:10px 16px;border-bottom:1px solid #eee;">\${esc(tierLabel)}</td></tr>
        <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;color:#666;">Total Pledged</td>
            <td style="padding:10px 16px;border-bottom:1px solid #eee;">$\${total}.00</td></tr>
        <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;color:#666;">Paid Today</td>
            <td style="padding:10px 16px;border-bottom:1px solid #eee;color:green;">$\${paid}.00</td></tr>
        <tr><td style="padding:10px 16px;color:#666;">Balance</td>
            <td style="padding:10px 16px;color:\${remaining > 0 ? '#C8A85A' : 'green'};">\${remaining > 0 ? '$'+remaining+'.00 remaining' : 'Fully Paid'}</td></tr>
        <tr><td style="padding:10px 16px;border-top:1px solid #eee;color:#666;">Attendees</td>
            <td style="padding:10px 16px;border-top:1px solid #eee;">\${attList.length} person(s)</td></tr>
      </table>
    </div>`;

  await fetch('https://api.resend.com/emails', {
    method : 'POST',
    headers: {
      'Authorization': \`Bearer \${process.env.RESEND_API_KEY}\`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({
      from   : \`CRM 2026 Convention <\${FROM_ADDRESS}>\`,
      to     : NOTIFY_LIST,
      reply_to: REPLY_TO,
      subject: \`New Registration: \${fullName} — Code \${pledge_code}\`,
      html   : notifyHtml,
    }),
  }).catch(e => console.warn('Notify send error:', e));

  return res.status(200).json({ ok: true });
}

/* ── Helpers ── */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function calcPrice(age, tier) {
  const pricing = {
    earlybird: { u10:0,   u17:100, adu:200 },
    regular:   { u10:50,  u17:150, adu:250 },
    late:      { u10:300, u17:300, adu:300 },
  };
  const p = pricing[tier] || pricing.earlybird;
  if (age <= 10) return p.u10;
  if (age <= 17) return p.u17;
  return p.adu;
}
