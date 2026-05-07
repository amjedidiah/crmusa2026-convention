/* global supabase */

var sb = null;
var currentReg = null;
var reportData = [];
var zMatchedRows = [];
var zLastCsvText = '';
var batchRows = [];
var manualPaymentBusy = false;
var szConfirmBusy = false;
var zeffyApplyBusy = false;
var batchApplyBusy = false;

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('main-screen').classList.add('hidden');
}

function showMainScreen(email) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  var el = document.getElementById('staff-email-display');
  if (el) el.textContent = email || '';
  var payDate = document.getElementById('pay-date');
  if (payDate && !payDate.value) {
    payDate.value = new Date().toISOString().slice(0, 10);
  }
  var szd = document.getElementById('sz-date');
  if (szd && !szd.value) {
    szd.value = new Date().toISOString().slice(0, 10);
  }
}

async function loadAuthConfig() {
  var r = await fetch('/api/admin/auth-config');
  var d = await r.json().catch(function () {
    return {};
  });
  if (!r.ok) {
    throw new Error(d.message || d.error || 'Could not load auth configuration');
  }
  return d;
}

async function initSupabase() {
  var cfg = await loadAuthConfig();
  sb = supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_OUT' || !session) {
      showLoginScreen();
    } else if (session.user && session.user.email) {
      showMainScreen(session.user.email);
    }
  });

  var existing = await sb.auth.getSession();
  if (existing.data.session && existing.data.session.user) {
    showMainScreen(existing.data.session.user.email);
  } else {
    showLoginScreen();
  }
}

async function staffFetch(path, options) {
  var opts = options || {};
  var sessionRes = await sb.auth.getSession();
  var session = sessionRes.data.session;
  if (!session) {
    showLoginScreen();
    throw new Error('session_expired');
  }
  var headers = Object.assign({}, opts.headers || {});
  headers.Authorization = 'Bearer ' + session.access_token;
  if (opts.body && typeof opts.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }
  var r = await fetch(path, Object.assign({}, opts, { headers: headers }));
  if (r.status === 401 || r.status === 403) {
    await sb.auth.signOut();
    showLoginScreen();
    var errText =
      r.status === 403
        ? 'Not authorized (check STAFF_EMAIL_ALLOWLIST).'
        : 'Session expired — sign in again.';
    throw new Error(errText);
  }
  return r;
}

async function staffJson(path, options) {
  var r = await staffFetch(path, options);
  var d = await r.json().catch(function () {
    return {};
  });
  if (!r.ok) {
    throw new Error(d.error || d.message || 'Request failed');
  }
  return d;
}

async function sendMagicLink() {
  var input = document.getElementById('staff-email-input');
  var msg = document.getElementById('login-msg');
  var btn = document.getElementById('login-send-btn');
  if (!sb) {
    msg.className = 'msg msg-err';
    msg.textContent =
      'Sign-in is not ready yet. Refresh the page or verify SUPABASE_ANON_KEY on the server.';
    msg.classList.remove('hidden');
    return;
  }
  var email = (input.value || '').trim().toLowerCase();
  if (!email) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Enter your staff email address.';
    msg.classList.remove('hidden');
    return;
  }
  btn.disabled = true;
  msg.classList.remove('hidden');
  msg.className = 'msg msg-inf';
  msg.textContent = 'Sending link…';
  try {
    var redirect = window.location.href.split('#')[0];
    var res = await sb.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: redirect },
    });
    if (res.error) throw res.error;
    msg.className = 'msg msg-ok';
    msg.textContent =
      'Check your email for the sign-in link. You can close this tab after clicking it.';
  } catch (e) {
    msg.className = 'msg msg-err';
    msg.textContent = e.message || 'Could not send sign-in email.';
  } finally {
    btn.disabled = false;
  }
}

async function signOut() {
  await sb.auth.signOut();
  showLoginScreen();
}

/* ── TABS ── */
function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach(function (b, i) {
    b.className =
      'tab-btn' + (['payment', 'zelle', 'zeffy', 'report'][i] === name ? ' on' : '');
  });
  document.querySelectorAll('.tab-panel').forEach(function (p) {
    p.className = 'tab-panel';
  });
  document.getElementById('tab-' + name).className = 'tab-panel on';
}

function regTotalPledged(reg) {
  if (!reg) return 0;
  if (reg.total_cents != null && reg.total_cents !== '') {
    var tc = Number(reg.total_cents);
    return Number.isFinite(tc) ? tc / 100 : 0;
  }
  var raw =
    reg.total_pledged != null && reg.total_pledged !== ''
      ? reg.total_pledged
      : reg.total_amount;
  var t = parseFloat(raw);
  return Number.isFinite(t) ? t : 0;
}

