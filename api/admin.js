/* ─────────────────────────────────────────────────────────────────────
   /api/admin  —  PIN-protected admin API
   Handles: lookup, update_payment, get_report
   Service role key lives here in env vars — never exposed to browser
───────────────────────────────────────────────────────────────────── */

const ADMIN_PIN    = process.env.ADMIN_PIN || 'CRM2026ADMIN';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  /* ── CORS for same-origin browser calls ── */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { pin, action, payload } = req.body || {};

  /* ── Auth ── */
  if (!pin || pin !== ADMIN_PIN) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server not configured — add SUPABASE_URL and SUPABASE_SERVICE_KEY to Vercel env vars' });
  }

  /* ── Supabase helper ── */
  async function supa(method, path, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        method === 'POST' ? 'return=representation' : 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    return { ok: r.ok, status: r.status, data };
  }

  /* ── ACTIONS ── */

  /* Lookup a registration by pledge code or email */
  if (action === 'lookup') {
    const { value } = payload || {};
    if (!value) return res.status(400).json({ error: 'value required' });
    const isEmail = value.indexOf('@') > -1;
    const field   = isEmail ? `email=eq.${encodeURIComponent(value.toLowerCase().trim())}`
                             : `pledge_code=eq.${encodeURIComponent(value.toUpperCase().trim())}`;
    const r = await supa('GET', `registrations?${field}&limit=1&select=*`);
    if (!r.ok || !r.data || !r.data.length) {
      return res.status(404).json({ error: 'No registration found' });
    }
    return res.status(200).json({ registration: r.data[0] });
  }

  /* Record a payment against a registration */
  if (action === 'update_payment') {
    const { registration_id, pledge_code, amount_to_add, date_received, method, notes } = payload || {};
    if (!registration_id || !amount_to_add) {
      return res.status(400).json({ error: 'registration_id and amount_to_add required' });
    }

    /* Fetch current record */
    const current = await supa('GET', `registrations?id=eq.${registration_id}&select=*`);
    if (!current.ok || !current.data || !current.data.length) {
      return res.status(404).json({ error: 'Registration not found' });
    }
    const reg = current.data[0];
    const newPaid = (reg.amount_paid || 0) + parseFloat(amount_to_add);
    const newRem  = (reg.total_pledged || 0) - newPaid;
    const newStatus = newRem <= 0 ? 'complete' : 'partial';

    /* Update registration */
    const upd = await supa('PATCH', `registrations?id=eq.${registration_id}`, {
      amount_paid: newPaid,
      status:      newStatus,
    });
    if (!upd.ok) return res.status(500).json({ error: 'Update failed', detail: upd.data });

    /* Log to pledge_payments */
    await supa('POST', 'pledge_payments', {
      registration_id,
      amount:      parseFloat(amount_to_add),
      flw_tx_ref:  `manual-${method||'zelle'}-${date_received||new Date().toISOString().slice(0,10)}`,
      status:      'success',
    });

    return res.status(200).json({
      ok:         true,
      new_paid:   newPaid,
      new_balance: Math.max(0, newRem),
      new_status: newStatus,
    });
  }

  /* Get full report of all registrations */
  if (action === 'report') {
    const r = await supa('GET',
      'registrations?select=pledge_code,first_name,last_name,email,phone,church,city,tier,total_pledged,amount_paid,status,created_at,attendees&order=created_at.desc'
    );
    if (!r.ok) return res.status(500).json({ error: 'Failed to fetch report', detail: r.data });
    return res.status(200).json({ registrations: r.data });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
