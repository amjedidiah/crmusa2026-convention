import { next } from '@vercel/functions';

import {
  ADMIN_BASIC_AUTH_REALM,
  verifyAdminBasicAuthorization,
} from './api/_lib/admin-basic-auth.js';

function deniedResponse(status, body, withChallenge) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (withChallenge) {
    headers['WWW-Authenticate'] =
      `Basic realm="${ADMIN_BASIC_AUTH_REALM}", charset="UTF-8"`;
  }
  return new Response(body, { status, headers });
}

export default function middleware(request) {
  const auth = verifyAdminBasicAuthorization(
    request.headers.get('authorization'),
  );

  if (!auth.ok) {
    if (auth.status === 503) {
      return deniedResponse(
        503,
        'Admin gate is not configured. Set ADMIN_BASIC_AUTH_USER and ADMIN_BASIC_AUTH_PASSWORD.',
        false,
      );
    }

    return deniedResponse(
      401,
      'Authentication required.',
      true,
    );
  }

  return next({
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export const config = {
  matcher: ['/admin-sync.html', '/admin-sync-app.js', '/api/admin/:path*'],
};
