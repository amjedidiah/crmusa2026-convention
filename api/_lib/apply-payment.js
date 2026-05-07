import { supabaseRestRequest } from './supabase.js';

export async function staffApplyRegistrationPayment({
  registrationId,
  source,
  externalRef,
  amountCents,
  receivedAt,
  notes,
  rawPayload,
  createdBy,
  createdByStaffUserId,
  createdByStaffEmail,
  importBatchId,
  allowOverpayment,
}) {
  return supabaseRestRequest("POST", "rpc/staff_apply_registration_payment", {
    body: {
      p_registration_id: registrationId,
      p_source: source,
      p_external_ref: externalRef,
      p_amount_cents: amountCents,
      p_received_at: receivedAt ?? null,
      p_notes: notes ?? null,
      p_raw_payload: rawPayload ?? {},
      p_created_by: createdBy ?? null,
      p_created_by_staff_user_id: createdByStaffUserId ?? null,
      p_created_by_staff_email: createdByStaffEmail ?? null,
      p_import_batch_id: importBatchId ?? null,
      p_allow_overpayment: !!allowOverpayment,
    },
  });
}

export function rpcErrorMessage(response) {
  const d = response?.data;
  if (typeof d === 'string') return d;
  if (d?.message) return d.message;
  if (d?.error) return d.error;
  if (d?.hint) return d.hint;
  const e = response?.error;
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  if (e?.hint) return e.hint;
  return 'request_failed';
}
