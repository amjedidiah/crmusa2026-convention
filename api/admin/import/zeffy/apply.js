import { staffApplyRegistrationPayment, rpcErrorMessage } from '../../../_lib/apply-payment.js';
import { normalizeReceivedAt } from '../../../_lib/dates.js';
import { serverLog } from '../../../_lib/server-log.js';
import {
  getStaffFromRequest,
  handleStaffOptions,
  staffCorsHeaders,
} from '../../../_lib/staff-auth.js';
import { supabaseRestRequest } from '../../../_lib/supabase.js';

export default async function handler(req, res) {
  Object.entries(staffCorsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (handleStaffOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const staff = await getStaffFromRequest(req);
  if (!staff.ok) {
    return res.status(staff.status).json({ error: staff.error });
  }

  const { items, confirm_overpayment: confirmOverpayment } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items_required' });
  }

  const results = [];

  for (let i = 0; i < items.length; i += 1) {
    const row = items[i] || {};
    const {
      registration_id: registrationId,
      external_ref: externalRef,
      amount_cents: amountCentsRaw,
      received_at: receivedAt,
      notes,
    } = row;

    if (!registrationId || !externalRef) {
      results.push({
        index: i,
        ok: false,
        error: 'missing_registration_id_or_external_ref',
      });
      serverLog('warn', 'payment.zeffy_apply_row_skipped', {
        route: '/api/admin/import/zeffy/apply',
        row_index: i,
        detail: 'missing_registration_id_or_external_ref',
      });
      continue;
    }

    const amountCents = Math.round(Number(amountCentsRaw));
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      results.push({
        index: i,
        ok: false,
        error: 'invalid_amount_cents',
        registration_id: registrationId,
      });
      serverLog('warn', 'payment.zeffy_apply_row_skipped', {
        route: '/api/admin/import/zeffy/apply',
        registration_id: registrationId,
        payment_external_ref: String(externalRef).trim(),
        detail: 'invalid_amount_cents',
      });
      continue;
    }

    const regRes = await supabaseRestRequest(
      'GET',
      `registrations?id=eq.${registrationId}&select=id,pledge_code,total_cents,amount_paid_cents&limit=1`
    );
    const regRow =
      regRes.ok && Array.isArray(regRes.data) && regRes.data[0]
        ? regRes.data[0]
        : null;
    if (!regRow) {
      results.push({
        index: i,
        ok: false,
        error: 'registration_not_found',
        registration_id: registrationId,
      });
      serverLog('warn', 'payment.zeffy_apply_row_skipped', {
        route: '/api/admin/import/zeffy/apply',
        registration_id: registrationId,
        payment_external_ref: String(externalRef).trim(),
        detail: 'registration_not_found',
      });
      continue;
    }

    const result = await staffApplyRegistrationPayment({
      registrationId,
      source: 'zeffy',
      externalRef: String(externalRef).trim(),
      amountCents,
      receivedAt: normalizeReceivedAt(receivedAt),
      notes: notes != null ? String(notes) : null,
      rawPayload: { import: 'zeffy_csv', row_index: i },
      createdBy: staff.email,
      allowOverpayment: !!confirmOverpayment,
    });

    if (!result.ok) {
      const msg = rpcErrorMessage(result);
      results.push({
        index: i,
        ok: false,
        error: msg,
        registration_id: registrationId,
      });
      serverLog('error', 'payment.zeffy_apply_row_failed', {
        route: '/api/admin/import/zeffy/apply',
        registration_id: registrationId,
        payment_external_ref: String(externalRef).trim(),
        detail: msg,
      });
      continue;
    }

    const payload = Array.isArray(result.data) ? result.data[0] : result.data;
    serverLog('info', 'payment.zeffy_row_applied', {
      route: '/api/admin/import/zeffy/apply',
      registration_id: registrationId,
      payment_id: payload?.payment_id || null,
      payment_external_ref: String(externalRef).trim(),
      staff_email: staff.email,
    });
    results.push({
      index: i,
      ok: true,
      registration_id: registrationId,
      pledge_code: regRow.pledge_code,
      summary: payload,
    });
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  serverLog('info', 'payment.zeffy_apply_batch_complete', {
    route: '/api/admin/import/zeffy/apply',
    applied: okCount,
    failed: failCount,
    staff_email: staff.email,
  });

  return res.status(200).json({
    ok: failCount === 0,
    applied: okCount,
    failed: failCount,
    results,
  });
}
