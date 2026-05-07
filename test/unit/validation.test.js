import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAttendees, validateContact } from '../../api/_lib/validation.js';

test('validateContact requires fields and valid email', () => {
  const bad = validateContact({});
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.first_name);
  assert.ok(bad.errors.email);

  const good = validateContact({
    first_name: 'Ann',
    last_name: 'Lee',
    email: 'Ann.Example@Domain.COM',
  });
  assert.equal(good.valid, true);
  assert.equal(good.normalized.email_normalized, 'ann.example@domain.com');
});

test('validateAttendees requires at least one valid row', () => {
  const bad = validateAttendees([]);
  assert.equal(bad.valid, false);

  const good = validateAttendees([{ name: 'Kid', age: 10 }]);
  assert.equal(good.valid, true);
  assert.equal(good.normalized[0].age, 10);
});
