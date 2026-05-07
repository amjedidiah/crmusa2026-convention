import { registrationToAdminJson } from '../../../_lib/admin-registration.js';
import { serverLog } from '../../../_lib/server-log.js';
import {
  getStaffFromRequest,
  handleStaffOptions,
  staffCorsHeaders,
} from '../../../_lib/staff-auth.js';
import { supabaseRestRequest } from '../../../_lib/supabase.js';
import {
  parseZeffyCsvText,
  stableZeffyExternalRef,
} from '../../../_lib/zeffy-csv.js';

async function fetchRegistrationsByPledgeCodes(codes) {
  const map = new Map();
  const unique = [...new Set(codes.filter(Boolean))];
  const chunkSize = 60;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const part = unique.slice(i, i + chunkSize);
    const inList = `(${part.map((c) => encodeURIComponent(c)).join(',')})`;
    const path = `registrations?pledge_code=in.${inList}&select=*`;
    const r = await supabaseRestRequest('GET', path);
    if (!r.ok) {
      return {
        ok: false,
        error: 'registration_lookup_failed',
        detail: r.data,
        chunk: part,
      };
    }
    const rows = Array.isArray(r.data) ? r.data : [];
    rows.forEach((row) => {
      if (row?.pledge_code) map.set(String(row.pledge_code).toUpperCase(), row);
    });
  }
  return { ok: true, map };
}

async function fetchExistingZeffyRefs(refs) {
  const existing = new Set();
  const unique = [...new Set(refs.filter(Boolean))];
  const chunkSize = 50;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const part = unique.slice(i, i + chunkSize);
    const inList = `(${part.map((c) => encodeURIComponent(c)).join(',')})`;
    const path = `registration_payments?source=eq.zeffy&external_ref=in.${inList}&select=external_ref`;
    const r = await supabaseRestRequest('GET', path);
    if (!r.ok) {
      return {
        ok: false,
        error: 'existing_payment_lookup_failed',
        detail: r.data,
        chunk: part,
      };
    }
    const rows = Array.isArray(r.data) ? r.data : [];
    rows.forEach((row) => {
      if (row?.external_ref) existing.add(row.external_ref);
    });
  }
  return { ok: true, existing };
}

export default async function handler(req, res) {
  Object.entries(staffCorsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));
  if (handleStaffOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const staff = await getStaffFromRequest(req);
  if (!staff.ok) {
    return res.status(staff.status).json({ error: staff.error });
  }

  const { csv_text: csvText } = req.body || {};
  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({ error: 'csv_text_required' });
  }

  const parsed = parseZeffyCsvText(csvText);
  if (!parsed.ok) {
    return res.status(400).json({
      error: parsed.error,
      headers: parsed.headerList || parsed.headers,
    });
  }

  const pledgeCodes = parsed.rows
    .filter((r) => !r.skip && r.pledge_code)
    .map((r) => r.pledge_code);

  const regLookup = await fetchRegistrationsByPledgeCodes(pledgeCodes);
  if (!regLookup.ok) {
    serverLog('error', 'zeffy.preview_registration_lookup_failed', {
      route: '/api/admin/import/zeffy/preview',
      staff_email: staff.email,
      detail: regLookup.detail,
      chunk: regLookup.chunk,
    });
    return res.status(502).json({ error: regLookup.error });
  }
  const regMap = regLookup.map;

  const previewRows = parsed.rows.map((row) => {
    if (row.skip) {
      return {
        row_index: row.row_index,
        skip: true,
        skip_reason: row.skip_reason,
        status_raw: row.status_raw,
        amount_dollars: row.amount_dollars,
        flags: ['refunded_or_failed'],
        registration: null,
        proposed_external_ref: null,
      };
    }

    if (!row.pledge_code) {
      return {
        row_index: row.row_index,
        skip: false,
        amount_dollars: row.amount_dollars,
        amount_cents: Math.round(row.amount_dollars * 100),
        pledge_code: '',
        donor: row.donor,
        date: row.date,
        flags: ['no_pledge_code'],
        registration: null,
        proposed_external_ref: stableZeffyExternalRef(row),
      };
    }

    const reg = regMap.get(String(row.pledge_code || '').toUpperCase()) || null;
    const amountCents = Math.round(row.amount_dollars * 100);
    const proposedExternalRef = stableZeffyExternalRef(row);

    const flags = [];
    if (!reg) flags.push('unmatched');

    let remainingCents = null;
    let wouldOverpay = false;
    if (reg) {
      const total = Number(reg.total_cents) || 0;
      const paid = Number(reg.amount_paid_cents) || 0;
      remainingCents = Math.max(0, total - paid);
      wouldOverpay = amountCents > remainingCents;
      if (wouldOverpay) flags.push('overpayment');
    }

    return {
      row_index: row.row_index,
      skip: false,
      amount_dollars: row.amount_dollars,
      amount_cents: amountCents,
      pledge_code: row.pledge_code,
      donor: row.donor,
      date: row.date,
      flags,
      would_overpay: wouldOverpay,
      remaining_cents: remainingCents,
      registration: reg ? registrationToAdminJson(reg) : null,
      proposed_external_ref: proposedExternalRef,
    };
  });

  const refs = previewRows
    .map((r) => r.proposed_external_ref)
    .filter(Boolean);

  const refsInBatch = new Map();
  refs.forEach((ref) => {
    refsInBatch.set(ref, (refsInBatch.get(ref) || 0) + 1);
  });

  const existingLookup = await fetchExistingZeffyRefs(refs);
  if (!existingLookup.ok) {
    serverLog('error', 'zeffy.preview_existing_ref_lookup_failed', {
      route: '/api/admin/import/zeffy/preview',
      staff_email: staff.email,
      detail: existingLookup.detail,
      chunk: existingLookup.chunk,
    });
    return res.status(502).json({ error: existingLookup.error });
  }
  const existingRefs = existingLookup.existing;

  previewRows.forEach((r) => {
    if (
      r.proposed_external_ref &&
      (existingRefs.has(r.proposed_external_ref) ||
        (refsInBatch.get(r.proposed_external_ref) || 0) > 1)
    ) {
      if (!r.flags.includes('duplicate')) r.flags.push('duplicate');
    }
  });

  const matched = previewRows.filter(
    (r) => r.registration && !r.skip && !r.flags.includes('unmatched')
  ).length;
  const unmatched = previewRows.filter((r) =>
    r.flags.includes('unmatched')
  ).length;
  const duplicates = previewRows.filter((r) =>
    r.flags.includes('duplicate')
  ).length;
  const overpay = previewRows.filter((r) =>
    r.flags.includes('overpayment')
  ).length;

  serverLog('info', 'zeffy.preview_complete', {
    route: '/api/admin/import/zeffy/preview',
    staff_email: staff.email,
    summary: {
      total_rows: previewRows.length,
      matched,
      unmatched,
      duplicates,
      overpayment_rows: overpay,
      skipped_refunds: previewRows.filter((r) => r.skip).length,
    },
  });

  return res.status(200).json({
    ok: true,
    rows: previewRows,
    summary: {
      total_rows: previewRows.length,
      matched,
      unmatched,
      duplicates,
      overpayment_rows: overpay,
      skipped_refunds: previewRows.filter((r) => r.skip).length,
    },
  });
}
