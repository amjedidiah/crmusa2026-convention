import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLookupToken,
  verifyLookupToken,
} from '../../api/_lib/tokens.js';

const SECRET = 'unit-test-lookup-secret-key';

test('createLookupToken / verifyLookupToken round-trip', () => {
  const token = createLookupToken(
    { registration_id: '11111111-1111-1111-1111-111111111111', lookup_token_version: 2 },
    { secret: SECRET, nowSeconds: 1_700_000_000, ttlSeconds: 3600 }
  );
  const v = verifyLookupToken(token, { secret: SECRET, nowSeconds: 1_700_000_100 });
  assert.equal(v.valid, true);
  assert.equal(v.payload.registration_id, '11111111-1111-1111-1111-111111111111');
  assert.equal(v.payload.lookup_token_version, 2);
});

test('verifyLookupToken rejects expired token', () => {
  const token = createLookupToken(
    { registration_id: '11111111-1111-1111-1111-111111111111', lookup_token_version: 1 },
    { secret: SECRET, nowSeconds: 1_700_000_000, ttlSeconds: 60 }
  );
  const v = verifyLookupToken(token, { secret: SECRET, nowSeconds: 1_700_000_200 });
  assert.equal(v.valid, false);
  assert.equal(v.reason, 'expired');
});

test('verifyLookupToken rejects tampered signature', () => {
  const token = createLookupToken(
    { registration_id: '11111111-1111-1111-1111-111111111111', lookup_token_version: 1 },
    { secret: SECRET, nowSeconds: 1_700_000_000, ttlSeconds: 3600 }
  );
  const broken = token.slice(0, -4) + 'xxxx';
  const v = verifyLookupToken(broken, { secret: SECRET, nowSeconds: 1_700_000_100 });
  assert.equal(v.valid, false);
  assert.equal(v.reason, 'signature');
});

test('createLookupToken uses LOOKUP_TOKEN_TTL_SECONDS when ttlSeconds omitted', () => {
  const prev = process.env.LOOKUP_TOKEN_TTL_SECONDS;
  process.env.LOOKUP_TOKEN_TTL_SECONDS = '86400';
  try {
    const token = createLookupToken(
      { registration_id: '11111111-1111-1111-1111-111111111111', lookup_token_version: 1 },
      { secret: SECRET, nowSeconds: 1_700_000_000 }
    );
    assert.equal(
      verifyLookupToken(token, { secret: SECRET, nowSeconds: 1_700_000_000 + 86399 }).valid,
      true
    );
    assert.equal(
      verifyLookupToken(token, { secret: SECRET, nowSeconds: 1_700_000_000 + 86401 }).valid,
      false
    );
  } finally {
    if (prev === undefined) delete process.env.LOOKUP_TOKEN_TTL_SECONDS;
    else process.env.LOOKUP_TOKEN_TTL_SECONDS = prev;
  }
});
