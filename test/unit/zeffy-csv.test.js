import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseZeffyCsvText,
  splitCSVLine,
  stableZeffyExternalRef,
} from '../../api/_lib/zeffy-csv.js';

test('splitCSVLine handles quoted commas', () => {
  assert.deepEqual(splitCSVLine('"a,b",c'), ['a,b', 'c']);
});

test('splitCSVLine trims unquoted fields only', () => {
  assert.deepEqual(splitCSVLine('  a  ,b'), ['a', 'b']);
  assert.deepEqual(splitCSVLine('"  spaced  ",x'), ['  spaced  ', 'x']);
});

test('parseZeffyCsvText parses amount and pledge code', () => {
  const csv = ['amount,pledge code,status', '100.50,EAR123,paid'].join('\n');
  const r = parseZeffyCsvText(csv);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].pledge_code, 'EAR123');
  assert.equal(r.rows[0].amount_dollars, 100.5);
});

test('parseZeffyCsvText skips refunded rows', () => {
  const csv = ['amount,pledge code,status', '10,EAR123,refunded'].join('\n');
  const r = parseZeffyCsvText(csv);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].skip, true);
});

test('stableZeffyExternalRef prefers transaction hint', () => {
  const ref = stableZeffyExternalRef({
    external_hint: 'txn-abc',
    pledge_code: 'X',
    amount_dollars: 1,
    date: '',
    row_index: 1,
  });
  assert.equal(ref, 'zeffy:txn-abc');
});
