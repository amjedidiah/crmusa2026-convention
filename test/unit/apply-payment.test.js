import assert from 'node:assert/strict';
import test from 'node:test';

import { rpcErrorMessage } from '../../api/_lib/apply-payment.js';

test('rpcErrorMessage extracts string, message, error, hint', () => {
  assert.equal(rpcErrorMessage({ data: 'duplicate_external_ref' }), 'duplicate_external_ref');
  assert.equal(rpcErrorMessage({ data: { message: 'overpayment_not_allowed' } }), 'overpayment_not_allowed');
  assert.equal(rpcErrorMessage({ data: { error: 'registration_not_found' } }), 'registration_not_found');
  assert.equal(rpcErrorMessage({ data: { hint: 'try again' } }), 'try again');
  assert.equal(rpcErrorMessage({ data: {} }), 'request_failed');
  assert.equal(rpcErrorMessage(null), 'request_failed');
});
