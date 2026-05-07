/* Legacy monolithic admin — removed in Phase 4. */

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return res.status(410).json({
    error: 'deprecated',
    message:
      'PIN admin is retired. Use staff sign-in on admin-sync.html and the /api/admin/* routes.',
  });
}
