import assert from "node:assert/strict";
import test from "node:test";

import {
  parseZeffyCsvText,
  splitCSVLine,
  stableZeffyExternalRef,
} from "../../api/_lib/zeffy-csv.js";

test("splitCSVLine handles quoted commas and doubled quotes", () => {
  assert.deepEqual(splitCSVLine('a,"b,c",d'), ["a", "b,c", "d"]);
  assert.deepEqual(splitCSVLine('"say ""hi""",x'), ['say "hi"', "x"]);
});

test("parseZeffyCsvText csv_empty when fewer than two non-blank lines", () => {
  const r = parseZeffyCsvText("");
  assert.equal(r.ok, false);
  assert.equal(r.error, "csv_empty");

  const r2 = parseZeffyCsvText("   \n  \n");
  assert.equal(r2.ok, false);
  assert.equal(r2.error, "csv_empty");

  const r3 = parseZeffyCsvText("only header row");
  assert.equal(r3.ok, false);
  assert.equal(r3.error, "csv_empty");
});

test("parseZeffyCsvText no_amount_column / no_registration_code_column", () => {
  const noAmt = parseZeffyCsvText("Pledge Code,Donor\nABC123,Jane\n");
  assert.equal(noAmt.ok, false);
  assert.equal(noAmt.error, "no_amount_column");

  const noCode = parseZeffyCsvText("Amount,Donor\n50,Jane\n");
  assert.equal(noCode.ok, false);
  assert.equal(noCode.error, "no_registration_code_column");
});

test("parseZeffyCsvText minimal valid CSV with pledge + amount", () => {
  const csv =
    "Date,Amount,Pledge Code,First Name,Last Name\n" +
    "2026-05-01,100.00,AB12CD,Jane,Doe\n";
  const r = parseZeffyCsvText(csv);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.equal(row.skip, false);
  assert.equal(row.pledge_code, "AB12CD");
  assert.equal(row.amount_dollars, 100);
  assert.equal(row.donor, "Jane Doe");
  assert.equal(row.date, "2026-05-01");
});

test("parseZeffyCsvText refund or failed status becomes skip row", () => {
  const csv =
    "Amount,Pledge Code,Payment Status\n" +
    "50,XX99ZZ,paid\n" +
    "25,YY88WW,refunded\n" +
    "10,AA11BB,failed\n";
  const r = parseZeffyCsvText(csv);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].skip, false);
  assert.equal(r.rows[1].skip, true);
  assert.equal(r.rows[1].skip_reason, "refunded_or_failed");
  assert.equal(r.rows[2].skip, true);
});

test("parseZeffyCsvText skips non-positive amounts and can yield empty rows", () => {
  const csv =
    "Amount,Pledge Code\n" +
    "0,AB12CD\n" +
    ",XY34MN\n" +
    "not-a-number,PQ56RS\n";
  const r = parseZeffyCsvText(csv);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 0);
});

test("parseZeffyCsvText csv_empty when file is header line only", () => {
  const r = parseZeffyCsvText("Amount,Pledge Code\n");
  assert.equal(r.ok, false);
  assert.equal(r.error, "csv_empty");
});

test("parseZeffyCsvText ok with zero rows when data lines yield no payments", () => {
  // Two non-blank lines so not csv_empty; body has <2 columns so loop skips.
  const csv = "Amount,Pledge Code\nx\n";
  const r = parseZeffyCsvText(csv);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 0);
});

test("stableZeffyExternalRef uses transaction hint when present", () => {
  const ref = stableZeffyExternalRef({
    external_hint: "txn-abc-123",
    pledge_code: "X",
    amount_dollars: 1,
    date: "",
    donor: "",
    row_signature: "",
  });
  assert.equal(ref, "zeffy:txn-abc-123");
});

test("stableZeffyExternalRef hash is stable for identical row inputs", () => {
  const row = {
    external_hint: "",
    pledge_code: "LM99QP",
    amount_dollars: 200,
    date: "2026-05-02",
    donor: "Pat Lee",
    row_signature: "sig-a",
  };
  const a = stableZeffyExternalRef(row);
  const b = stableZeffyExternalRef({ ...row });
  assert.equal(a, b);
  assert.match(a, /^zeffy:row-[0-9a-f]{16}$/);
});

test("stableZeffyExternalRef differs when row signature changes", () => {
  const base = {
    external_hint: "",
    pledge_code: "LM99QP",
    amount_dollars: 200,
    date: "2026-05-02",
    donor: "Pat Lee",
    row_signature: "sig-a",
  };
  const a = stableZeffyExternalRef(base);
  const b = stableZeffyExternalRef({ ...base, row_signature: "sig-b" });
  assert.notEqual(a, b);
});

test("parseZeffyCsvText Amount column with dollar sign and commas", () => {
  const csv =
    "Amount,Pledge Code,Name\n" +
    '"$1,234.50",ZZ11QQ,Org Donation\n';
  const r = parseZeffyCsvText(csv);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].amount_dollars, 1234.5);
  assert.equal(r.rows[0].pledge_code, "ZZ11QQ");
});

test("parseZeffyCsvText Registration Code column alias", () => {
  const csv = "Donation Amount,Registration Code\n" + "75.00,RR22SS\n";
  const r = parseZeffyCsvText(csv);
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].pledge_code, "RR22SS");
  assert.equal(r.rows[0].amount_dollars, 75);
});
