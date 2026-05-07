import crypto from "crypto";

import {
  staffApplyRegistrationPayment,
  rpcErrorMessage,
} from "../../_lib/apply-payment.js";
import { normalizeReceivedAt } from "../../_lib/dates.js";
import { serverLog } from "../../_lib/server-log.js";
import {
  getStaffFromRequest,
  handleStaffOptions,
  staffCorsHeaders,
} from "../../_lib/staff-auth.js";

export default async function handler(req, res) {
  Object.entries(staffCorsHeaders(req)).forEach(([k, v]) =>
    res.setHeader(k, v),
  );
  if (handleStaffOptions(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staff = await getStaffFromRequest(req);
  if (!staff.ok) {
    return res.status(staff.status).json({ error: staff.error });
  }

  const body = req.body || {};
  const {
    registration_id: registrationId,
    amount_dollars: amountDollars,
    amount_cents: amountCentsRaw,
    received_at: receivedAt,
    notes,
    payment_source: paymentSource,
    external_ref: externalRefIn,
    confirm_overpayment: confirmOverpayment,
  } = body;

  if (!registrationId || typeof registrationId !== "string") {
    return res.status(400).json({ error: "registration_id_required" });
  }

  let amountCents;
  const centsProvided =
    amountCentsRaw != null && amountCentsRaw !== "";

  if (centsProvided) {
    const n = Number(amountCentsRaw);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: "invalid_amount_cents" });
    }
    amountCents = Math.round(n);
    if (amountCents <= 0) {
      return res.status(400).json({ error: "invalid_amount_cents" });
    }
  } else if (amountDollars != null && amountDollars !== "") {
    const n = Number(amountDollars);
    if (Number.isFinite(n) && n > 0) {
      amountCents = Math.round(parseFloat(n.toFixed(2)) * 100);
    }
  }

  if (!amountCents || amountCents <= 0) {
    return res.status(400).json({ error: "valid_amount_required" });
  }

  const source =
    String(paymentSource || "zelle_manual").trim() || "zelle_manual";
  const externalRef =
    (externalRefIn && String(externalRefIn).trim()) ||
    `manual-${crypto.randomUUID()}`;

  let result;
  try {
    result = await staffApplyRegistrationPayment({
      registrationId,
      source,
      externalRef,
      amountCents,
      receivedAt: normalizeReceivedAt(receivedAt),
      notes: notes != null ? String(notes) : null,
      rawPayload: {
        entry: "staff_manual",
        payment_source: source,
      },
      createdBy: staff.email,
      allowOverpayment: !!confirmOverpayment,
    });
  } catch (err) {
    serverLog("error", "payment.manual_exception", {
      route: "/api/admin/payments/manual",
      registration_id: registrationId,
      payment_external_ref: externalRef,
      staff_email: staff.email,
      detail: err?.message,
    });
    return res.status(500).json({ error: "internal_error" });
  }

  if (!result.ok) {
    const msg = rpcErrorMessage(result);
    serverLog("error", "payment.manual_failed", {
      route: "/api/admin/payments/manual",
      registration_id: registrationId,
      payment_external_ref: externalRef,
      detail: msg,
      rpc_payload:
        typeof result.data === "string"
          ? result.data.slice(0, 800)
          : result.data != null
            ? JSON.stringify(result.data).slice(0, 800)
            : null,
    });
    if (
      /overpayment_not_allowed|duplicate_external_ref|registration_not_found|invalid_/.test(
        msg,
      )
    ) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }

  const payload = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!payload) {
    serverLog("error", "payment.manual_empty_result", {
      route: "/api/admin/payments/manual",
      registration_id: registrationId,
      payment_external_ref: externalRef,
    });
    return res.status(500).json({ error: "empty_result" });
  }

  serverLog("info", "payment.manual_applied", {
    route: "/api/admin/payments/manual",
    registration_id: registrationId,
    payment_id: payload?.payment_id || null,
    payment_external_ref: externalRef,
    staff_email: staff.email,
  });
  return res.status(200).json({
    ok: true,
    registration: payload,
    new_paid: (payload?.amount_paid_cents || 0) / 100,
    new_balance: (payload?.remaining_cents || 0) / 100,
    new_status: payload?.status,
  });
}
