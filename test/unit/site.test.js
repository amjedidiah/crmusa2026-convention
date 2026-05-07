import assert from 'node:assert/strict';
import test from 'node:test';

import { getRequestOrigin } from '../../api/_lib/site.js';

function restoreSiteUrl(prev) {
  if (prev === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = prev;
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
