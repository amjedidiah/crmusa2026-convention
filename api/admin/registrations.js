import { registrationToAdminJson } from '../_lib/admin-registration.js';
import { normalizeEmail } from '../_lib/registration.js';
import {
  getStaffFromRequest,
  handleStaffOptions,
  staffCorsHeaders,
} from '../_lib/staff-auth.js';
import { supabaseRestRequest } from '../_lib/supabase.js';

export default async function handler(req, res) {
  Object.entries(staffCorsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (handleStaffOptions(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const staff = await getStaffFromRequest(req);
  if (!staff.ok) {
    return res.status(staff.status).json({ error: staff.error });
  }

  const lookupRaw = req.query.lookup || req.query.q || '';
  const pledgeParam = req.query.pledge_code || '';
  const limit = Math.min(
    500,
    Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200)
  );

  let path;

  if (String(pledgeParam).trim()) {
    const code = String(pledgeParam).trim().toUpperCase();
    path = `registrations?pledge_code=eq.${encodeURIComponent(code)}&select=*`;
  } else if (String(lookupRaw).trim()) {
    const v = String(lookupRaw).trim();
    if (v.includes('@')) {
      const em = normalizeEmail(v);
      path = `registrations?email_normalized=eq.${encodeURIComponent(em)}&select=*`;
    } else {
      path = `registrations?pledge_code=eq.${encodeURIComponent(v.toUpperCase())}&select=*`;
    }
  } else if (req.query.search && String(req.query.search).trim()) {
    const raw = String(req.query.search).trim().replace(/[*\\]/g, '');
    const pat = `*${raw}*`;
    path =
      `registrations?or=(pledge_code.ilike.${encodeURIComponent(pat)},` +
      `email.ilike.${encodeURIComponent(pat)},` +
      `first_name.ilike.${encodeURIComponent(pat)},` +
      `last_name.ilike.${encodeURIComponent(pat)})` +
      `&order=created_at.desc&limit=${limit}&select=*`;
  } else {
    path = `registrations?order=created_at.desc&limit=${limit}&select=*`;
  }

  const r = await supabaseRestRequest('GET', path);
  if (!r.ok) {
    return res.status(500).json({ error: 'query_failed', detail: r.data });
  }

  const rows = Array.isArray(r.data) ? r.data : [];
  return res.status(200).json({
    registrations: rows.map(registrationToAdminJson),
  });
}
