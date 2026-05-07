import { serverLog } from "../_lib/server-log.js";
import {
  getStaffFromRequest,
  handleStaffOptions,
  staffCorsHeaders,
} from "../_lib/staff-auth.js";
import { supabaseRestRequest } from "../_lib/supabase.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  Object.entries(staffCorsHeaders(req)).forEach(([k, v]) =>
    res.setHeader(k, v),
  );
  if (handleStaffOptions(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staff = await getStaffFromRequest(req);
  if (!staff.ok) {
    return res.status(staff.status).json({ error: staff.error });
  }

  const registrationId = String(req.query.registration_id || "").trim();
  if (!registrationId || !UUID_RE.test(registrationId)) {
    return res.status(400).json({ error: "registration_id_invalid" });
  }

  const path =
    `registration_payments?registration_id=eq.${encodeURIComponent(registrationId)}` +
    "&select=amount_cents,received_at,source,external_ref,notes,created_at" +
    "&order=created_at.desc&limit=60";

  const r = await supabaseRestRequest("GET", path);
  if (!r.ok) {
    serverLog("error", "admin.registration_payments_query_failed", {
      route: "/api/admin/registration-payments",
      staff_email: staff.email,
      http_status: r.status,
      detail: r.data,
    });
    return res.status(500).json({ error: "query_failed" });
  }

  const rows = Array.isArray(r.data) ? r.data : [];
  return res.status(200).json({ payments: rows });
}
