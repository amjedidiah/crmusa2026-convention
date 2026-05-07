/* ─────────────────────────────────────────────────────────────────────
   /api/confirm  —  Registration confirmation + staff notification
   Reused by /api/register after persistence succeeds and available as a
   standalone compatibility endpoint for manual confirmation sends.
   POST body may include total_pledged and/or total_amount (legacy column).
───────────────────────────────────────────────────────────────────── */

const FROM_ADDRESS = 'pastor@gracelifecenter.com';
const REPLY_TO     = 'mok2003@gmail.com';
const SITE_URL     = 'https://crmusa2026-convention.vercel.app';
const ZELLE_EMAIL  = 'crmnaexec@gmail.com';

const NOTIFY_LIST = [
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

const TIER_LABELS = {
  earlybird: 'Early Bird (Apr 1 - Jun 15)',
  regular:   'Regular (Jun 16 - Jul 16)',
  late:      'Late (Jul 17+)',
};

export async function sendConfirmationEmails(payload) {
  const {
    first_name, last_name, email, phone, church,
    pledge_code, tier, total_pledged, total_amount, amount_paid, attendees,
  } = payload || {};

  if (!email || !pledge_code) {
    throw new Error('Missing email or pledge_code');
  }

  const paidNum = Number(amount_paid);
  const paid = Number.isFinite(paidNum) ? paidNum : 0;
  const rawTotal =
    total_pledged !== undefined && total_pledged !== null && total_pledged !== ''
      ? total_pledged
      : total_amount;
  const totalParsed = Number(rawTotal);
  const total = Number.isFinite(totalParsed) ? totalParsed : 0;
  const remaining = Math.max(0, total - paid);
  const trulyFullyPaid = total > 0 && remaining <= 0;

  const tierLabel = TIER_LABELS[tier] || tier || '';
  const fullName  = [first_name, last_name].filter(Boolean).join(' ');
  const attList   = Array.isArray(attendees) ? attendees : [];

  /* ── Build attendee rows ── */
  const attRows = attList.map(function(a, i) {
    var age   = parseInt(a.age);
    var price = isNaN(age) ? '' : (age <= 10 ? 'Free' : ('$' + calcPrice(age, tier)));
    return (
      '<tr>' +
        '<td style="padding:8px 16px;font-size:13px;color:rgba(245,239,224,0.65);border-bottom:1px solid rgba(200,168,90,0.05);">' +
          (i + 1) + '. ' + esc(a.name || 'Attendee') +
        '</td>' +
        '<td style="padding:8px 16px;font-size:13px;color:rgba(245,239,224,0.45);border-bottom:1px solid rgba(200,168,90,0.05);">Age ' + (a.age || '?') + '</td>' +
        '<td style="padding:8px 16px;font-size:14px;color:#E8C87A;text-align:right;border-bottom:1px solid rgba(200,168,90,0.05);font-family:Georgia,serif;">' + price + '</td>' +
      '</tr>'
    );
  }).join('');

  var bodyPara = '';
  if (total <= 0) {
    bodyPara =
      'Your registration is <strong style="color:#7dbf80;">free</strong>. We look forward to seeing you in Houston!';
  } else if (paid === 0) {
    bodyPara =
      'Your convention total is <strong style="color:#E8C87A;">$' + total + '.00</strong>. ' +
      'You have <strong>$0 recorded as paid</strong> so far — please complete payment via Zelle or Zeffy using the instructions below. ' +
      'Your balance will be updated within 3-5 business days once we receive payment.';
  } else if (trulyFullyPaid) {
    bodyPara =
      'We have recorded <strong style="color:#7dbf80;">$' + paid + '.00</strong> toward your registration. ' +
      'Your balance is <strong style="color:#7dbf80;">paid in full</strong> — see you in Houston!';
  } else {
    bodyPara =
      'Your convention total is <strong style="color:#E8C87A;">$' + total + '.00</strong>. ' +
      'We recorded <strong style="color:#7dbf80;">$' + paid + '.00</strong> toward your registration. ' +
      'Remaining balance: <strong style="color:#E8C87A;">$' + remaining + '.00</strong>. ' +
      'Complete payment using the instructions below.';
  }

  var remLabel =
    remaining > 0 ? '$' + remaining + '.00' : trulyFullyPaid ? 'Fully Paid ✓' : '$0.00';
  var remColor =
    remaining > 0 ? '#E8C87A' : trulyFullyPaid ? '#7dbf80' : 'rgba(245,239,224,0.55)';

  var paymentInstructions =
    remaining > 0
      ? '<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(200,168,90,0.06);border:1px solid rgba(200,168,90,0.2);margin-bottom:24px;">' +
          '<tr><td style="padding:20px 24px;">' +
            '<p style="margin:0 0 12px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,168,90,0.6);">How to Pay</p>' +
            '<p style="margin:0 0 6px;font-size:13px;color:rgba(245,239,224,0.8);"><strong style="color:#E8C87A;">Option 1 - Zelle (Free, instant):</strong></p>' +
            '<p style="margin:0 0 14px;font-size:13px;color:rgba(245,239,224,0.6);line-height:1.8;">' +
              'Send to <strong style="color:#E8C87A;">' + ZELLE_EMAIL + '</strong>. ' +
              'Put your pledge code <strong style="color:#E8C87A;letter-spacing:3px;font-family:Courier New,monospace;">' +
              pledge_code + '</strong> in the Memo/Note field.' +
            '</p>' +
            '<p style="margin:0 0 6px;font-size:13px;color:rgba(245,239,224,0.8);"><strong style="color:#E8C87A;">Option 2 - Card via Zeffy:</strong></p>' +
            '<p style="margin:0 0 16px;font-size:13px;color:rgba(245,239,224,0.6);line-height:1.8;">' +
              'Use the giving portal on the convention site. Enter your pledge code ' +
              '<strong style="color:#E8C87A;letter-spacing:3px;font-family:Courier New,monospace;">' +
              pledge_code + '</strong> ' +
              'in the <strong style="color:#E8C87A;">Conference Registration Code</strong> field.' +
            '</p>' +
            '<a href="' + SITE_URL + '#register" style="display:inline-block;padding:11px 28px;background:#C8A85A;color:#0B1628;text-decoration:none;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Return to Convention Site</a>' +
          '</td></tr>' +
        '</table>'
      : trulyFullyPaid
        ? '<p style="margin:0 0 24px;font-size:13px;color:rgba(245,239,224,0.55);text-align:center;background:rgba(125,191,128,0.08);border:1px solid rgba(125,191,128,0.2);padding:14px;line-height:1.7;">' +
            'Your registration is <strong style="color:#7dbf80;">fully paid</strong>. We look forward to seeing you in Houston!' +
          '</p>'
        : '<p style="margin:0 0 24px;font-size:13px;color:rgba(245,239,224,0.55);line-height:1.7;text-align:center;">' +
            'If a convention fee applies, pay via Zelle or Zeffy using your pledge code. Reply to this email if you need help.' +
          '</p>';

  var staffBalanceText =
    remaining > 0
      ? '$' + remaining + '.00 outstanding'
      : trulyFullyPaid
        ? 'Fully Paid'
        : '$0 — verify total in Supabase if fee expected';

  /* ── Confirmation email to registrant ── */
  var confirmHtml =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/></head>' +
    '<body style="margin:0;padding:0;background:#EDE8DF;font-family:Georgia,serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#EDE8DF;">' +
    '<tr><td align="center" style="padding:32px 16px;">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="background:#0B1628;max-width:600px;border:1px solid rgba(200,168,90,0.15);">' +
    /* Header */
    '<tr><td align="center" style="padding:36px 40px 28px;border-bottom:1px solid rgba(200,168,90,0.15);">' +
      '<p style="margin:0 0 6px;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:rgba(200,168,90,0.5);">Charismatic Renewal Ministries USA</p>' +
      '<h1 style="margin:0 0 6px;font-size:28px;font-weight:300;font-style:italic;color:#E8C87A;">Bringing In The Harvest</h1>' +
      '<p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(245,239,224,0.35);">National Convention 2026 &middot; Houston, TX</p>' +
    '</td></tr>' +
    /* Body */
    '<tr><td style="padding:32px 40px;">' +
      '<p style="margin:0 0 18px;font-size:15px;color:rgba(245,239,224,0.8);">Dear ' + esc(first_name || fullName) + ',</p>' +
      '<p style="margin:0 0 24px;font-size:14px;color:rgba(245,239,224,0.65);line-height:1.75;">' +
        'Your registration for the CRM USA 2026 National Convention has been confirmed. ' + bodyPara +
      '</p>' +
      /* Pledge code box */
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(200,168,90,0.08);border:1px solid rgba(200,168,90,0.3);margin-bottom:26px;">' +
        '<tr><td align="center" style="padding:22px 24px;">' +
          '<p style="margin:0 0 8px;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:rgba(200,168,90,0.6);">Your Pledge Code</p>' +
          '<p style="margin:0 0 10px;font-size:38px;letter-spacing:14px;color:#E8C87A;font-family:Courier New,monospace;font-weight:700;">' + pledge_code + '</p>' +
          '<p style="margin:0;font-size:11px;color:rgba(245,239,224,0.38);line-height:1.7;">' +
            'Save this code. Include it in your Zelle memo or Zeffy Registration Code field when paying.' +
          '</p>' +
        '</td></tr>' +
      '</table>' +
      /* Balance table */
      '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(200,168,90,0.15);margin-bottom:26px;">' +
        '<tr style="background:rgba(200,168,90,0.07);">' +
          '<td style="padding:10px 16px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(200,168,90,0.55);">Registration Summary</td>' +
          '<td style="padding:10px 16px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(200,168,90,0.55);text-align:right;">' + esc(tierLabel) + '</td>' +
        '</tr>' +
        '<tr><td style="padding:10px 16px;font-size:13px;color:rgba(245,239,224,0.55);">Total Convention Cost</td>' +
             '<td style="padding:10px 16px;font-size:16px;color:#E8C87A;text-align:right;font-family:Georgia,serif;">$' + total + '.00</td></tr>' +
        '<tr style="border-top:1px solid rgba(200,168,90,0.08);">' +
             '<td style="padding:10px 16px;font-size:13px;color:rgba(245,239,224,0.55);">Amount Paid</td>' +
             '<td style="padding:10px 16px;font-size:16px;color:#7dbf80;text-align:right;font-family:Georgia,serif;">$' + paid + '.00</td></tr>' +
        '<tr style="border-top:1px solid rgba(200,168,90,0.15);">' +
             '<td style="padding:12px 16px;font-size:14px;color:#F5EFE0;font-weight:bold;">Remaining Balance</td>' +
             '<td style="padding:12px 16px;font-size:20px;color:' + remColor + ';text-align:right;font-family:Georgia,serif;font-weight:bold;">' +
             remLabel + '</td></tr>' +
      '</table>' +
      /* Attendees */
      '<p style="margin:0 0 10px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,168,90,0.55);">Registered Attendees</p>' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(200,168,90,0.1);margin-bottom:26px;">' +
        attRows +
      '</table>' +
      paymentInstructions +
      /* Convention details */
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(200,168,90,0.05);border:1px solid rgba(200,168,90,0.13);margin-bottom:24px;">' +
        '<tr><td style="padding:22px 26px;">' +
          '<p style="margin:0 0 10px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,168,90,0.55);">Convention Details</p>' +
          '<p style="margin:0 0 4px;font-size:15px;font-style:italic;color:#E8C87A;">Bringing In The Harvest</p>' +
          '<p style="margin:0 0 4px;font-size:13px;color:rgba(245,239,224,0.7);">July 29 - August 2, 2026</p>' +
          '<p style="margin:0 0 4px;font-size:13px;color:rgba(245,239,224,0.7);">Holiday Inn NW Houston</p>' +
          '<p style="margin:0 0 16px;font-size:12px;color:rgba(245,239,224,0.38);">3539 N Sam Houston Pkwy West, Houston, TX 77086</p>' +
          '<a href="' + SITE_URL + '" style="display:inline-block;padding:9px 22px;background:#C8A85A;color:#0B1628;text-decoration:none;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">View Convention Site</a>' +
        '</td></tr>' +
      '</table>' +
      '<p style="margin:0;font-size:12px;color:rgba(245,239,224,0.3);line-height:1.8;">' +
        'Questions? Reply to this email or contact us at <a href="mailto:' + REPLY_TO + '" style="color:#C8A85A;">' + REPLY_TO + '</a>' +
      '</p>' +
    '</td></tr>' +
    '<tr><td align="center" style="padding:18px 40px;border-top:1px solid rgba(200,168,90,0.1);">' +
      '<p style="margin:0;font-size:10px;color:rgba(245,239,224,0.2);">2026 Charismatic Renewal Ministries USA, Houston, Texas</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';

  /* ── Staff notification email ── */
  var notifyHtml =
    '<div style="font-family:Arial,sans-serif;padding:24px;background:#f9f9f9;">' +
    '<div style="background:#0B1628;padding:16px 24px;margin-bottom:0;">' +
      '<h2 style="margin:0;color:#C8A85A;font-size:18px;">New Convention Registration</h2>' +
    '</div>' +
    '<table style="background:#fff;border-collapse:collapse;width:100%;max-width:560px;border:1px solid #ddd;">' +
      notifyRow('Name',          esc(fullName)) +
      notifyRow('Email',         esc(email)) +
      notifyRow('Phone',         esc(phone || '—')) +
      notifyRow('Church',        esc(church || '—')) +
      notifyRow('Pledge Code',   '<span style="font-family:Courier New,monospace;font-size:22px;color:#C8A85A;letter-spacing:5px;font-weight:bold;">' + pledge_code + '</span>') +
      notifyRow('Tier',          esc(tierLabel)) +
      notifyRow('Total Pledged', '$' + total + '.00') +
      notifyRow('Amount Paid',   '<span style="color:green;">$' + paid + '.00</span>') +
      notifyRow('Balance Due',   '<span style="color:' + (remaining > 0 ? '#B8860B' : trulyFullyPaid ? 'green' : '#888') + ';font-weight:bold;">' +
                                 staffBalanceText + '</span>') +
      notifyRow('Attendees',     attList.length + ' person(s)') +
    '</table>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#999;">Automated notification from CRM 2026 convention registration system.</p>' +
    '</div>';

  /* ── Send both emails in parallel — independent of each other ── */
  const [confirmResult, notifyResult] = await Promise.allSettled([

    fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({
        from    : 'CRM 2026 Convention <' + FROM_ADDRESS + '>',
        to      : [email],
        reply_to: REPLY_TO,
        subject : 'CRM 2026 Registration Confirmed - Code: ' + pledge_code,
        html    : confirmHtml,
      }),
    }).then(function(r) {
      return r.ok ? r.json() : r.text().then(function(t) { return Promise.reject(t); });
    }),

    fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({
        from    : 'CRM 2026 Convention <' + FROM_ADDRESS + '>',
        to      : NOTIFY_LIST,
        reply_to: REPLY_TO,
        subject : 'NEW REGISTRATION: ' + fullName + ' - Code ' + pledge_code,
        html    : notifyHtml,
      }),
    }).then(function(r) {
      return r.ok ? r.json() : r.text().then(function(t) { return Promise.reject(t); });
    }),

  ]);

  if (confirmResult.status === 'rejected') {
    console.error('[confirm] Confirmation email FAILED:', confirmResult.reason);
  } else {
    console.log('[confirm] Confirmation sent OK to:', email);
  }

  if (notifyResult.status === 'rejected') {
    console.error('[confirm] Staff notification FAILED:', notifyResult.reason);
  } else {
    console.log('[confirm] Staff notification sent OK to', NOTIFY_LIST.length, 'recipients');
  }

  return {
    ok              : true,
    confirmSent     : confirmResult.status === 'fulfilled',
    notificationSent: notifyResult.status === 'fulfilled',
    errors          : [
      confirmResult.status === 'rejected' ? confirmResult.reason : null,
      notifyResult.status  === 'rejected' ? notifyResult.reason  : null,
    ].filter(Boolean),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!req.body?.email || !req.body?.pledge_code) {
    return res.status(400).json({ error: 'Missing email or pledge_code' });
  }

  try {
    const result = await sendConfirmationEmails(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not send confirmation email.',
    });
  }
}

function notifyRow(label, value) {
  return (
    '<tr>' +
      '<td style="padding:10px 16px;border-bottom:1px solid #eee;color:#666;width:140px;font-size:13px;">' + label + '</td>' +
      '<td style="padding:10px 16px;border-bottom:1px solid #eee;font-size:13px;font-weight:600;">' + value + '</td>' +
    '</tr>'
  );
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function calcPrice(age, tier) {
  var pricing = {
    earlybird: { u10: 0,   u17: 100, adu: 200 },
    regular:   { u10: 50,  u17: 150, adu: 250 },
    late:      { u10: 300, u17: 300, adu: 300 },
  };
  var p = pricing[tier] || pricing.earlybird;
  if (age <= 10) return p.u10;
  if (age <= 17) return p.u17;
  return p.adu;
}
