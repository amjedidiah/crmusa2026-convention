import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStaffMagicLinkRedirectUrl,
  getRequestOrigin,
} from '../../api/_lib/site.js';

function restoreSiteUrl(prev) {
  if (prev === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = prev;
}

function restoreStaffMagicLinkRedirect(prev) {
  if (prev === undefined) delete process.env.STAFF_MAGIC_LINK_REDIRECT;
  else process.env.STAFF_MAGIC_LINK_REDIRECT = prev;
}

test('getRequestOrigin uses SITE_URL when set', () => {
  const prev = process.env.SITE_URL;
  process.env.SITE_URL = 'https://example.com/';
  try {
    assert.equal(getRequestOrigin({ headers: {} }), 'https://example.com');
  } finally {
    restoreSiteUrl(prev);
  }
});

test('getRequestOrigin takes first x-forwarded-proto when comma-separated', () => {
  const prev = process.env.SITE_URL;
  delete process.env.SITE_URL;
  try {
    const origin = getRequestOrigin({
      headers: {
        'x-forwarded-proto': 'https,http',
        'x-forwarded-host': 'api.example.com, inner',
        host: 'api.example.com',
      },
    });
    assert.equal(origin, 'https://api.example.com');
  } finally {
    restoreSiteUrl(prev);
  }
});

test('getRequestOrigin ignores bogus x-forwarded-proto', () => {
  const prev = process.env.SITE_URL;
  delete process.env.SITE_URL;
  try {
    const origin = getRequestOrigin({
      headers: {
        'x-forwarded-proto': 'javascript:void(0)',
        host: 'safe.example.com',
      },
    });
    assert.equal(origin, 'https://safe.example.com');
  } finally {
    restoreSiteUrl(prev);
  }
});

test('getRequestOrigin uses http only for real localhost-style hosts', () => {
  const prev = process.env.SITE_URL;
  delete process.env.SITE_URL;
  try {
    assert.equal(
      getRequestOrigin({ headers: { host: 'localhost:3000' } }),
      'http://localhost:3000'
    );
    assert.equal(
      getRequestOrigin({ headers: { host: 'notlocalhost.com' } }),
      'https://notlocalhost.com'
    );
  } finally {
    restoreSiteUrl(prev);
  }
});

test('getRequestOrigin rejects newline in host', () => {
  const prev = process.env.SITE_URL;
  delete process.env.SITE_URL;
  try {
    assert.equal(
      getRequestOrigin({
        headers: { host: 'evil.com\r\nX-Injected: 1' },
      }),
      null
    );
  } finally {
    restoreSiteUrl(prev);
  }
});

test('buildStaffMagicLinkRedirectUrl uses SITE_URL + admin-sync path', () => {
  const prevSite = process.env.SITE_URL;
  const prevStaff = process.env.STAFF_MAGIC_LINK_REDIRECT;
  process.env.SITE_URL = 'http://127.0.0.1:3000/';
  delete process.env.STAFF_MAGIC_LINK_REDIRECT;
  try {
    assert.equal(
      buildStaffMagicLinkRedirectUrl({ headers: {} }),
      'http://127.0.0.1:3000/admin-sync.html'
    );
  } finally {
    restoreSiteUrl(prevSite);
    restoreStaffMagicLinkRedirect(prevStaff);
  }
});

test('buildStaffMagicLinkRedirectUrl prefers STAFF_MAGIC_LINK_REDIRECT', () => {
  const prevSite = process.env.SITE_URL;
  const prevStaff = process.env.STAFF_MAGIC_LINK_REDIRECT;
  process.env.SITE_URL = 'https://ignored.example/';
  process.env.STAFF_MAGIC_LINK_REDIRECT =
    'https://preview.vercel.app/admin-sync.html/';
  try {
    assert.equal(
      buildStaffMagicLinkRedirectUrl({ headers: {} }),
      'https://preview.vercel.app/admin-sync.html'
    );
  } finally {
    restoreSiteUrl(prevSite);
    restoreStaffMagicLinkRedirect(prevStaff);
  }
});
