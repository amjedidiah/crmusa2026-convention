/* Legacy monolithic admin — removed in Phase 4. */

import { staffCorsHeaders } from './_lib/staff-auth.js';

export default async function handler(req, res) {
  Object.entries(staffCorsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return res.status(410).json({
    error: 'deprecated',
    message:
      'PIN admin is retired. Use staff sign-in on admin-sync.html and the /api/admin/* routes.',
  });
}
