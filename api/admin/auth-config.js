import { decodeJwtPayload } from '../_lib/jwt-payload.js';
import { staffCorsHeaders, handleStaffOptions } from '../_lib/staff-auth.js';
import { serverLog } from '../_lib/server-log.js';

export default async function handler(req, res) {
  Object.entries(staffCorsHeaders(req)).forEach(([k, v]) =>
    res.setHeader(k, v),
  );
  if (handleStaffOptions(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;

  if (!url || !anon) {
    serverLog('error', 'admin.auth_config_not_configured', {
      route: '/api/admin/auth-config',
      detail: 'missing SUPABASE_URL or SUPABASE_ANON_KEY',
    });
    return res.status(503).json({
      error: 'not_configured',
    });
  }

  const jwtPayload = decodeJwtPayload(anon);
  if (jwtPayload?.role === 'service_role') {
    serverLog('error', 'admin.auth_config_service_role_blocked', {
      route: '/api/admin/auth-config',
      detail: 'SUPABASE_ANON_KEY must be the anon JWT, not service_role',
    });
    return res.status(500).json({ error: 'misconfigured_key' });
  }

  /*
   * NOTE: This route is intentionally unauthenticated. It returns SUPABASE_URL and
   * the project anon key so admin-sync can bootstrap the browser Supabase client
   * before any session exists. The anon key is a public credential (RLS + Auth
   * enforce access). Never set SUPABASE_ANON_KEY to the service_role JWT.
   */
  return res.status(200).json({
    supabase_url: url.replace(/\/+$/, ''),
    supabase_anon_key: anon,
  });
}
