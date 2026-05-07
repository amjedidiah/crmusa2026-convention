import { createHash } from "node:crypto";

/**
 * Parse Zeffy / itemized payments CSV (same heuristics as legacy admin-sync).
 */

export function splitCSVLine(line) {
  const result = [];
  const quoted = [];
  let cur = '';
  let inQ = false;
  let fieldQuoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      const next = line[i + 1];
      if (inQ && next === '"') {
        cur += '"';
        i += 1;
      } else {
        if (!inQ) {
          fieldQuoted = true;
        }
        inQ = !inQ;
      }
    } else if (c === ',' && !inQ) {
      result.push(cur);
      quoted.push(fieldQuoted);
      cur = '';
      fieldQuoted = false;
    } else {
      cur += c;
    }
  }
  result.push(cur);
  quoted.push(fieldQuoted);
  return result.map((s, i) => (quoted[i] ? s : s.trim()));
}

function buildRowSignature(cols) {
  return cols
    .map((value) =>
      String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase(),
    )
    .join("\u001f");
}

function colIndex(headers, kws) {
  for (let ki = 0; ki < kws.length; ki += 1) {
    for (let hi = 0; hi < headers.length; hi += 1) {
      if (headers[hi].includes(kws[ki])) return hi;
    }
  }
  return -1;
}

export function parseZeffyCsvText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) {
    return { ok: false, error: "csv_empty", headers: [], rows: [] };
  }

  const headers = splitCSVLine(lines[0]).map((h) => h.toLowerCase().trim());

  const cDate = colIndex(headers, ["date", "created"]);
  const cFirst = colIndex(headers, ["first name", "firstname", "first"]);
  const cLast = colIndex(headers, ["last name", "lastname", "last"]);
  const cName = colIndex(headers, ["name", "buyer", "donor"]);
  const cAmt = colIndex(headers, ["amount", "total", "donation"]);
  const cStatus = colIndex(headers, ["status", "payment status"]);
  const cCode = colIndex(headers, [
    "registration code",
    "pledge code",
    "conference code",
    "registration",
  ]);
  const cTxn = colIndex(headers, [
    "transaction id",
    "transaction",
    "payment id",
    "payment_id",
    "order id",
  ]);

  if (cAmt === -1) {
    return {
      ok: false,
      error: "no_amount_column",
      headers,
      rows: [],
      headerList: headers,
    };
  }
  if (cCode === -1) {
    return {
      ok: false,
      error: "no_registration_code_column",
      headers,
      rows: [],
      headerList: headers,
    };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < 2) continue;
    const amtRaw = (cols[cAmt] || "").replace(/[$,\s]/g, "");
    const amt = parseFloat(amtRaw);
    if (Number.isNaN(amt) || amt <= 0) continue;

    const status =
      cStatus > -1 ? String(cols[cStatus] || "").toLowerCase() : "paid";
    if (
      status.includes("refund") ||
      status.includes("cancel") ||
      status.includes("fail")
    ) {
      rows.push({
        row_index: i,
        skip: true,
        skip_reason: "refunded_or_failed",
        status_raw: status,
        amount_dollars: amt,
        pledge_code: "",
        donor: "",
        date: "",
        external_hint: cTxn > -1 ? String(cols[cTxn] || "").trim() : "",
        row_signature: buildRowSignature(cols),
      });
      continue;
    }

    const donor =
      cFirst > -1 && cLast > -1
        ? `${cols[cFirst] || ""} ${cols[cLast] || ""}`.trim()
        : String(cName > -1 ? cols[cName] || "" : "").trim();
    const code = String(cols[cCode] || "")
      .replace(/\s/g, "")
      .toUpperCase();
    const date = cDate > -1 ? String(cols[cDate] || "").trim() : "";
    const extHint = cTxn > -1 ? String(cols[cTxn] || "").trim() : "";

    rows.push({
      row_index: i,
      skip: false,
      skip_reason: null,
      amount_dollars: amt,
      pledge_code: code,
      donor,
      date,
      status_raw: status,
      external_hint: extHint,
      row_signature: buildRowSignature(cols),
    });
  }

  return { ok: true, headers, rows };
}

export function stableZeffyExternalRef(row) {
  const hint = String(row.external_hint || "").trim();
  if (hint) {
    return `zeffy:${hint}`;
  }
  const code = String(row.pledge_code || "");
  const amt = String(row.amount_dollars);
  const d = String(row.date || "");
  const donor = String(row.donor || "");
  const signature = String(row.row_signature || "");
  const base = `${code}|${amt}|${d}|${donor}|${signature}`;
  const h = createHash("sha256").update(base).digest("hex").slice(0, 16);
  return `zeffy:row-${h}`;
}
