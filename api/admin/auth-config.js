import { staffCorsHeaders, handleStaffOptions } from '../_lib/staff-auth.js';

export default async function handler(req, res) {
  Object.entries(staffCorsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (handleStaffOptions(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;

  if (!url || !anon) {
    return res.status(500).json({
      error: 'not_configured',
      message:
        'Set SUPABASE_URL and SUPABASE_ANON_KEY for staff magic-link sign-in.',
    });
  }

  return res.status(200).json({
    supabase_url: url.replace(/\/+$/, ''),
    supabase_anon_key: anon,
  });
}
