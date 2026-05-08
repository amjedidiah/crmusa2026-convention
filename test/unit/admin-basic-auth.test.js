import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAdminBasicAuthConfig,
  parseBasicAuthorizationHeader,
  verifyAdminBasicAuthorization,
} from '../../api/_lib/admin-basic-auth.js';

test('getAdminBasicAuthConfig requires both username and password', () => {
  assert.deepEqual(
    getAdminBasicAuthConfig({
      ADMIN_BASIC_AUTH_USER: 'staff',
      ADMIN_BASIC_AUTH_PASSWORD: '',
    }),
    {
      username: 'staff',
      password: '',
      configured: false,
    },
  );
});

test('parseBasicAuthorizationHeader decodes valid basic auth', () => {
  const creds = parseBasicAuthorizationHeader('Basic c3RhZmY6c2VjcmV0');
  assert.deepEqual(creds, {
    username: 'staff',
    password: 'secret',
  });
});

test('parseBasicAuthorizationHeader rejects malformed values', () => {
  assert.equal(parseBasicAuthorizationHeader('Bearer token'), null);
  assert.equal(parseBasicAuthorizationHeader('Basic !!!'), null);
  assert.equal(parseBasicAuthorizationHeader('Basic c3RhZmY='), null);
});

test('verifyAdminBasicAuthorization fails closed when env is missing', () => {
  assert.deepEqual(verifyAdminBasicAuthorization(null, {}), {
    ok: false,
    status: 503,
    error: 'admin_basic_auth_not_configured',
  });
});

test('verifyAdminBasicAuthorization accepts matching credentials only', () => {
  const env = {
    ADMIN_BASIC_AUTH_USER: 'staff',
    ADMIN_BASIC_AUTH_PASSWORD: 'secret',
  };

  assert.deepEqual(
    verifyAdminBasicAuthorization('Basic c3RhZmY6c2VjcmV0', env),
    { ok: true },
  );

  assert.deepEqual(
    verifyAdminBasicAuthorization('Basic c3RhZmY6d3Jvbmc=', env),
    {
      ok: false,
      status: 401,
      error: 'invalid_basic_auth_credentials',
    },
  );
});
