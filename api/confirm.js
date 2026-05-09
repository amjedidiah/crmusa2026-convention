/* ─────────────────────────────────────────────────────────────────────
   /api/confirm  —  Registration confirmation + staff notification
   Reused by /api/register after persistence succeeds. POST requires
   Authorization: Bearer <CONVENTION_CONFIRM_SECRET> (manual / tooling only).
───────────────────────────────────────────────────────────────────── */

import { serverLog } from './_lib/server-log.js';
import {
  assertConventionConfirmationRouting,
  assertConventionOutboundIdentity,
  parseStaffNotifyEmails,
  resolveConventionMailFrom,
  resolveConventionMailReplyTo,
  resolveZelleRecipientEmail,
} from './_lib/convention-mail.js';
import {
  assertTransactionalEmailReady,
  sendTransactionalEmail,
} from './_lib/email-send.js';

const DEFAULT_SITE_URL = "https://crmusa2026-convention.crm-na.org";

function publicSiteUrl() {
  return (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

const TIER_LABELS = {
  earlybird: 'Early Bird (Apr 1 - Jun 15)',
  regular:   'Regular (Jun 16 - Jul 16)',
  late:      'Late (Jul 17+)',
};

function fmtUsd(n) {
  const x = Number(n);
  return (Number.isFinite(x) ? x : 0).toFixed(2);
}

function pledgeOneLine(code) {
  return String(code ?? "")
    .replaceAll(/[\r\n\u2028\u2029]/g, " ")
    .trim();
}

export async function sendConfirmationEmails(payload) {
  const {
    registration_id: registrationId,
    first_name, last_name, email, phone, church,
    pledge_code, tier, total_pledged, total_amount, amount_paid, attendees,
    lookup_url,
    payment_intent_cents: rawIntentCents,
    include_staff_notification: includeStaffRaw,
  } = payload || {};

  const includeStaffNotification = includeStaffRaw !== false;

  if (!email || !pledge_code) {
    throw new Error('Missing email or pledge_code');
  }

  assertTransactionalEmailReady();
  assertConventionConfirmationRouting({ includeStaffNotification });

  const fromAddr = resolveConventionMailFrom();
  const replyTo = resolveConventionMailReplyTo();
  const zelleEmail = resolveZelleRecipientEmail();

  let notifyList = [];
  if (includeStaffNotification) {
    notifyList = parseStaffNotifyEmails();
    if (notifyList.length === 0) {
      serverLog('error', 'confirm.staff_notify_empty', {
        route: 'confirm.sendConfirmationEmails',
        registration_id: registrationId || null,
        pledge_code: pledge_code || null,
      });
    }
  }

  let intentCents = 0;
  if (rawIntentCents !== undefined && rawIntentCents !== null && rawIntentCents !== '') {
    const n = Number(rawIntentCents);
    if (Number.isFinite(n)) intentCents = Math.max(0, Math.floor(n));
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
  const safePledge = esc(pledge_code);
  const subjectPledge = pledgeOneLine(pledge_code);

  /* ── Build attendee rows ── */
  const attRows = attList.map(function(a, i) {
    let age = Number.parseInt(a.age);
    let amt = Number.isNaN(age) ? Number.NaN : calcPrice(age, tier);
    let price = "";
    if (!Number.isNaN(age)) {
      price = amt === 0 ? "Free" : "$" + amt;
    }
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

  let bodyPara = "";
  if (total <= 0) {
    bodyPara =
      'Your registration is <strong style="color:#7dbf80;">free</strong>. We look forward to seeing you in Houston!';
  } else if (paid === 0) {
    bodyPara =
      'Your convention total is <strong style="color:#E8C87A;">$' + fmtUsd(total) + '</strong>. ' +
      'You have <strong>$0 recorded as paid</strong> so far — please complete payment via Zelle or Zeffy using the instructions below. ' +
      'Your balance will be updated within 3-5 business days once we receive payment.';
  } else if (trulyFullyPaid) {
    bodyPara =
      'We have recorded <strong style="color:#7dbf80;">$' + fmtUsd(paid) + '</strong> toward your registration. ' +
      'Your balance is <strong style="color:#7dbf80;">paid in full</strong> — see you in Houston!';
  } else {
    bodyPara =
      'Your convention total is <strong style="color:#E8C87A;">$' + fmtUsd(total) + '</strong>. ' +
      'We recorded <strong style="color:#7dbf80;">$' + fmtUsd(paid) + '</strong> toward your registration. ' +
      'Remaining balance: <strong style="color:#E8C87A;">$' + fmtUsd(remaining) + '</strong>. ' +
      'Complete payment using the instructions below.';
  }

  if (intentCents > 0 && total > 0 && !trulyFullyPaid) {
    bodyPara +=
      ' You indicated you plan to pay <strong style="color:#E8C87A;">$' +
      fmtUsd(intentCents / 100) +
      '</strong> today; that amount is <strong>not</strong> recorded until staff reconcile Zelle or Zeffy.';
  }

  let remLabel;
  let remColor;
  if (remaining > 0) {
    remLabel = "$" + fmtUsd(remaining);
    remColor = "#E8C87A";
  } else if (trulyFullyPaid) {
    remLabel = "Fully Paid ✓";
    remColor = "#7dbf80";
  } else {
    remLabel = "$" + fmtUsd(0);
    remColor = "rgba(245,239,224,0.55)";
  }

  let paymentCtaHref = lookup_url
    ? esc(lookup_url)
    : publicSiteUrl() + "#return";
  let paymentCtaLabel = lookup_url
    ? "View registration &amp; pay"
    : "Continue payment on site";
  let paymentCtaIntro = lookup_url
    ? "Use your secure returning-registration link below to open the Already Registered payment page with your balance already loaded."
    : "Open the Already Registered payment page on the convention site to continue your payment.";

  let paymentInstructions;
  if (remaining > 0) {
    paymentInstructions =
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(200,168,90,0.06);border:1px solid rgba(200,168,90,0.2);margin-bottom:24px;">' +
      '<tr><td style="padding:20px 24px;">' +
      '<p style="margin:0 0 12px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,168,90,0.6);">How to Pay</p>' +
      '<p style="margin:0 0 6px;font-size:13px;color:rgba(245,239,224,0.8);"><strong style="color:#E8C87A;">Option 1 - Zelle (Free, instant):</strong></p>' +
      '<p style="margin:0 0 14px;font-size:13px;color:rgba(245,239,224,0.6);line-height:1.8;">' +
      'Send to <strong style="color:#E8C87A;">' +
      esc(zelleEmail) +
      "</strong>. " +
      'Put your pledge code <strong style="color:#E8C87A;letter-spacing:3px;font-family:Courier New,monospace;">' +
      safePledge +
      "</strong> in the Memo/Note field." +
      "</p>" +
      '<p style="margin:0 0 6px;font-size:13px;color:rgba(245,239,224,0.8);"><strong style="color:#E8C87A;">Option 2 - Card via Zeffy:</strong></p>' +
      '<p style="margin:0 0 16px;font-size:13px;color:rgba(245,239,224,0.6);line-height:1.8;">' +
      "Use the giving portal on the convention site. Enter your pledge code " +
      '<strong style="color:#E8C87A;letter-spacing:3px;font-family:Courier New,monospace;">' +
      safePledge +
      "</strong> " +
      'in the <strong style="color:#E8C87A;">Conference Registration Code</strong> field.' +
      "</p>" +
      '<p style="margin:0 0 16px;font-size:13px;color:rgba(245,239,224,0.6);line-height:1.8;">' +
      paymentCtaIntro +
      "</p>" +
      '<a href="' +
      paymentCtaHref +
      '" style="display:inline-block;padding:11px 28px;background:#C8A85A;color:#0B1628;text-decoration:none;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">' +
      paymentCtaLabel +
      "</a>" +
      "</td></tr>" +
      "</table>";
  } else if (trulyFullyPaid) {
    paymentInstructions =
      '<p style="margin:0 0 24px;font-size:13px;color:rgba(245,239,224,0.55);text-align:center;background:rgba(125,191,128,0.08);border:1px solid rgba(125,191,128,0.2);padding:14px;line-height:1.7;">' +
      'Your registration is <strong style="color:#7dbf80;">fully paid</strong>. We look forward to seeing you in Houston!' +
      "</p>";
  } else {
    paymentInstructions =
      '<p style="margin:0 0 24px;font-size:13px;color:rgba(245,239,224,0.55);line-height:1.7;text-align:center;">' +
      "If a convention fee applies, pay via Zelle or Zeffy using your pledge code. Reply to this email if you need help." +
      "</p>";
  }

  let staffBalanceText;
  let staffBalanceColor;
  if (remaining > 0) {
    staffBalanceText = "$" + fmtUsd(remaining) + " outstanding";
    staffBalanceColor = "#B8860B";
  } else if (trulyFullyPaid) {
    staffBalanceText = "Fully Paid";
    staffBalanceColor = "green";
  } else {
    staffBalanceText =
      "$" + fmtUsd(0) + " — verify total in Supabase if fee expected";
    staffBalanceColor = "#888";
  }

  let intentStaffRow =
    intentCents > 0
      ? notifyRow(
          "Pay-today (intent, not posted)",
          '<span style="color:#666;">$' + fmtUsd(intentCents / 100) + "</span>",
        )
      : "";

  let lookupLinkBlock = lookup_url
    ? '<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(125,191,128,0.06);border:1px solid rgba(125,191,128,0.22);margin-bottom:26px;">' +
      '<tr><td style="padding:20px 24px;">' +
      '<p style="margin:0 0 8px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(125,191,128,0.7);">Your secure registration link</p>' +
      '<p style="margin:0 0 16px;font-size:13px;color:rgba(245,239,224,0.65);line-height:1.75;">' +
      "Bookmark or save this link to reopen the Already Registered payment page with your balance and payment options already loaded. " +
      "The link expires in 7 days; you can request a fresh link from the convention site using your email and pledge code." +
      "</p>" +
      '<a href="' +
      esc(lookup_url) +
      '" style="display:inline-block;padding:12px 28px;background:#7dbf80;color:#0B1628;text-decoration:none;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">View registration &amp; balance</a>' +
      "</td></tr>" +
      "</table>"
    : "";

  /* ── Confirmation email to registrant ── */
  let confirmHtml =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>CRM 2026 Registration Confirmed</title></head>' +
    '<body style="margin:0;padding:0;background:#EDE8DF;font-family:Georgia,serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#EDE8DF;">' +
    '<tr><td align="center" style="padding:32px 16px;">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="background:#0B1628;max-width:600px;border:1px solid rgba(200,168,90,0.15);">' +
    /* Header */
    '<tr><td align="center" style="padding:36px 40px 28px;border-bottom:1px solid rgba(200,168,90,0.15);">' +
    '<p style="margin:0 0 6px;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:rgba(200,168,90,0.5);">Charismatic Renewal Ministries USA</p>' +
    '<h1 style="margin:0 0 6px;font-size:28px;font-weight:300;font-style:italic;color:#E8C87A;">Bringing In The Harvest</h1>' +
    '<p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(245,239,224,0.35);">National Convention 2026 &middot; Houston, TX</p>' +
    "</td></tr>" +
    /* Body */
    '<tr><td style="padding:32px 40px;">' +
    '<p style="margin:0 0 18px;font-size:15px;color:rgba(245,239,224,0.8);">Dear ' +
    esc(first_name || fullName) +
    ",</p>" +
    '<p style="margin:0 0 24px;font-size:14px;color:rgba(245,239,224,0.65);line-height:1.75;">' +
    "Your registration for the CRM USA 2026 National Convention has been confirmed. " +
    bodyPara +
    "</p>" +
    /* Pledge code box */
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(200,168,90,0.08);border:1px solid rgba(200,168,90,0.3);margin-bottom:26px;">' +
    '<tr><td align="center" style="padding:22px 24px;">' +
    '<p style="margin:0 0 8px;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:rgba(200,168,90,0.6);">Your Pledge Code</p>' +
    '<p style="margin:0 0 10px;font-size:38px;letter-spacing:14px;color:#E8C87A;font-family:Courier New,monospace;font-weight:700;">' +
    safePledge +
    "</p>" +
    '<p style="margin:0;font-size:11px;color:rgba(245,239,224,0.38);line-height:1.7;">' +
    "Save this code. Include it in your Zelle memo or Zeffy Registration Code field when paying." +
    "</p>" +
    "</td></tr>" +
    "</table>" +
    lookupLinkBlock +
    /* Balance table */
    '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(200,168,90,0.15);margin-bottom:26px;">' +
    '<tr style="background:rgba(200,168,90,0.07);">' +
    '<td style="padding:10px 16px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(200,168,90,0.55);">Registration Summary</td>' +
    '<td style="padding:10px 16px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(200,168,90,0.55);text-align:right;">' +
    esc(tierLabel) +
    "</td>" +
    "</tr>" +
    '<tr><td style="padding:10px 16px;font-size:13px;color:rgba(245,239,224,0.55);">Total Convention Cost</td>' +
    '<td style="padding:10px 16px;font-size:16px;color:#E8C87A;text-align:right;font-family:Georgia,serif;">$' +
    fmtUsd(total) +
    "</td></tr>" +
    '<tr style="border-top:1px solid rgba(200,168,90,0.08);">' +
    '<td style="padding:10px 16px;font-size:13px;color:rgba(245,239,224,0.55);">Amount Paid</td>' +
    '<td style="padding:10px 16px;font-size:16px;color:#7dbf80;text-align:right;font-family:Georgia,serif;">$' +
    fmtUsd(paid) +
    "</td></tr>" +
    '<tr style="border-top:1px solid rgba(200,168,90,0.15);">' +
    '<td style="padding:12px 16px;font-size:14px;color:#F5EFE0;font-weight:bold;">Remaining Balance</td>' +
    '<td style="padding:12px 16px;font-size:20px;color:' +
    remColor +
    ';text-align:right;font-family:Georgia,serif;font-weight:bold;">' +
    remLabel +
    "</td></tr>" +
    "</table>" +
    /* Attendees */
    '<p style="margin:0 0 10px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,168,90,0.55);">Registered Attendees</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(200,168,90,0.1);margin-bottom:26px;">' +
    attRows +
    "</table>" +
    paymentInstructions +
    /* Convention details */
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(200,168,90,0.05);border:1px solid rgba(200,168,90,0.13);margin-bottom:24px;">' +
    '<tr><td style="padding:22px 26px;">' +
    '<p style="margin:0 0 10px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(200,168,90,0.55);">Convention Details</p>' +
    '<p style="margin:0 0 4px;font-size:15px;font-style:italic;color:#E8C87A;">Bringing In The Harvest</p>' +
    '<p style="margin:0 0 4px;font-size:13px;color:rgba(245,239,224,0.7);">July 29 - August 2, 2026</p>' +
    '<p style="margin:0 0 4px;font-size:13px;color:rgba(245,239,224,0.7);">Holiday Inn NW Houston</p>' +
    '<p style="margin:0 0 16px;font-size:12px;color:rgba(245,239,224,0.38);">3539 N Sam Houston Pkwy West, Houston, TX 77086</p>' +
    '<a href="' +
    publicSiteUrl() +
    '" style="display:inline-block;padding:9px 22px;background:#C8A85A;color:#0B1628;text-decoration:none;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">View Convention Site</a>' +
    "</td></tr>" +
    "</table>" +
    '<p style="margin:0;font-size:12px;color:rgba(245,239,224,0.3);line-height:1.8;">' +
    'Questions? Reply to this email or contact us at <a href="mailto:' +
    esc(replyTo) +
    '" style="color:#C8A85A;">' +
    esc(replyTo) +
    "</a>" +
    "</p>" +
    "</td></tr>" +
    '<tr><td align="center" style="padding:18px 40px;border-top:1px solid rgba(200,168,90,0.1);">' +
    '<p style="margin:0;font-size:10px;color:rgba(245,239,224,0.2);">2026 Charismatic Renewal Ministries USA, Houston, Texas</p>' +
    "</td></tr>" +
    "</table></td></tr></table></body></html>";

  /* ── Staff notification email ── */
  let notifyHtml =
    '<div style="font-family:Arial,sans-serif;padding:24px;background:#f9f9f9;">' +
    '<div style="background:#0B1628;padding:16px 24px;margin-bottom:0;">' +
    '<h2 style="margin:0;color:#C8A85A;font-size:18px;">New Convention Registration</h2>' +
    "</div>" +
    '<table style="background:#fff;border-collapse:collapse;width:100%;max-width:560px;border:1px solid #ddd;">' +
    notifyRow("Name", esc(fullName)) +
    notifyRow("Email", esc(email)) +
    notifyRow("Phone", esc(phone || "—")) +
    notifyRow("Church", esc(church || "—")) +
    notifyRow(
      "Pledge Code",
      '<span style="font-family:Courier New,monospace;font-size:22px;color:#C8A85A;letter-spacing:5px;font-weight:bold;">' +
        safePledge +
        "</span>",
    ) +
    notifyRow("Tier", esc(tierLabel)) +
    notifyRow("Total Pledged", "$" + fmtUsd(total)) +
    notifyRow(
      "Amount Paid",
      '<span style="color:green;">$' + fmtUsd(paid) + "</span>",
    ) +
    intentStaffRow +
    notifyRow(
      "Balance Due",
      '<span style="color:' +
        staffBalanceColor +
        ';font-weight:bold;">' +
        staffBalanceText +
        "</span>",
    ) +
    notifyRow("Attendees", attList.length + " person(s)") +
    "</table>" +
    '<p style="margin:16px 0 0;font-size:12px;color:#999;">Automated notification from CRM 2026 convention registration system.</p>' +
    "</div>";

  /* ── Registrant email + optional staff notification ── */
  const confirmTask = sendTransactionalEmail({
    from: fromAddr,
    to: [email],
    replyTo,
    subject: 'CRM 2026 Registration Confirmed - Code: ' + subjectPledge,
    html: confirmHtml,
  });

  const tasks = [confirmTask];
  if (includeStaffNotification && notifyList.length > 0) {
    tasks.push(
      sendTransactionalEmail({
        from: fromAddr,
        to: notifyList,
        replyTo,
        subject: 'NEW REGISTRATION: ' + fullName + ' - Code ' + subjectPledge,
        html: notifyHtml,
      })
    );
  }

  const settled = await Promise.allSettled(tasks);
  const confirmResult = settled[0];
  const notifyResult =
    includeStaffNotification && notifyList.length > 0 ? settled[1] : { status: 'fulfilled', value: undefined };

  if (confirmResult.status === 'rejected') {
    serverLog('error', 'confirm.registration_email_failed', {
      route: 'confirm.sendConfirmationEmails',
      registration_id: registrationId || null,
      pledge_code: pledge_code || null,
      detail: String(confirmResult.reason),
    });
  } else {
    serverLog('info', 'confirm.registration_email_sent', {
      route: 'confirm.sendConfirmationEmails',
      registration_id: registrationId || null,
      pledge_code: pledge_code || null,
    });
  }

  if (includeStaffNotification && notifyList.length > 0) {
    if (notifyResult.status === 'rejected') {
      serverLog('error', 'confirm.staff_notification_failed', {
        route: 'confirm.sendConfirmationEmails',
        registration_id: registrationId || null,
        pledge_code: pledge_code || null,
        detail: String(notifyResult.reason),
      });
    } else {
      serverLog('info', 'confirm.staff_notification_sent', {
        route: 'confirm.sendConfirmationEmails',
        registration_id: registrationId || null,
        recipient_count: notifyList.length,
      });
    }
  }

  const notificationSent =
    includeStaffNotification && notifyList.length > 0
      ? notifyResult.status === 'fulfilled'
      : false;

  return {
    ok              : true,
    confirmSent     : confirmResult.status === 'fulfilled',
    notificationSent,
    errors          : [
      confirmResult.status === 'rejected' ? confirmResult.reason : null,
      includeStaffNotification && notifyList.length > 0 && notifyResult.status === 'rejected'
        ? notifyResult.reason
        : null,
    ].filter(Boolean),
  };
}

export async function sendLookupLinkEmail({ email, first_name, lookup_url, registration_id: registrationId }) {
  if (!email || !lookup_url) {
    throw new Error('Missing email or lookup_url');
  }

  assertTransactionalEmailReady();
  assertConventionOutboundIdentity();

  const fromAddr = resolveConventionMailFrom();
  const replyTo = resolveConventionMailReplyTo();

  const greeting = esc(first_name || 'there');
  const plainName =
    String(first_name || "there")
      .replaceAll(/[\r\n\u2028\u2029]/g, " ")
      .trim() || "there";
  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Your CRM 2026 registration link</title></head>' +
    '<body style="margin:0;padding:0;background:#EDE8DF;font-family:Georgia,serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#EDE8DF;">' +
    '<tr><td align="center" style="padding:32px 16px;">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="background:#0B1628;max-width:600px;border:1px solid rgba(200,168,90,0.15);">' +
    '<tr><td style="padding:32px 40px;">' +
      '<p style="margin:0 0 18px;font-size:15px;color:rgba(245,239,224,0.8);">Hello ' + greeting + ',</p>' +
      '<p style="margin:0 0 22px;font-size:14px;color:rgba(245,239,224,0.65);line-height:1.75;">' +
        'Here is your secure link to view your convention registration summary and balance. ' +
        'This link expires in 7 days.' +
      '</p>' +
      '<a href="' + esc(lookup_url) + '" style="display:inline-block;padding:14px 32px;background:#C8A85A;color:#0B1628;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Open my registration</a>' +
      '<p style="margin:28px 0 0;font-size:12px;color:rgba(245,239,224,0.35);line-height:1.8;">' +
        'If you did not request this email, you can ignore it. Questions? ' +
        '<a href="mailto:' + esc(replyTo) + '" style="color:#C8A85A;">' + esc(replyTo) + '</a>' +
      '</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';

  const text =
    'Hello ' + plainName + ',\n\n' +
    'Here is your secure link to view your CRM USA 2026 convention registration summary and balance. ' +
    'This link expires in 7 days.\n\n' +
    lookup_url + '\n\n' +
    'If you did not request this email, you can ignore it. Questions? ' + replyTo + '\n';

  await sendTransactionalEmail({
    from: fromAddr,
    to: [email],
    replyTo,
    subject: 'Your CRM 2026 registration link',
    html,
    text,
  });

  serverLog('info', 'confirm.lookup_link_email_sent', {
    route: 'confirm.sendLookupLinkEmail',
    registration_id: registrationId || null,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CONVENTION_CONFIRM_SECRET?.trim();
  if (!secret) {
    return res.status(503).json({ error: 'Confirmation endpoint is not configured.' });
  }
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
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
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Age brackets 0–10 / 11–17 / 18+; amounts must match api/_lib/registration.js PRICING_CENTS. */
function calcPrice(age, tier) {
  let pricing = {
    earlybird: { u10: 0, u17: 100, adu: 200 },
    regular: { u10: 50, u17: 150, adu: 250 },
    late: { u10: 300, u17: 300, adu: 300 },
  };
  let p = pricing[tier] || pricing.earlybird;
  if (age <= 10) return p.u10;
  if (age < 18) return p.u17;
  return p.adu;
}