function regAmountPaid(reg) {
  if (!reg) return 0;
  if (reg.amount_paid_cents != null && reg.amount_paid_cents !== '') {
    var pc = Number(reg.amount_paid_cents);
    return Number.isFinite(pc) ? pc / 100 : 0;
  }
  var p = parseFloat(reg.amount_paid);
  return Number.isFinite(p) ? p : 0;
}

/** Preview cell when pled is known dollars; avoids bogus negatives when pled is 0 */
function adminPreviewBalanceHtml(pled, afterRem) {
  if (!(pled > 0)) return '—';
  if (afterRem <= 0) return '<span style="color:#7dbf80;">Fully Paid</span>';
  return '$' + afterRem.toFixed(2) + ' left';
}

/* ── LOOKUP ── */
function lookupReg() {
  var v = document.getElementById('lu-val').value.trim();
  if (!v) return;
  var btn = document.getElementById('lu-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Looking up…';
  showMsg('lu-msg', '');
  staffJson('/api/admin/registrations?lookup=' + encodeURIComponent(v))
    .then(function (data) {
      var list = data.registrations || [];
      if (!list.length) {
        showMsg('lu-msg', 'No registration found.', 'err');
        return;
      }
      currentReg = list[0];
      renderRegCard(currentReg);
      document.getElementById('reg-card').classList.remove('hidden');
      document.getElementById('payment-card').classList.remove('hidden');
      document.getElementById('lookup-card').style.opacity = '0.5';
    })
    .catch(function (err) {
      showMsg('lu-msg', err.message || String(err), 'err');
    })
    .then(function () {
      btn.disabled = false;
      btn.textContent = 'Look Up →';
    });
}

function renderRegCard(r) {
  var pled = regTotalPledged(r);
  var paid = regAmountPaid(r);
  var remaining = Math.max(0, pled - paid);
  var pct = pled > 0 ? Math.round((paid / pled) * 100) : 0;
  document.getElementById('reg-display').innerHTML =
    '<div class="pledge-code">' +
    esc(r.pledge_code) +
    '</div>' +
    '<div class="reg-name">' +
    esc(r.first_name + ' ' + r.last_name) +
    '</div>' +
    '<div class="reg-grid" style="margin-bottom:1rem;">' +
    '<span class="reg-lbl">Email</span>       <span class="reg-val">' +
    esc(r.email) +
    '</span>' +
    '<span class="reg-lbl">Church</span>      <span class="reg-val">' +
    esc(r.church || '—') +
    '</span>' +
    '<span class="reg-lbl">City</span>        <span class="reg-val">' +
    esc(r.city || '—') +
    '</span>' +
    '<span class="reg-lbl">Tier</span>        <span class="reg-val">' +
    esc(r.tier || '—') +
    '</span>' +
    '</div>' +
    '<div class="balance-row"><span class="lbl">Total Pledged</span>   <span class="val">$' +
    pled.toFixed(2) +
    '</span></div>' +
    '<div class="balance-row"><span class="lbl">Amount Paid</span>    <span class="val val-paid">$' +
    paid.toFixed(2) +
    '</span></div>' +
    '<div class="balance-row"><span class="lbl">Remaining Balance</span>' +
    '<span class="val ' +
    (pled > 0 && remaining <= 0 ? 'val-full' : 'val-due') +
    '">' +
    (pled > 0 && remaining <= 0 ? 'Fully Paid ✓' : '$' + remaining.toFixed(2)) +
    '</span></div>' +
    '<div style="margin-top:0.8rem;">' +
    '<div style="display:flex;justify-content:space-between;font-size:0.7rem;color:rgba(232,223,200,0.4);margin-bottom:0.3rem;">' +
    '<span>Payment progress</span><span>' +
    pct +
    '%</span>' +
    '</div>' +
    '<div class="prog-track"><div class="prog-fill" style="width:' +
    Math.min(100, pct) +
    '%;"></div></div>' +
    '</div>';
}

function clearLookup() {
  currentReg = null;
  document.getElementById('lu-val').value = '';
  document.getElementById('reg-card').classList.add('hidden');
  document.getElementById('payment-card').classList.add('hidden');
  document.getElementById('lookup-card').style.opacity = '1';
  showMsg('lu-msg', '');
  showMsg('pay-msg', '');
}

function recordPayment() {
  if (!currentReg || manualPaymentBusy) return;
  var amt = parseFloat(document.getElementById('pay-amt').value || 0);
  var date = document.getElementById('pay-date').value;
  var method = document.getElementById('pay-method').value;
  var notes = document.getElementById('pay-notes').value;

  if (!amt || amt <= 0) {
    showMsg('pay-msg', 'Please enter a valid amount.', 'err');
    return;
  }

  var pled = regTotalPledged(currentReg);
  var paid = regAmountPaid(currentReg);
  var remaining = Math.max(0, pled - paid);
  var confirmOver = false;
  if (amt > remaining + 0.01) {
    if (
      !confirm(
        'Amount ($' +
          amt.toFixed(2) +
          ') exceeds remaining balance ($' +
          remaining.toFixed(2) +
          '). Record anyway as an overpayment?'
      )
    ) {
      return;
    }
    confirmOver = true;
  }

  var btn = document.getElementById('pay-btn');
  manualPaymentBusy = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Recording…';
  showMsg('pay-msg', '');

  staffFetch('/api/admin/payments/manual', {
    method: 'POST',
    body: JSON.stringify({
      registration_id: currentReg.id,
      amount_dollars: amt,
      received_at: date,
      payment_source: method,
      notes: notes,
      confirm_overpayment: confirmOver,
    }),
  })
    .then(function (r) {
      return r.json().then(function (d) {
        return { ok: r.ok, d: d };
      });
    })
    .then(function (res) {
      if (!res.ok) {
        throw new Error(res.d.error || res.d.message || 'Record failed');
      }
      var data = res.d;
      if (data.registration) {
        currentReg.amount_paid_cents = data.registration.amount_paid_cents;
        currentReg.total_cents = data.registration.total_cents;
        currentReg.status = data.registration.status;
        currentReg.amount_paid = data.new_paid;
      } else {
        currentReg.amount_paid = data.new_paid;
        currentReg.status = data.new_status;
      }
      renderRegCard(currentReg);
      var bal = data.new_balance;
      showMsg(
        'pay-msg',
        '✓ $' +
          amt.toFixed(2) +
          ' recorded via ' +
          method +
          '. ' +
          (bal <= 0
            ? 'Registration is now fully paid!'
            : 'Remaining balance: $' + bal.toFixed(2)),
        'ok'
      );
      document.getElementById('pay-amt').value = '';
      document.getElementById('pay-notes').value = '';
    })
    .catch(function (err) {
      showMsg('pay-msg', err.message || String(err), 'err');
    })
    .then(function () {
      manualPaymentBusy = false;
      btn.disabled = false;
      btn.textContent = 'Record This Payment →';
    });
}

/* ── REPORT ── */
function loadReport() {
  var btn = document.getElementById('report-load-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Loading…';
  document.getElementById('report-status').textContent = '';
  staffJson('/api/admin/registrations?limit=500')
    .then(function (data) {
      reportData = data.registrations || [];
      renderReport(reportData);
      document.getElementById('report-dl-btn').classList.remove('hidden');
      document.getElementById('report-status').textContent =
        reportData.length + ' registrations loaded';
    })
    .catch(function (err) {
      document.getElementById('report-status').textContent = '✗ ' + err.message;
    })
    .then(function () {
      btn.disabled = false;
      btn.textContent = 'Refresh Report';
    });
}

function renderReport(rows) {
  var totalPledged = 0;
  var totalPaid = 0;
  var nComplete = 0;
  var nPartialPending = 0;
  rows.forEach(function (r) {
    var tp = regTotalPledged(r);
    totalPledged += tp;
    var ap = regAmountPaid(r);
    totalPaid += ap;
    if (r.status === 'complete') nComplete += 1;
    else nPartialPending += 1;
  });
  var outstanding = totalPledged - totalPaid;
  var pct = totalPledged > 0 ? Math.round((totalPaid / totalPledged) * 100) : 0;

  setText('rs-total', rows.length);
  setText('rs-complete', nComplete);
  setText('rs-partial', nPartialPending);
  setText('rs-collected', '$' + totalPaid.toFixed(2));
  setText('rs-outstanding', '$' + outstanding.toFixed(2));
  setText('rs-pct', pct + '%');
  document.getElementById('rs-bar').style.width = Math.min(100, pct) + '%';
  document.getElementById('report-summary').classList.remove('hidden');

  var tbody = document.getElementById('report-body');
  tbody.innerHTML = '';
  rows.forEach(function (r) {
    var pled = regTotalPledged(r);
    var paid = regAmountPaid(r);
    var rem = Math.max(0, pled - paid);
    var rPct = pled > 0 ? Math.round((paid / pled) * 100) : 0;
    var badgeCls =
      r.status === 'complete'
        ? 'b-complete'
        : r.status === 'partial'
          ? 'b-partial'
          : 'b-pending';
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td style="font-family:monospace;color:#E8C87A;letter-spacing:0.1em;">' +
      esc(r.pledge_code) +
      '</td>' +
      '<td>' +
      esc((r.first_name || '') + ' ' + (r.last_name || '')) +
      '</td>' +
      '<td style="font-size:0.72rem;">' +
      esc(r.email) +
      '</td>' +
      '<td>' +
      esc(r.church || '—') +
      '</td>' +
      '<td>' +
      esc(r.city || '—') +
      '</td>' +
      '<td>' +
      esc(r.tier || '—') +
      '</td>' +
      '<td>$' +
      pled.toFixed(2) +
      '</td>' +
      '<td style="color:#7dbf80;">$' +
      paid.toFixed(2) +
      '</td>' +
      '<td style="color:' +
      (pled > 0 && rem <= 0 ? '#7dbf80' : '#E8C87A') +
      ';">' +
      (pled > 0 && rem <= 0 ? 'Paid ✓' : '$' + rem.toFixed(2)) +
      '</td>' +
      '<td>' +
      '<div style="display:flex;align-items:center;gap:0.4rem;">' +
      '<div style="background:rgba(255,255,255,0.07);height:4px;width:60px;border-radius:2px;">' +
      '<div style="background:#C8A85A;height:4px;border-radius:2px;width:' +
      Math.min(100, rPct) +
      '%;"></div>' +
      '</div>' +
      '<span style="font-size:0.72rem;color:rgba(232,223,200,0.4);">' +
      rPct +
      '%</span>' +
      '</div>' +
      '</td>' +
      '<td><span class="badge ' +
      badgeCls +
      '">' +
      esc(r.status || 'pending') +
      '</span></td>' +
      '<td style="font-size:0.72rem;color:rgba(232,223,200,0.4);">' +
      (r.created_at || '').slice(0, 10) +
      '</td>';
    tbody.appendChild(tr);
  });
  document.getElementById('report-table-wrap').classList.remove('hidden');
}

function downloadCSV() {
  if (!reportData.length) return;
  var headers = [
    'Pledge Code',
    'First Name',
    'Last Name',
    'Email',
    'Phone',
    'Church',
    'City',
    'Tier',
    'Total Pledged',
    'Amount Paid',
    'Balance',
    'Status',
    'Registered',
  ];
  var rows = reportData.map(function (r) {
    var pled = regTotalPledged(r);
    var paid = regAmountPaid(r);
    var bal = Math.max(0, pled - paid);
    return [
      r.pledge_code,
      r.first_name,
      r.last_name,
      r.email,
      r.phone || '',
      r.church || '',
      r.city || '',
      r.tier || '',
      pled.toFixed(2),
      paid.toFixed(2),
      bal.toFixed(2),
      r.status || '',
      (r.created_at || '').slice(0, 10),
    ]
      .map(function (v) {
        return '"' + String(v).replace(/"/g, '""') + '"';
      })
      .join(',');
  });
  var csv = [headers.join(',')].concat(rows).join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download =
    'crm2026-registrations-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showMsg(id, msg, type) {
  var el = document.getElementById(id);
  if (!el) return;
  if (!msg) {
    el.className = '';
    el.textContent = '';
    return;
  }
  el.className = 'msg msg-' + (type || 'inf');
  el.textContent = msg;
}

function setText(id, v) {
  var el = document.getElementById(id);
  if (el) el.textContent = v;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ══════════════════════════════════════════════
   ZEFFY CSV IMPORT
══════════════════════════════════════════════ */
var zDrop = document.getElementById('z-drop-zone');
if (zDrop) {
  zDrop.addEventListener('dragover', function (e) {
    e.preventDefault();
    zDrop.classList.add('over');
  });
  zDrop.addEventListener('dragleave', function () {
    zDrop.classList.remove('over');
  });
  zDrop.addEventListener('drop', function (e) {
    e.preventDefault();
    zDrop.classList.remove('over');
    handleZeffyFile(e.dataTransfer.files[0]);
  });
}

function handleZeffyFile(file) {
  if (!file) return;
  var st = document.getElementById('z-csv-status');
  st.textContent = 'Reading ' + file.name + '…';
  st.style.color = '#C8A85A';
  var reader = new FileReader();
  reader.onload = function (e) {
    zLastCsvText = e.target.result;
    st.textContent = 'Uploading preview…';
    staffJson('/api/admin/import/zeffy/preview', {
      method: 'POST',
      body: JSON.stringify({ csv_text: zLastCsvText }),
    })
      .then(function (data) {
        zMatchedRows = data.rows || [];
        renderZeffyPreview(zMatchedRows, data.summary || {});
        st.textContent =
          '✓ Preview ready — ' + (data.summary.matched || 0) + ' matched.';
        st.style.color = '#7dbf80';
      })
      .catch(function (err) {
        st.textContent = '✗ ' + (err.message || err);
        st.style.color = '#e09090';
      });
  };
  reader.readAsText(file);
}

function renderZeffyPreview(rows, summary) {
  document.getElementById('zs-total').textContent = summary.total_rows != null ? summary.total_rows : rows.length;
  document.getElementById('zs-match').textContent = summary.matched != null ? summary.matched : 0;
  document.getElementById('zs-none').textContent = summary.unmatched != null ? summary.unmatched : 0;
  var dupEl = document.getElementById('zs-dup');
  if (dupEl) dupEl.textContent = summary.duplicates != null ? summary.duplicates : 0;

  var applyTotal = 0;
  rows.forEach(function (r) {
    if (
      r.registration &&
      !r.skip &&
      (r.flags || []).indexOf('duplicate') < 0 &&
      (r.flags || []).indexOf('unmatched') < 0
    ) {
      applyTotal += r.amount_dollars || 0;
    }
  });
  document.getElementById('zs-amt').textContent = '$' + applyTotal.toFixed(2);

  var tbody = document.getElementById('z-preview-body');
  tbody.innerHTML = '';
  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    if (r.skip) {
      tr.innerHTML =
        '<td>—</td><td>—</td><td>$' +
        (r.amount_dollars != null ? r.amount_dollars.toFixed(2) : '0') +
        '</td><td>—</td>' +
        '<td><span style="font-size:0.62rem;color:rgba(232,223,200,0.35);">' +
        esc((r.flags && r.flags[0]) || r.skip_reason || '') +
        '</span></td><td>—</td><td>—</td><td>—</td>';
    } else {
      var reg = r.registration;
      var pled = reg ? regTotalPledged(reg) : 0;
      var afterPaid = reg ? regAmountPaid(reg) + (r.amount_dollars || 0) : null;
      var afterRem = reg ? pled - afterPaid : null;
      var flags = (r.flags || []).join(', ');
      var badgeTxt = (r.flags || []).indexOf('duplicate') >= 0
        ? 'Duplicate'
        : (r.flags || []).indexOf('unmatched') >= 0
          ? 'No Match'
          : (r.flags || []).indexOf('no_pledge_code') >= 0
            ? 'No Code'
            : (r.flags || []).indexOf('overpayment') >= 0
              ? 'Overpay'
              : reg
                ? 'OK'
                : '—';
      var badgeCls = reg && (r.flags || []).length === 0 ? 'b-complete' : 'b-pending';
      var balTd = !reg ? '—' : adminPreviewBalanceHtml(pled, afterRem);
      tr.innerHTML =
        '<td>' +
        esc(r.date || '') +
        '</td>' +
        '<td>' +
        esc(r.donor || '') +
        '</td>' +
        '<td>$' +
        (r.amount_dollars != null ? r.amount_dollars.toFixed(2) : '0') +
        '</td>' +
        '<td style="font-family:monospace;color:#E8C87A;letter-spacing:0.1em;">' +
        esc(r.pledge_code || '—') +
        '</td>' +
        '<td><span class="badge ' +
        badgeCls +
        '">' +
        esc(badgeTxt) +
        '</span></td>' +
        '<td>' +
        (reg ? esc(reg.first_name + ' ' + reg.last_name) : '—') +
        '</td>' +
        '<td>' +
        balTd +
        '</td>' +
        '<td style="font-size:0.65rem;color:rgba(232,223,200,0.35);">' +
        esc(flags) +
        '</td>';
    }
    tbody.appendChild(tr);
  });

  document.getElementById('z-preview-card').classList.remove('hidden');
  var nApply = rows.filter(function (r) {
    if (r.skip || !r.registration) return false;
    var f = r.flags || [];
    if (f.indexOf('duplicate') >= 0 || f.indexOf('unmatched') >= 0) return false;
    if (f.indexOf('no_pledge_code') >= 0) return false;
    if (f.indexOf('overpayment') >= 0) return false;
    return true;
  }).length;
  document.getElementById('z-sync-btn').disabled = nApply === 0;
}

function doZeffySync() {
  if (zeffyApplyBusy) return;
  var btn = document.getElementById('z-sync-btn');
  var log = document.getElementById('z-sync-log');
  var confirmOver = document.getElementById('z-confirm-overpay').checked;
  var items = zMatchedRows
    .filter(function (r) {
      if (r.skip || !r.registration) return false;
      var f = r.flags || [];
      if (f.indexOf('duplicate') >= 0 || f.indexOf('unmatched') >= 0) return false;
      if (f.indexOf('no_pledge_code') >= 0) return false;
      if (f.indexOf('overpayment') >= 0 && !confirmOver) return false;
      return true;
    })
    .map(function (r) {
      return {
        registration_id: r.registration.id,
        external_ref: r.proposed_external_ref,
        amount_cents: r.amount_cents,
        received_at: r.date || '',
        notes: 'Zeffy CSV — ' + (r.donor || ''),
      };
    });

  if (!items.length) {
    document.getElementById('z-sync-status').textContent =
      'No rows to apply (enable overpayment or fix duplicates).';
    return;
  }

  zeffyApplyBusy = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Applying…';
  log.innerHTML = '';
  log.classList.remove('hidden');
  zLog(log, 'inf', 'Applying ' + items.length + ' row(s)…');

  staffJson('/api/admin/import/zeffy/apply', {
    method: 'POST',
    body: JSON.stringify({
      items: items,
      confirm_overpayment: confirmOver,
    }),
  })
    .then(function (data) {
      (data.results || []).forEach(function (row) {
        if (row.ok) {
          zLog(
            log,
            'ok',
            '✓ ' +
              (row.pledge_code || row.registration_id) +
              ' — posted'
          );
        } else {
          zLog(log, 'err', '✗ ' + (row.error || 'failed'));
        }
      });
      zLog(
        log,
        data.failed ? 'err' : 'ok',
        'Done — applied: ' + data.applied + ', failed: ' + data.failed
      );
      document.getElementById('z-sync-status').textContent =
        'Applied ' + data.applied + ' — failed ' + data.failed;
      btn.textContent = data.failed ? 'Retry / Refresh' : '✓ Complete';
    })
    .catch(function (err) {
      zLog(log, 'err', '✗ ' + err.message);
      document.getElementById('z-sync-status').textContent = err.message;
    })
    .then(function () {
      zeffyApplyBusy = false;
      btn.disabled = false;
      if (btn.textContent.indexOf('Complete') === -1 && btn.textContent.indexOf('Retry') === -1) {
        btn.textContent = 'Sync Matched Records →';
      }
    });
}

function resetZeffyCSV() {
  zMatchedRows = [];
  zLastCsvText = '';
  document.getElementById('z-csv-file').value = '';
  document.getElementById('z-csv-status').textContent = '';
  document.getElementById('z-preview-card').classList.add('hidden');
}

function zLog(el, cls, msg) {
  var colors = { ok: '#7dbf80', err: '#e09090', inf: '#C8A85A' };
  el.innerHTML +=
    '<span style="color:' + colors[cls] + '">' + msg + '</span>\n';
  el.scrollTop = el.scrollHeight;
}

/* ══════════════════════════════════════════════
   ZELLE — SINGLE / BATCH
══════════════════════════════════════════════ */
var szReg = null;

function singleZelleLookup() {
  var code = document.getElementById('sz-code').value.trim().toUpperCase();
  var amt = parseFloat(document.getElementById('sz-amt').value || 0);
  var errEl = document.getElementById('sz-error');
  errEl.style.display = 'none';
  document.getElementById('sz-result').style.display = 'none';
  if (!code) {
    errEl.textContent = 'Please enter a pledge code.';
    errEl.style.display = 'block';
    return;
  }
  if (!amt || amt <= 0) {
    errEl.textContent = 'Please enter a valid amount.';
    errEl.style.display = 'block';
    return;
  }
  staffJson('/api/admin/registrations?lookup=' + encodeURIComponent(code))
    .then(function (data) {
      var list = data.registrations || [];
      if (!list.length) {
        errEl.textContent = 'No registration found.';
        errEl.style.display = 'block';
        return;
      }
      szReg = list[0];
      var pled = regTotalPledged(szReg);
      var paid = regAmountPaid(szReg);
      var rem = Math.max(0, pled - paid);
      var newPaid = paid + amt;
      var newRem = pled - newPaid;
      document.getElementById('sz-reg-info').innerHTML =
        '<strong style="color:#E8C87A;font-size:1rem;">' +
        esc(szReg.first_name + ' ' + szReg.last_name) +
        '</strong><br/>' +
        'Email: ' +
        esc(szReg.email) +
        ' &nbsp;·&nbsp; Church: ' +
        esc(szReg.church || '—') +
        '<br/>' +
        'Current balance: <strong style="color:#E8C87A;">$' +
        rem.toFixed(2) +
        '</strong><br/>' +
        'Payment to apply: <strong style="color:#7dbf80;">$' +
        amt.toFixed(2) +
        '</strong><br/>' +
        'New balance after: <strong style="color:' +
        (pled > 0 ? (newRem <= 0 ? '#7dbf80' : '#E8C87A') : 'rgba(232,223,200,0.35)') +
        ';">' +
        (pled > 0 ? (newRem <= 0 ? 'Fully Paid ✓' : '$' + newRem.toFixed(2)) : '—') +
        '</strong>';
      document.getElementById('sz-result').style.display = 'block';
    })
    .catch(function (e) {
      errEl.textContent = e.message || String(e);
      errEl.style.display = 'block';
    });
}

function confirmSingleZelle() {
  if (!szReg || szConfirmBusy) return;
  var amt = parseFloat(document.getElementById('sz-amt').value || 0);
  var date = document.getElementById('sz-date').value;
  var name = document.getElementById('sz-name').value;
  var btn = document.getElementById('sz-confirm-btn');
  var st = document.getElementById('sz-status');
  var pled = regTotalPledged(szReg);
  var paid = regAmountPaid(szReg);
  var rem = Math.max(0, pled - paid);
  var confirmOver = false;
  if (amt > rem + 0.01) {
    if (
      !confirm(
        'This payment exceeds the remaining balance. Record as overpayment?'
      )
    ) {
      return;
    }
    confirmOver = true;
  }
  szConfirmBusy = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Recording…';
  staffFetch('/api/admin/payments/manual', {
    method: 'POST',
    body: JSON.stringify({
      registration_id: szReg.id,
      amount_dollars: amt,
      received_at: date || new Date().toISOString().slice(0, 10),
      payment_source: 'zelle',
      notes: name ? 'Sent by ' + name : '',
      confirm_overpayment: confirmOver,
    }),
  })
    .then(function (r) {
      return r.json().then(function (d) {
        return { ok: r.ok, d: d };
      });
    })
    .then(function (res) {
      if (!res.ok) throw new Error(res.d.error || 'Failed');
      var data = res.d;
      st.textContent =
        '✓ Recorded — new paid: $' +
        data.new_paid.toFixed(2) +
        (data.new_balance <= 0
          ? ' — Fully Paid!'
          : ' — Balance: $' + data.new_balance.toFixed(2));
      st.style.color = '#7dbf80';
      szReg = null;
      ['sz-code', 'sz-amt', 'sz-name'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      setTimeout(function () {
        document.getElementById('sz-result').style.display = 'none';
      }, 3500);
    })
    .catch(function (e) {
      st.textContent = '✗ ' + e.message;
      st.style.color = '#e09090';
    })
    .then(function () {
      szConfirmBusy = false;
      btn.disabled = false;
      btn.textContent = 'Confirm & Record →';
    });
}

function cancelSingleZelle() {
  szReg = null;
  document.getElementById('sz-result').style.display = 'none';
}

function parseBatch() {
  var text = document.getElementById('batch-text').value.trim();
  var lines = text.split('\n').filter(function (l) {
    return l.trim();
  });
  if (!lines.length) {
    document.getElementById('batch-parse-status').textContent = 'No rows found.';
    return;
  }

  var parsed = lines
    .map(function (line) {
      var parts = line.split(',').map(function (s) {
        return s.trim();
      });
      return {
        code: (parts[0] || '').toUpperCase(),
        amount: parseFloat(parts[1] || 0),
        date: parts[2] || new Date().toISOString().slice(0, 10),
        name: parts[3] || '',
        reg: null,
      };
    })
    .filter(function (r) {
      return r.code && r.amount > 0;
    });

  if (!parsed.length) {
    document.getElementById('batch-parse-status').textContent =
      'No valid rows. Format: CODE, AMOUNT, DATE, NAME';
    return;
  }
  batchRows = parsed;
  document.getElementById('batch-parse-status').textContent =
    'Looking up ' + parsed.length + ' code(s)…';

  var regMap = {};
  var pending = batchRows.length;
  batchRows.forEach(function (r) {
    staffJson('/api/admin/registrations?lookup=' + encodeURIComponent(r.code))
      .then(function (data) {
        var list = data.registrations || [];
        if (list.length) regMap[r.code] = list[0];
      })
      .catch(function () {})
      .then(function () {
        pending -= 1;
        if (pending === 0) {
          batchRows.forEach(function (row) {
            row.reg = regMap[row.code] || null;
          });
          renderBatchPreview();
        }
      });
  });
}

function renderBatchPreview() {
  var nMatch = batchRows.filter(function (r) {
    return r.reg;
  }).length;
  document.getElementById('batch-parse-status').textContent =
    nMatch + ' of ' + batchRows.length + ' matched.';

  var tbody = document.getElementById('batch-body');
  tbody.innerHTML = '';
  batchRows.forEach(function (r) {
    var pled = r.reg ? regTotalPledged(r.reg) : 0;
    var afterPaid = r.reg ? regAmountPaid(r.reg) + r.amount : null;
    var afterRem = r.reg ? pled - afterPaid : null;
    var tr = document.createElement('tr');
    var balCell = !r.reg
      ? '—'
      : adminPreviewBalanceHtml(pled, afterRem);
    tr.innerHTML =
      '<td style="font-family:monospace;color:#E8C87A;letter-spacing:0.1em;">' +
      esc(r.code) +
      '</td>' +
      '<td>$' +
      r.amount.toFixed(2) +
      '</td>' +
      '<td>' +
      esc(r.date) +
      '</td>' +
      '<td>' +
      esc(r.name || '—') +
      '</td>' +
      '<td><span class="badge ' +
      (r.reg ? 'b-complete' : 'b-pending') +
      '">' +
      (r.reg ? 'Match' : 'No Match') +
      '</span></td>' +
      '<td>' +
      (r.reg ? esc(r.reg.first_name + ' ' + r.reg.last_name) : '—') +
      '</td>' +
      '<td>' +
      balCell +
      '</td>';
    tbody.appendChild(tr);
  });

  document.getElementById('batch-preview').style.display = 'block';
  document.getElementById('batch-apply-btn').disabled = nMatch === 0;
}

function applyBatch() {
  if (batchApplyBusy) return;
  var btn = document.getElementById('batch-apply-btn');
  var log = document.getElementById('batch-log');
  batchApplyBusy = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Applying…';
  log.innerHTML = '';
  log.classList.remove('hidden');

  var toApply = batchRows.filter(function (r) {
    return r.reg;
  });
  zLog(log, 'inf', 'Applying ' + toApply.length + ' payment(s)…');
  var i = 0;
  function next() {
    if (i >= toApply.length) {
      zLog(log, 'ok', '✓ Done. ' + toApply.length + ' processed.');
      batchApplyBusy = false;
      btn.disabled = false;
      btn.textContent = '✓ Done';
      document.getElementById('batch-apply-status').textContent =
        'Done — ' + toApply.length + ' applied.';
      return;
    }
    var r = toApply[i++];
    var pled = regTotalPledged(r.reg);
    var paid = regAmountPaid(r.reg);
    var rem = Math.max(0, pled - paid);
    var confirmOver = false;
    if (r.amount > rem + 0.01) {
      if (
        !confirm(
          'Row ' +
            r.code +
            ': amount exceeds balance. Allow overpayment for this row?'
        )
      ) {
        zLog(log, 'inf', '⊘ ' + r.code + ' skipped (overpayment not confirmed)');
        next();
        return;
      }
      confirmOver = true;
    }
    staffFetch('/api/admin/payments/manual', {
      method: 'POST',
      body: JSON.stringify({
        registration_id: r.reg.id,
        amount_dollars: r.amount,
        received_at: r.date,
        payment_source: 'zelle',
        notes: r.name ? 'Sent by ' + r.name : '',
        confirm_overpayment: confirmOver,
      }),
    })
      .then(function (res) {
        return res.json().then(function (d) {
          return { ok: res.ok, d: d };
        });
      })
      .then(function (res) {
        if (!res.ok) {
          zLog(log, 'err', '✗ ' + r.code + ' — ' + (res.d.error || 'failed'));
        } else {
          zLog(
            log,
            'ok',
            '✓ ' +
              r.code +
              ' (' +
              r.reg.first_name +
              ') +$' +
              r.amount.toFixed(2) +
              ' → paid: $' +
              res.d.new_paid.toFixed(2)
          );
        }
        next();
      })
      .catch(function (e) {
        zLog(log, 'err', '✗ ' + r.code + ' — ' + e.message);
        next();
      });
  }
  next();
}

/* boot */
document.addEventListener('DOMContentLoaded', function () {
  initSupabase().catch(function (e) {
    var msg = document.getElementById('login-msg');
    if (msg) {
      msg.className = 'msg msg-err';
      msg.textContent = e.message || String(e);
      msg.classList.remove('hidden');
    }
  });
});
