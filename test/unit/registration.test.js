import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeTierForDate,
  attendeePriceCents,
  calculateRegistrationTotalCents,
  deriveRegistrationStatus,
  normalizePhoneForDedup,
  parseAttendeesFromColumn,
} from '../../api/_lib/registration.js';

test('activeTierForDate earlybird / regular / late boundaries (Chicago)', () => {
  assert.equal(activeTierForDate(new Date('2026-06-10T17:00:00Z')), 'earlybird');
  assert.equal(activeTierForDate(new Date('2026-06-16T17:00:00Z')), 'regular');
  assert.equal(activeTierForDate(new Date('2026-07-17T17:00:00Z')), 'late');
});

test('attendeePriceCents respects tier brackets', () => {
  assert.equal(attendeePriceCents(8, 'earlybird'), 0);
  assert.equal(attendeePriceCents(15, 'regular'), 15000);
  assert.equal(attendeePriceCents(40, 'late'), 30000);
});

test('calculateRegistrationTotalCents sums attendees', () => {
  const tier = 'earlybird';
  const attendees = [
    { name: 'A', age: 5 },
    { name: 'B', age: 14 },
    { name: 'C', age: 40 },
  ];
  assert.equal(calculateRegistrationTotalCents(attendees, tier), 0 + 10000 + 20000);
});

test('deriveRegistrationStatus pending / partial / complete', () => {
  assert.equal(deriveRegistrationStatus(10000, 0), 'pending');
  assert.equal(deriveRegistrationStatus(10000, 5000), 'partial');
  assert.equal(deriveRegistrationStatus(10000, 10000), 'complete');
  assert.equal(deriveRegistrationStatus(0, 0), 'complete');
});

test('parseAttendeesFromColumn normalizes array, JSON string, and bad input', () => {
  const rows = [{ name: 'A', age: 10 }];
  assert.deepEqual(parseAttendeesFromColumn(rows), rows);
  assert.deepEqual(parseAttendeesFromColumn(JSON.stringify(rows)), rows);
  assert.deepEqual(parseAttendeesFromColumn('not-json'), []);
  assert.deepEqual(parseAttendeesFromColumn(null), []);
});

test('normalizePhoneForDedup: blank / short / US 10–11 digit / international', () => {
  assert.equal(normalizePhoneForDedup(''), null);
  assert.equal(normalizePhoneForDedup('   '), null);
  assert.equal(normalizePhoneForDedup('555-0101'), null);
  assert.equal(normalizePhoneForDedup('(555) 123-4567'), '5551234567');
  assert.equal(normalizePhoneForDedup('+1 555 123 4567'), '5551234567');
  assert.equal(normalizePhoneForDedup('+44 20 7946 0958'), '442079460958');
});
