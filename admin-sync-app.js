/* global supabase */

let sb = null;
/** From `/api/admin/auth-config` — matches GoTrue allowlist / SITE_URL host. */
let staffMagicLinkRedirect = null;
let currentReg = null;
let reportData = [];
let zMatchedRows = [];
let zLastCsvText = "";
let batchRows = [];
let manualPaymentBusy = false;
let szConfirmBusy = false;
let lookupRegBusy = false;
let szLookupBusy = false;
let payDupFetchToken = 0;
let zeffyApplyBusy = false;
let batchApplyBusy = false;

function showLoginScreen() {
  let boot = document.getElementById("auth-boot-screen");
  if (boot) boot.classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("main-screen").classList.add("hidden");
}

function showMainScreen(email) {
  let boot = document.getElementById("auth-boot-screen");
  if (boot) boot.classList.add("hidden");
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("main-screen").classList.remove("hidden");
  let el = document.getElementById("staff-email-display");
  if (el) el.textContent = email || "";
  let payDate = document.getElementById("pay-date");
  if (payDate && !payDate.value) {
    payDate.value = new Date().toISOString().slice(0, 10);
  }
  let szd = document.getElementById("sz-date");
  if (szd && !szd.value) {
    szd.value = new Date().toISOString().slice(0, 10);
  }
  syncLookupStep1Button();
  syncSzLookupButtonState();
}

async function loadAuthConfig() {
  let r = await fetch("/api/admin/auth-config");
  let d = await r.json().catch(function () {
    return {};
  });
  if (!r.ok) {
    throw new Error(
      d.message || d.error || "Could not load auth configuration",
    );
  }
  return d;
}

async function initSupabase() {
  let cfg = await loadAuthConfig();
  let rawRedirect = cfg.staff_magic_link_redirect;
  staffMagicLinkRedirect =
    typeof rawRedirect === "string" && rawRedirect.trim()
      ? rawRedirect.trim()
      : null;
  sb = supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
    auth: {
      // Magic links are often opened in the mail app's browser — no PKCE verifier there.
      // Implicit flow puts tokens in the URL hash so this page can recover the session.
      flowType: "implicit",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  sb.auth.onAuthStateChange(function (event, session) {
    if (event === "SIGNED_OUT" || !session) {
      showLoginScreen();
    } else if (session.user?.email) {
      showMainScreen(session.user.email);
    }
  });

  let existing = await sb.auth.getSession();
  if (existing.data.session?.user) {
    showMainScreen(existing.data.session.user.email);
  } else {
    showLoginScreen();
  }
}

async function staffFetch(path, options) {
  let opts = options || {};
  let sessionRes = await sb.auth.getSession();
  let session = sessionRes.data.session;
  if (!session) {
    showLoginScreen();
    throw new Error("session_expired");
  }
  let headers = { ...opts.headers };
  headers.Authorization = "Bearer " + session.access_token;
  if (opts.body && typeof opts.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  let r = await fetch(path, { ...opts, headers: headers });
  if (r.status === 401 || r.status === 403) {
    await sb.auth.signOut();
    showLoginScreen();
    let errText =
      r.status === 403
        ? "Not authorized (check STAFF_EMAIL_ALLOWLIST)."
        : "Session expired — sign in again.";
    throw new Error(errText);
  }
  return r;
}

async function staffJson(path, options) {
  let r = await staffFetch(path, options);
  let d = await r.json().catch(function () {
    return {};
  });
  if (!r.ok) {
    throw new Error(d.error || d.message || "Request failed");
  }
  return d;
}

async function sendMagicLink() {
  let input = document.getElementById("staff-email-input");
  let msg = document.getElementById("login-msg");
  let btn = document.getElementById("login-send-btn");
  if (!sb) {
    msg.className = "msg msg-err";
    msg.textContent =
      "Sign-in is not ready yet. Refresh the page or verify SUPABASE_ANON_KEY on the server.";
    msg.classList.remove("hidden");
    return;
  }
  let email = (input.value || "").trim().toLowerCase();
  if (!email) {
    msg.className = "msg msg-err";
    msg.textContent = "Enter your staff email address.";
    msg.classList.remove("hidden");
    return;
  }
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  msg.classList.remove("hidden");
  msg.className = "msg msg-inf";
  msg.textContent = "Sending link…";
  try {
    // Prefer server-built URL (SITE_URL / forwarded Host) so GoTrue allowlist matches
    // local `site_url` — browser `location.origin` alone often yields localhost vs 127 mismatch.
    let path = globalThis.location.pathname || "";
    if (!/\/admin-sync\.html$/i.test(path)) {
      path = "/admin-sync.html";
    }
    if (!path.startsWith("/")) path = "/" + path;
    let redirect =
      staffMagicLinkRedirect ||
      new URL(path, globalThis.location.origin).href;
    let res = await sb.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: redirect,
      },
    });
    if (res.error) throw res.error;
    msg.className = "msg msg-ok";
    msg.textContent =
      "Check your email for the sign-in link (inbox, spam, Promotions). You can close this tab after clicking it.";
  } catch (e) {
    msg.className = "msg msg-err";
    msg.textContent = e.message || "Could not send sign-in email.";
  } finally {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
  }
}

async function signOut() {
  await sb.auth.signOut();
  showLoginScreen();
}

/* ── TABS ── */
function showTab(name) {
  document.querySelectorAll(".tab-btn").forEach(function (b, i) {
    b.className =
      "tab-btn" +
      (["payment", "zelle", "zeffy", "report"][i] === name ? " on" : "");
  });
  document.querySelectorAll(".tab-panel").forEach(function (p) {
    p.className = "tab-panel";
  });
  document.getElementById("tab-" + name).className = "tab-panel on";
}

function regTotalPledged(reg) {
  if (!reg) return 0;
  if (reg.total_cents != null && reg.total_cents !== "") {
    let tc = Number(reg.total_cents);
    return Number.isFinite(tc) ? tc / 100 : 0;
  }
  let raw =
    reg.total_pledged != null && reg.total_pledged !== ""
      ? reg.total_pledged
      : reg.total_amount;
  let t = Number.parseFloat(raw);
  return Number.isFinite(t) ? t : 0;
}

function regAmountPaid(reg) {
  if (!reg) return 0;
  if (reg.amount_paid_cents != null && reg.amount_paid_cents !== "") {
    let pc = Number(reg.amount_paid_cents);
    return Number.isFinite(pc) ? pc / 100 : 0;
  }
  let p = Number.parseFloat(reg.amount_paid);
  return Number.isFinite(p) ? p : 0;
}

/** Mirrors api/_lib/registration.js PRICING_CENTS (admin report only). */
let PRICING_CENTS_ADMIN = {
  earlybird: { u10: 0, u17: 10000, adu: 20000 },
  regular: { u10: 5000, u17: 15000, adu: 25000 },
  late: { u10: 30000, u17: 30000, adu: 30000 },
};

function attendeeBracketCentsAdmin(age, tier) {
  let numericAge = Number(age);
  let pricing = PRICING_CENTS_ADMIN[tier];
  if (!pricing || !Number.isFinite(numericAge) || numericAge < 0) return 0;
  if (numericAge <= 10) return pricing.u10;
  if (numericAge < 18) return pricing.u17;
  return pricing.adu;
}

function sumBracketCentsAdmin(attendees, tier) {
  if (!Array.isArray(attendees)) return 0;
  let t = String(tier || "").toLowerCase();
  let s = 0;
  for (const element of attendees) {
    s += attendeeBracketCentsAdmin(element?.age, t);
  }
  return s;
}

/** YYYY-MM-DD in America/Chicago for an ISO timestamp. */
function chicagoYmdFromIso(iso) {
  if (!iso) return "";
  let d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  let y = "";
  let m = "";
  let day = "";
  for (const element of parts) {
    if (element.type === "year") y = element.value;
    if (element.type === "month") m = element.value;
    if (element.type === "day") day = element.value;
  }
  if (y && m && day) return y + "-" + m + "-" + day;
  return "";
}

/** Human-readable date/time in UTC for report tables / exports (e.g. "May 9, 2026, 2:30 PM UTC"). */
function formatReportDateTimeUtc(iso) {
  if (iso == null || iso === "") return "—";
  let d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  let formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
  return formatted + " UTC";
}

/** Same calendar rules as activeTierForDate(registration.js) for a Chicago YYYY-MM-DD. */
function activeTierFromChicagoYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  let segs = ymd.split("-");
  let mo = Number(segs[1]);
  let dom = Number(segs[2]);
  if (mo < 6 || (mo === 6 && dom <= 15)) return "earlybird";
  if (mo < 7 || (mo === 7 && dom <= 16)) return "regular";
  return "late";
}

function formatUsdFromCentsAdmin(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);
}

function windowLeadSentence(calTier) {
  if (calTier === "earlybird") return "Inside early-bird window.";
  if (calTier === "regular") return "Inside regular window.";
  if (calTier === "late") return "After Jul 17.";
  return "";
}

/**
 * Human-readable tier + ticket math for Pledges Report (HTML / CSV / PDF).
 * Uses stored tier for bracket prices; Chicago calendar on created_at for window copy.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.slimColumn] — Omit amounts duplicated in Pledged/Paid columns (HTML + CSV/PDF when passed).
 */
function buildPricingBreakdownParts(r, opts) {
  opts = opts || {};
  let slim = !!opts.slimColumn;
  let preamble = [];
  let items = [];
  let summary = null;
  let footers = [];
  let storedTier = String(r?.tier || "").toLowerCase();
  let attendees = Array.isArray(r?.attendees_json) ? r.attendees_json : [];
  let chYmd = chicagoYmdFromIso(r?.created_at);
  let calTier = activeTierFromChicagoYmd(chYmd);
  let lead = windowLeadSentence(calTier);
  if (lead) preamble.push(lead);
  if (storedTier && calTier && storedTier !== calTier) {
    preamble.push(
      'Stored tier is "' +
        storedTier +
        '" (Chicago date ' +
        chYmd +
        " falls in " +
        calTier +
        "). Bracket math below uses stored tier.",
    );
  }
  if (!storedTier || !PRICING_CENTS_ADMIN[storedTier]) {
    preamble.push("No stored tier or unknown tier — bracket lines omitted.");
    return {
      preamble: preamble,
      items: items,
      summary: summary,
      footers: footers,
    };
  }
  let bracketSum = sumBracketCentsAdmin(attendees, storedTier);
  let totalC = Number(r.total_cents) || 0;
  let paidC = Number(r.amount_paid_cents) || 0;
  for (let i = 0; i < attendees.length; i += 1) {
    let a = attendees[i] || {};
    let nm = String(a.name || "Attendee " + (i + 1)).trim();
    let ag = a.age != null && a.age !== "" ? a.age : "?";
    let cents = attendeeBracketCentsAdmin(a.age, storedTier);
    items.push(nm + " (age " + ag + "): " + formatUsdFromCentsAdmin(cents));
  }
  if (items.length === 0) {
    if (totalC > 0) {
      summary = slim
        ? "No attendee line items — see Pledged column."
        : "Stored pledge " + formatUsdFromCentsAdmin(totalC) + ".";
      if (!slim) {
        footers.push("No attendees on file.");
      }
    } else {
      footers.push("No attendees on file.");
    }
  } else {
    summary = slim
      ? totalC === bracketSum
        ? "Matches ticket line items."
        : "Line items add to " +
          formatUsdFromCentsAdmin(bracketSum) +
          " — differs from stored pledge."
      : "Total pledged " +
        formatUsdFromCentsAdmin(totalC) +
        (totalC === bracketSum
          ? " — matches ticket line items."
          : " — ticket prices add to " +
            formatUsdFromCentsAdmin(bracketSum) +
            " at this tier (differs from stored pledge).");
  }
  if (r.last_reminder_at) {
    footers.push("Last reminder sent " + formatReportDateTimeUtc(r.last_reminder_at) + ".");
  }
  if (paidC > 0 && !slim) {
    footers.push("Recorded paid " + formatUsdFromCentsAdmin(paidC) + ".");
  }
  return {
    preamble: preamble,
    items: items,
    summary: summary,
    footers: footers,
  };
}

/** Flat lines for CSV / PDF: bullets on each attendee line item. Pass `{ slimColumn: true }` to match HTML column density. */
function buildPricingBreakdownLines(r, opts) {
  let p = buildPricingBreakdownParts(r, opts || {});
  let out = [p.preamble].flat();
  p.items.forEach(function (it) {
    out.push("\u2022 " + it);
  });
  if (p.summary) out.push(p.summary);
  out = out.concat(p.footers);
  return out;
}

function buildPricingBreakdownHtml(r) {
  let p = buildPricingBreakdownParts(r, { slimColumn: true });
  let chunks = [];
  p.preamble.forEach(function (line) {
    chunks.push('<p class="report-pricing-p">' + esc(line) + "</p>");
  });
  if (p.items.length) {
    chunks.push('<ul class="report-pricing-ul">');
    p.items.forEach(function (it) {
      chunks.push("<li>" + esc(it) + "</li>");
    });
    chunks.push("</ul>");
  }
  if (p.summary) {
    chunks.push(
      '<p class="report-pricing-p report-pricing-summary">' +
        esc(p.summary) +
        "</p>",
    );
  }
  p.footers.forEach(function (line) {
    chunks.push('<p class="report-pricing-p">' + esc(line) + "</p>");
  });
  return chunks.join("");
}

/** Preview cell when pled is known dollars; avoids bogus negatives when pled is 0 */
function adminPreviewBalanceHtml(pled, afterRem) {
  if (pled <= 0) return "—";
  if (afterRem <= 0) return '<span style="color:#7dbf80;">Fully Paid</span>';
  return "$" + afterRem.toFixed(2) + " left";
}

function staffStringHash(s) {
  let t = String(s || "");
  let h = 5381;
  for (let i = 0; i < t.length; i++) {
    h = ((h << 5) + h + t.codePointAt(i)) >>> 0;
  }
  return (h >>> 0).toString(36);
}

function buildStaffPaymentExternalRef(
  regId,
  amountCents,
  dateStr,
  source,
  notes,
) {
  let day = (dateStr || "").trim().slice(0, 10);
  let src =
    String(source || "other")
      .trim()
      .slice(0, 32) || "other";
  return (
    "staff-" +
    regId +
    "-" +
    day +
    "-" +
    amountCents +
    "-" +
    src +
    "-" +
    staffStringHash(notes)
  );
}

function receivedAtDay(p) {
  let raw = p?.received_at == null ? "" : String(p.received_at);
  return raw.slice(0, 10);
}

function hasSameDayAmountPayment(payments, amountCents, dateDayStr) {
  if (!amountCents || !dateDayStr || dateDayStr.length < 10) return false;
  return (payments || []).some(function (p) {
    return p.amount_cents === amountCents && receivedAtDay(p) === dateDayStr;
  });
}

function syncLookupStep1Button() {
  let btn = document.getElementById("lu-btn");
  let inp = document.getElementById("lu-val");
  if (!btn || !inp) return;
  btn.disabled = lookupRegBusy || !inp.value.trim();
}

function syncSzLookupButtonState() {
  let btn = document.getElementById("sz-lookup-btn");
  if (!btn) return;
  let code = document.getElementById("sz-code")?.value;
  let amt = Number.parseFloat(document.getElementById("sz-amt")?.value || 0);
  let codeOk = code && String(code).trim().length > 0;
  let amtOk = Number.isFinite(amt) && amt > 0;
  btn.disabled = szLookupBusy || szConfirmBusy || !codeOk || !amtOk;
}

function setZelleInputsDisabled(disabled) {
  ["sz-code", "sz-amt", "sz-date", "sz-name"].forEach(function (id) {
    let el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function hidePayStep3Extras() {
  ["pay-step3-banner", "pay-dup-warn", "pay-step3-hint"].forEach(function (id) {
    let el = document.getElementById(id);
    if (el) {
      el.classList.add("hidden");
      if (id === "pay-step3-banner" || id === "pay-dup-warn")
        el.textContent = "";
      if (id === "pay-step3-hint") el.textContent = "";
    }
  });
}

function updatePayStep3UI() {
  let banner = document.getElementById("pay-step3-banner");
  let hint = document.getElementById("pay-step3-hint");
  let btn = document.getElementById("pay-btn");
  let amtEl = document.getElementById("pay-amt");
  let dateEl = document.getElementById("pay-date");
  if (!currentReg || !banner || !btn || !amtEl || !dateEl) return;

  let pled = regTotalPledged(currentReg);
  let paid = regAmountPaid(currentReg);
  let rem = Math.max(0, pled - paid);
  let amt = Number.parseFloat(amtEl.value || 0);
  let dateOk = !!String(dateEl.value || "").trim();
  let amtOk = Number.isFinite(amt) && amt > 0;

  banner.classList.remove("hidden", "msg-ok", "msg-err", "msg-inf", "msg-warn");
  banner.classList.add("msg");
  if (pled > 0 && rem <= 0.005) {
    banner.classList.add("msg-warn");
    banner.textContent =
      "This registration is already fully paid. You can still record an extra line if money was received again; you will be asked to confirm it as an overpayment.";
  } else if (pled > 0) {
    banner.classList.add("msg-inf");
    banner.textContent =
      "Remaining balance: $" +
      rem.toFixed(2) +
      ". Enter the amount actually received and the date it was received.";
  } else {
    banner.classList.add("msg-inf");
    banner.textContent =
      "No pledge total is on file for this tier. You can still record a payment if needed.";
  }

  if (hint) {
    if (amtOk && pled > 0 && rem > 0.005 && amt > rem + 0.01) {
      hint.textContent =
        "This amount is higher than the remaining balance; you will be asked to confirm overpayment before recording.";
      hint.classList.remove("hidden");
    } else {
      hint.textContent = "";
      hint.classList.add("hidden");
    }
  }

  btn.disabled = manualPaymentBusy || !amtOk || !dateOk;
}

function refreshPayDuplicateWarning() {
  if (!currentReg?.id) return;
  let dupEl = document.getElementById("pay-dup-warn");
  if (!dupEl) return;
  let token = ++payDupFetchToken;
  let amt = Number.parseFloat(document.getElementById("pay-amt").value || 0);
  let dateStr = String(document.getElementById("pay-date").value || "")
    .trim()
    .slice(0, 10);
  let cents = Math.round(Number.parseFloat(amt.toFixed(2)) * 100);

  if (!cents || dateStr.length < 10) {
    dupEl.classList.add("hidden");
    dupEl.textContent = "";
    return;
  }

  staffJson(
    "/api/admin/registration-payments?registration_id=" +
      encodeURIComponent(currentReg.id),
  )
    .then(function (data) {
      if (token !== payDupFetchToken) return;
      let payments = data.payments || [];
      if (hasSameDayAmountPayment(payments, cents, dateStr)) {
        dupEl.textContent =
          "Warning: A posted payment with the same amount and received date already exists for this registration. If this is a different deposit, change the date or add a note before recording.";
        dupEl.classList.remove("hidden");
      } else {
        dupEl.classList.add("hidden");
        dupEl.textContent = "";
      }
    })
    .catch(function () {
      if (token !== payDupFetchToken) return;
      dupEl.classList.add("hidden");
      dupEl.textContent = "";
    });
}

function showZelleDupFromPayments(payments, amt, dateStr) {
  let dupEl = document.getElementById("sz-dup-warn");
  if (!dupEl) return;
  let cents = Math.round(Number.parseFloat(amt.toFixed(2)) * 100);
  let day = String(dateStr || "")
    .trim()
    .slice(0, 10);
  if (!cents || day.length < 10) {
    dupEl.classList.add("hidden");
    dupEl.textContent = "";
    return;
  }
  if (hasSameDayAmountPayment(payments, cents, day)) {
    dupEl.textContent =
      "Warning: A payment with the same amount and received date may already be on file. Confirm this is not a duplicate before recording.";
    dupEl.classList.remove("hidden");
  } else {
    dupEl.classList.add("hidden");
    dupEl.textContent = "";
  }
}

function refreshZelleDupIfPreviewOpen() {
  if (!szReg) return;
  let amt = Number.parseFloat(document.getElementById("sz-amt").value || 0);
  let dateStr = document.getElementById("sz-date").value;
  staffJson(
    "/api/admin/registration-payments?registration_id=" +
      encodeURIComponent(szReg.id),
  )
    .then(function (d) {
      showZelleDupFromPayments(d.payments || [], amt, dateStr);
    })
    .catch(function () {});
}

function initStaffPaymentForms() {
  syncLookupStep1Button();
  syncSzLookupButtonState();
  let szCodeEl = document.getElementById("sz-code");
  if (szCodeEl) {
    szCodeEl.addEventListener("input", function () {
      invalidateZellePreviewIfLookupKeyChanged();
      syncSzLookupButtonState();
    });
    szCodeEl.addEventListener("change", syncSzLookupButtonState);
  }
  let szAmt = document.getElementById("sz-amt");
  if (szAmt) {
    szAmt.addEventListener("input", function () {
      syncSzLookupButtonState();
      refreshQuickZellePreviewAfterEdit();
    });
    szAmt.addEventListener("change", function () {
      syncSzLookupButtonState();
      refreshQuickZellePreviewAfterEdit();
    });
  }
  let szDate = document.getElementById("sz-date");
  if (szDate) {
    szDate.addEventListener("change", function () {
      refreshQuickZellePreviewAfterEdit();
    });
  }
  ["pay-amt", "pay-date", "pay-method", "pay-notes"].forEach(function (id) {
    let el = document.getElementById(id);
    if (!el) return;
    let handler = function () {
      updatePayStep3UI();
      refreshPayDuplicateWarning();
    };
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
  });

  let reportWrap = document.getElementById("report-table-wrap");
  if (reportWrap && !reportWrap.dataset.copyDelegate) {
    reportWrap.dataset.copyDelegate = "1";
    reportWrap.addEventListener("click", function (ev) {
      let btn = ev.target.closest(".report-copy-code-btn");
      if (!btn || !reportWrap.contains(btn)) return;
      ev.preventDefault();
      let code = btn.dataset.code;
      if (code === undefined || code === "") return;
      copyReportPledgeCode(code, btn);
    });
  }
}

/* ── LOOKUP ── */
function lookupReg() {
  let v = document.getElementById("lu-val").value.trim();
  if (!v) {
    showMsg("lu-msg", "Enter a pledge code or email address.", "err");
    return;
  }
  if (lookupRegBusy) return;
  let btn = document.getElementById("lu-btn");
  lookupRegBusy = true;
  syncLookupStep1Button();
  btn.innerHTML = '<span class="spinner"></span>Looking up…';
  showMsg("lu-msg", "");
  staffJson("/api/admin/registrations?lookup=" + encodeURIComponent(v))
    .then(function (data) {
      let list = data.registrations || [];
      if (!list.length) {
        showMsg("lu-msg", "No registration found.", "err");
        return;
      }
      currentReg = list[0];
      renderRegCard(currentReg);
      document.getElementById("reg-card").classList.remove("hidden");
      document.getElementById("payment-card").classList.remove("hidden");
      document.getElementById("lookup-card").style.opacity = "0.5";
    })
    .catch(function (err) {
      showMsg("lu-msg", err.message || String(err), "err");
    })
    .then(function () {
      lookupRegBusy = false;
      btn.textContent = "Look Up →";
      syncLookupStep1Button();
    });
}

function renderRegCard(r) {
  let pled = regTotalPledged(r);
  let paid = regAmountPaid(r);
  let remaining = Math.max(0, pled - paid);
  let pct = pled > 0 ? Math.round((paid / pled) * 100) : 0;
  document.getElementById("reg-display").innerHTML =
    '<div class="pledge-code">' +
    esc(r.pledge_code) +
    "</div>" +
    '<div class="reg-name">' +
    esc(r.first_name + " " + r.last_name) +
    "</div>" +
    '<div class="reg-grid" style="margin-bottom:1rem;">' +
    '<span class="reg-lbl">Email</span>       <span class="reg-val">' +
    esc(r.email) +
    "</span>" +
    '<span class="reg-lbl">Church</span>      <span class="reg-val">' +
    esc(r.church || "—") +
    "</span>" +
    '<span class="reg-lbl">City</span>        <span class="reg-val">' +
    esc(r.city || "—") +
    "</span>" +
    '<span class="reg-lbl">Tier</span>        <span class="reg-val">' +
    esc(r.tier || "—") +
    "</span>" +
    "</div>" +
    '<div class="balance-row"><span class="lbl">Total Pledged</span>   <span class="val">$' +
    pled.toFixed(2) +
    "</span></div>" +
    '<div class="balance-row"><span class="lbl">Amount Paid</span>    <span class="val val-paid">$' +
    paid.toFixed(2) +
    "</span></div>" +
    '<div class="balance-row"><span class="lbl">Remaining Balance</span>' +
    '<span class="val ' +
    (pled > 0 && remaining <= 0 ? "val-full" : "val-due") +
    '">' +
    (pled > 0 && remaining <= 0 ? "Fully Paid ✓" : "$" + remaining.toFixed(2)) +
    "</span></div>" +
    '<div style="margin-top:0.8rem;">' +
    '<div style="display:flex;justify-content:space-between;font-size:0.7rem;color:rgba(232,223,200,0.4);margin-bottom:0.3rem;">' +
    "<span>Payment progress</span><span>" +
    pct +
    "%</span>" +
    "</div>" +
    '<div class="prog-track"><div class="prog-fill" style="width:' +
    Math.min(100, pct) +
    '%;"></div></div>' +
    "</div>";
  updatePayStep3UI();
  refreshPayDuplicateWarning();
}

function clearLookup() {
  currentReg = null;
  payDupFetchToken += 1;
  document.getElementById("lu-val").value = "";
  document.getElementById("reg-card").classList.add("hidden");
  document.getElementById("payment-card").classList.add("hidden");
  document.getElementById("lookup-card").style.opacity = "1";
  showMsg("lu-msg", "");
  showMsg("pay-msg", "");
  hidePayStep3Extras();
  let pamt = document.getElementById("pay-amt");
  if (pamt) pamt.value = "";
  let pnotes = document.getElementById("pay-notes");
  if (pnotes) pnotes.value = "";
  syncLookupStep1Button();
}

function recordPayment() {
  if (!currentReg || manualPaymentBusy) return;
  let amt = Number.parseFloat(document.getElementById("pay-amt").value || 0);
  let date = String(document.getElementById("pay-date").value || "").trim();
  let method = document.getElementById("pay-method").value;
  let notes = document.getElementById("pay-notes").value;

  if (!date) {
    showMsg(
      "pay-msg",
      "Please choose the date the payment was received.",
      "err",
    );
    updatePayStep3UI();
    return;
  }

  if (!amt || amt <= 0) {
    showMsg("pay-msg", "Please enter a valid amount greater than zero.", "err");
    updatePayStep3UI();
    return;
  }

  let pled = regTotalPledged(currentReg);
  let paid = regAmountPaid(currentReg);
  let remaining = Math.max(0, pled - paid);
  let confirmOver = false;
  if (amt > remaining + 0.01) {
    if (
      !confirm(
        "Amount ($" +
          amt.toFixed(2) +
          ") exceeds remaining balance ($" +
          remaining.toFixed(2) +
          "). Record anyway as an overpayment?",
      )
    ) {
      return;
    }
    confirmOver = true;
  }

  let amountCents = Math.round(Number.parseFloat(amt.toFixed(2)) * 100);
  let externalRef = buildStaffPaymentExternalRef(
    currentReg.id,
    amountCents,
    date,
    method,
    notes,
  );

  let btn = document.getElementById("pay-btn");
  manualPaymentBusy = true;
  updatePayStep3UI();
  btn.innerHTML = '<span class="spinner"></span>Recording…';
  showMsg("pay-msg", "");

  staffFetch("/api/admin/payments/manual", {
    method: "POST",
    body: JSON.stringify({
      registration_id: currentReg.id,
      amount_dollars: amt,
      received_at: date,
      payment_source: method,
      notes: notes,
      confirm_overpayment: confirmOver,
      external_ref: externalRef,
    }),
  })
    .then(function (r) {
      return r.json().then(function (d) {
        return { ok: r.ok, d: d };
      });
    })
    .then(function (res) {
      if (!res.ok) {
        let errCode = res.d?.error ? String(res.d.error) : "";
        if (errCode.includes("duplicate_external_ref")) {
          throw new Error(
            "This payment was already recorded (duplicate reference). Refresh the page or change amount/date/notes if you meant a different deposit.",
          );
        }
        throw new Error(res.d.error || res.d.message || "Record failed");
      }
      let data = res.d;
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
      let bal = data.new_balance;
      showMsg(
        "pay-msg",
        "✓ $" +
          amt.toFixed(2) +
          " recorded via " +
          method +
          ". " +
          (bal <= 0
            ? "Registration is now fully paid!"
            : "Remaining balance: $" + bal.toFixed(2)),
        "ok",
      );
      document.getElementById("pay-amt").value = "";
      document.getElementById("pay-notes").value = "";
    })
    .catch(function (err) {
      showMsg("pay-msg", err.message || String(err), "err");
    })
    .then(function () {
      manualPaymentBusy = false;
      btn.textContent = "Record This Payment →";
      updatePayStep3UI();
      refreshPayDuplicateWarning();
    });
}

/* ── REPORT ── */
function loadReport() {
  let btn = document.getElementById("report-load-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Loading…';
  document.getElementById("report-status").textContent = "";
  staffJson("/api/admin/registrations?limit=500")
    .then(function (data) {
      reportData = data.registrations || [];
      renderReport(reportData);
      document.getElementById("report-dl-btn").classList.remove("hidden");
      document.getElementById("report-dl-pdf-btn").classList.remove("hidden");
      document.getElementById("report-status").textContent =
        reportData.length + " registrations loaded";
    })
    .catch(function (err) {
      document.getElementById("report-status").textContent = "✗ " + err.message;
    })
    .then(function () {
      btn.disabled = false;
      btn.textContent = "Refresh Report";
    });
}

/** True when pledge total is positive and amount paid exceeds it (overpayment on file). */
function registrationIsOverpaidRow(pled, paid) {
  return pled > 0.005 && paid > pled + 0.005;
}

/** Balance column copy + color for pledges report table. */
function reportBalanceCell(pled, paid) {
  if (registrationIsOverpaidRow(pled, paid)) {
    let over = paid - pled;
    return {
      text: "Overpaid by $" + over.toFixed(2),
      color: "#9dd3ff",
    };
  }
  let rem = Math.max(0, pled - paid);
  if (pled > 0 && rem <= 0.005) {
    return { text: "Paid ✓", color: "#7dbf80" };
  }
  return { text: "$" + rem.toFixed(2), color: "#E8C87A" };
}

/** Balance string for CSV / PDF when overpaid vs due. */
function reportBalanceExport(pled, paid, opts) {
  let pdf = opts?.pdf;
  if (registrationIsOverpaidRow(pled, paid)) {
    let n = (paid - pled).toFixed(2);
    return pdf ? "Overpaid by $" + n : "Overpaid by " + n;
  }
  let rem = Math.max(0, pled - paid);
  if (pled > 0 && rem <= 0.005) {
    return "Paid ✓";
  }
  return pdf ? "$" + rem.toFixed(2) : rem.toFixed(2);
}

/** Same column order and labels for Pledges Report HTML, CSV, and PDF (13 columns). */
const REPORT_TABLE_HEADERS = [
  "Code",
  "Name",
  "Email",
  "Church",
  "City",
  "Tier",
  "Pledged",
  "Paid",
  "Balance",
  "% Paid",
  "Status",
  "Registered",
  "Pricing / logic",
];

function reportDisplayName(r) {
  return [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "—";
}

function syncReportTableHead() {
  let tr = document.getElementById("report-head-row");
  if (!tr) return;
  tr.innerHTML = REPORT_TABLE_HEADERS.map(function (h) {
    return "<th>" + esc(h) + "</th>";
  }).join("");
}

function reportExportCellValues(r) {
  let pled = regTotalPledged(r);
  let paid = regAmountPaid(r);
  let rPct = pled > 0 ? Math.round((paid / pled) * 100) : 0;
  let overpaid = registrationIsOverpaidRow(pled, paid);
  let balStr = reportBalanceExport(pled, paid, { pdf: true });
  let statusStr = overpaid ? "overpaid" : String(r.status || "pending");
  return [
    String(r.pledge_code || ""),
    reportDisplayName(r),
    String(r.email || "").trim() || "—",
    String(r.church || "").trim() || "—",
    String(r.city || "").trim() || "—",
    String(r.tier || "").trim() || "—",
    "$" + pled.toFixed(2),
    "$" + paid.toFixed(2),
    balStr,
    rPct + "%",
    statusStr,
    formatReportDateTimeUtc(r.created_at),
    buildPricingBreakdownLines(r, { slimColumn: true }).join("\n"),
  ];
}

function renderReport(rows) {
  let totalPledged = 0;
  let totalPaid = 0;
  let nComplete = 0;
  let nPartialPending = 0;
  rows.forEach(function (r) {
    let tp = regTotalPledged(r);
    totalPledged += tp;
    let ap = regAmountPaid(r);
    totalPaid += ap;
    if (r.status === "complete") nComplete += 1;
    else nPartialPending += 1;
  });
  let outstanding = totalPledged - totalPaid;
  let pct = totalPledged > 0 ? Math.round((totalPaid / totalPledged) * 100) : 0;

  setText("rs-total", rows.length);
  setText("rs-complete", nComplete);
  setText("rs-partial", nPartialPending);
  setText("rs-collected", "$" + totalPaid.toFixed(2));
  setText("rs-outstanding", "$" + outstanding.toFixed(2));
  setText("rs-pct", pct + "%");
  document.getElementById("rs-bar").style.width = Math.min(100, pct) + "%";
  document.getElementById("report-summary").classList.remove("hidden");

  syncReportTableHead();
  let tbody = document.getElementById("report-body");
  tbody.innerHTML = "";
  rows.forEach(function (r) {
    let vals = reportExportCellValues(r);
    let pled = regTotalPledged(r);
    let paid = regAmountPaid(r);
    let rPct = pled > 0 ? Math.round((paid / pled) * 100) : 0;
    let overpaid = registrationIsOverpaidRow(pled, paid);
    let balCell = reportBalanceCell(pled, paid);
    let badgeCls = "b-pending";
    if (overpaid) {
      badgeCls = "b-overpaid";
    } else if (vals[10] === "complete") {
      badgeCls = "b-complete";
    } else if (vals[10] === "partial") {
      badgeCls = "b-partial";
    }
    let tr = document.createElement("tr");
    tr.className = "report-row";
    let code = vals[0];
    tr.innerHTML =
      '<td><div class="report-code-cell">' +
      '<span class="report-code-text">' +
      esc(code) +
      "</span>" +
      '<button type="button" class="report-copy-code-btn" data-code="' +
      escAttr(code) +
      '" aria-label="Copy pledge code" title="Copy pledge code">' +
      REPORT_COPY_ICON_SVG +
      "</button></div></td>" +
      "<td>" +
      esc(vals[1]) +
      "</td>" +
      '<td style="font-size:0.72rem;">' +
      esc(vals[2]) +
      "</td>" +
      "<td>" +
      esc(vals[3]) +
      "</td>" +
      "<td>" +
      esc(vals[4]) +
      "</td>" +
      "<td>" +
      esc(vals[5]) +
      "</td>" +
      "<td>" +
      esc(vals[6]) +
      "</td>" +
      '<td style="color:#7dbf80;">' +
      esc(vals[7]) +
      "</td>" +
      '<td style="color:' +
      balCell.color +
      ';">' +
      esc(vals[8]) +
      "</td>" +
      "<td>" +
      '<div style="display:flex;align-items:center;gap:0.4rem;">' +
      '<div style="background:rgba(255,255,255,0.07);height:4px;width:60px;border-radius:2px;">' +
      '<div style="background:#C8A85A;height:4px;border-radius:2px;width:' +
      Math.min(100, rPct) +
      '%;"></div>' +
      "</div>" +
      '<span style="font-size:0.72rem;color:rgba(232,223,200,0.4);">' +
      esc(vals[9]) +
      "</span>" +
      "</div>" +
      "</td>" +
      '<td><span class="badge ' +
      badgeCls +
      '">' +
      esc(vals[10]) +
      "</span></td>" +
      '<td style="font-size:0.72rem;color:rgba(232,223,200,0.4);">' +
      esc(vals[11]) +
      "</td>" +
      '<td class="report-logic-cell">' +
      buildPricingBreakdownHtml(r) +
      "</td>";
    tbody.appendChild(tr);
  });
  document.getElementById("report-table-wrap").classList.remove("hidden");
}

function downloadCSV() {
  if (!reportData.length) return;
  let rows = reportData.map(function (r) {
    return reportExportCellValues(r)
      .map(function (v) {
        return '"' + String(v).replaceAll('"', '""') + '"';
      })
      .join(",");
  });
  let csv = [REPORT_TABLE_HEADERS.map(function (h) {
    return '"' + String(h).replaceAll('"', '""') + '"';
  }).join(",")].concat(rows).join("\n");
  let blob = new Blob([csv], { type: "text/csv" });
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download =
    "crm2026-registrations-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* jsPDF + autotable: loaded on first PDF export only (keeps login path fast). */
let pdfLibsPromise = null;

function loadPdfScriptOnce(src, integrity, dataKey) {
  return new Promise(function (resolve, reject) {
    if (document.querySelector('script[data-pdf-lib="' + dataKey + '"]')) {
      resolve();
      return;
    }
    let s = document.createElement("script");
    s.src = src;
    s.dataset.pdfLib = dataKey;
    if (integrity) {
      s.integrity = integrity;
      s.crossOrigin = "anonymous";
    }
    s.onload = function () {
      resolve();
    };
    s.onerror = function () {
      reject(new Error("Failed to load " + dataKey));
    };
    document.head.appendChild(s);
  });
}

function ensurePdfLibs() {
  if (pdfLibsPromise) return pdfLibsPromise;
  if (globalThis.jspdf?.jsPDF) {
    pdfLibsPromise = Promise.resolve();
    return pdfLibsPromise;
  }
  pdfLibsPromise = loadPdfScriptOnce(
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    "sha384-en/ztfPSRkGfME4KIm05joYXynqzUgbsG5nMrj/xEFAHXkeZfO3yMK8QQ+mP7p1/",
    "jspdf",
  ).then(function () {
    return loadPdfScriptOnce(
      "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js",
      "sha384-Zj5NAMJ45tB1L13yWiQlFjFjlyyeUBZTWQKktGXeW303njR3jSLmfN16iUgF8I8n",
      "jspdf-autotable",
    );
  });
  return pdfLibsPromise;
}

function downloadPDF() {
  if (!reportData.length) return;
  ensurePdfLibs()
    .then(function () {
      if (globalThis.jspdf === undefined || !globalThis.jspdf.jsPDF) {
        throw new Error("jsPDF not available after load");
      }
      let JsPDF = globalThis.jspdf.jsPDF;
      let margin = 36;
      let doc = new JsPDF({
        orientation: "landscape",
        unit: "pt",
        format: "letter",
      });
      doc.setFontSize(14);
      doc.setTextColor(11, 22, 40);
      doc.text("CRM 2026 — Pledges Report", margin, margin);
      doc.setFontSize(9);
      doc.setTextColor(90, 90, 90);
      doc.text(
        "Generated " + new Date().toISOString().slice(0, 19) + "Z",
        margin,
        margin + 18,
      );
      doc.setTextColor(0, 0, 0);

      let head = [REPORT_TABLE_HEADERS];
      let body = reportData.map(function (r) {
        return reportExportCellValues(r);
      });

      try {
        doc.autoTable({
          startY: margin + 28,
          head: head,
          body: body,
          styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
          columnStyles: {
            12: { minCellWidth: 140, fontSize: 6 },
          },
          headStyles: {
            fillColor: [200, 168, 90],
            textColor: [11, 22, 40],
            fontStyle: "bold",
          },
          alternateRowStyles: { fillColor: [248, 246, 242] },
          margin: { left: margin, right: margin },
          showHead: "everyPage",
        });
      } catch (e) {
        alert(
          "Could not build PDF: " +
            (e?.message ? e.message : String(e)) +
            ". Try refreshing the page.",
        );
        return;
      }

      doc.save(
        "crm2026-registrations-" +
          new Date().toISOString().slice(0, 10) +
          ".pdf",
      );
    })
    .catch(function (e) {
      alert(
        "Could not export PDF: " +
          (e?.message ? e.message : String(e)) +
          ". Check your network and try again.",
      );
    });
}

function showMsg(id, msg, type) {
  let el = document.getElementById(id);
  if (!el) return;
  if (!msg) {
    el.className = "";
    el.textContent = "";
    return;
  }
  el.className = "msg msg-" + (type || "inf");
  el.textContent = msg;
}

function setText(id, v) {
  let el = document.getElementById(id);
  if (el) el.textContent = v;
}

function esc(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Escape for HTML attribute values (e.g. data-code). */
function escAttr(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

const REPORT_COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

const REPORT_COPIED_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7dbf80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function copyReportPledgeCode(code, btn) {
  if (!code || !btn) return;
  function ok() {
    if (!btn.dataset.prevInner) btn.dataset.prevInner = btn.innerHTML;
    btn.innerHTML = REPORT_COPIED_ICON_SVG;
    btn.title = "Copied";
    btn.setAttribute("aria-label", "Copied");
    globalThis.clearTimeout(btn._copyTid);
    btn._copyTid = globalThis.setTimeout(function () {
      btn.innerHTML = btn.dataset.prevInner || REPORT_COPY_ICON_SVG;
      btn.title = "Copy pledge code";
      btn.setAttribute("aria-label", "Copy pledge code");
    }, 1600);
  }
  function fail() {
    btn.title = "Copy failed — select code manually";
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(ok).catch(fail);
  } else {
    try {
      let ta = document.createElement("textarea");
      ta.value = code;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      ok();
    } catch (e) {
      fail();
    }
  }
}
function initZeffyDropZone() {
  let zDrop = document.getElementById("z-drop-zone");
  if (zDrop) {
    zDrop.addEventListener("dragover", function (e) {
      e.preventDefault();
      zDrop.classList.add("over");
    });
    zDrop.addEventListener("dragleave", function () {
      zDrop.classList.remove("over");
    });
    zDrop.addEventListener("drop", function (e) {
      e.preventDefault();
      zDrop.classList.remove("over");
      handleZeffyFile(e.dataTransfer.files[0]);
    });
  }
}

function handleZeffyFile(file) {
  if (!file) return;
  let st = document.getElementById("z-csv-status");
  st.textContent = "Reading " + file.name + "…";
  st.style.color = "#C8A85A";
  file
    .text()
    .then(function (text) {
      zLastCsvText = text;
      st.textContent = "Uploading preview…";
      return staffJson("/api/admin/import/zeffy/preview", {
        method: "POST",
        body: JSON.stringify({ csv_text: zLastCsvText }),
      });
    })
    .then(function (data) {
      zMatchedRows = data.rows || [];
      renderZeffyPreview(zMatchedRows, data.summary || {});
      st.textContent =
        "✓ Preview ready — " + (data.summary.matched || 0) + " matched.";
      st.style.color = "#7dbf80";
    })
    .catch(function (err) {
      st.textContent = "✗ " + (err.message || err);
      st.style.color = "#e09090";
    });
}

function renderZeffyPreview(rows, summary) {
  document.getElementById("zs-total").textContent =
    summary.total_rows == null ? rows.length : summary.total_rows;
  document.getElementById("zs-match").textContent =
    summary.matched == null ? 0 : summary.matched;
  document.getElementById("zs-none").textContent =
    summary.unmatched == null ? 0 : summary.unmatched;
  let dupEl = document.getElementById("zs-dup");
  if (dupEl)
    dupEl.textContent = summary.duplicates == null ? 0 : summary.duplicates;

  let applyTotal = 0;
  rows.forEach(function (r) {
    if (
      r.registration &&
      !r.skip &&
      !(r.flags || []).includes("duplicate") &&
      !(r.flags || []).includes("unmatched")
    ) {
      applyTotal += r.amount_dollars || 0;
    }
  });
  document.getElementById("zs-amt").textContent = "$" + applyTotal.toFixed(2);

  let tbody = document.getElementById("z-preview-body");
  tbody.innerHTML = "";
  rows.forEach(function (r) {
    let tr = document.createElement("tr");
    if (r.skip) {
      tr.innerHTML =
        "<td>—</td><td>—</td><td>$" +
        (r.amount_dollars == null ? "0" : r.amount_dollars.toFixed(2)) +
        "</td><td>—</td>" +
        '<td><span style="font-size:0.62rem;color:rgba(232,223,200,0.35);">' +
        esc(r.flags?.[0] || r.skip_reason || "") +
        "</span></td><td>—</td><td>—</td><td>—</td>";
    } else {
      let reg = r.registration;
      let pled = reg ? regTotalPledged(reg) : 0;
      let afterPaid = reg ? regAmountPaid(reg) + (r.amount_dollars || 0) : null;
      let afterRem = reg ? pled - afterPaid : null;
      let flags = (r.flags || []).join(", ");
      let fl = r.flags || [];
      let badgeTxt = "—";
      if (fl.includes("duplicate")) {
        badgeTxt = "Duplicate";
      } else if (fl.includes("unmatched")) {
        badgeTxt = "No Match";
      } else if (fl.includes("no_pledge_code")) {
        badgeTxt = "No Code";
      } else if (fl.includes("overpayment")) {
        badgeTxt = "Overpay";
      } else if (reg) {
        badgeTxt = "OK";
      }
      let badgeCls =
        reg && (r.flags || []).length === 0 ? "b-complete" : "b-pending";
      let balTd = reg ? adminPreviewBalanceHtml(pled, afterRem) : "—";
      tr.innerHTML =
        "<td>" +
        esc(r.date || "") +
        "</td>" +
        "<td>" +
        esc(r.donor || "") +
        "</td>" +
        "<td>$" +
        (r.amount_dollars == null ? "0" : r.amount_dollars.toFixed(2)) +
        "</td>" +
        '<td style="font-family:monospace;color:#E8C87A;letter-spacing:0.1em;">' +
        esc(r.pledge_code || "—") +
        "</td>" +
        '<td><span class="badge ' +
        badgeCls +
        '">' +
        esc(badgeTxt) +
        "</span></td>" +
        "<td>" +
        (reg ? esc(reg.first_name + " " + reg.last_name) : "—") +
        "</td>" +
        "<td>" +
        balTd +
        "</td>" +
        '<td style="font-size:0.65rem;color:rgba(232,223,200,0.35);">' +
        esc(flags) +
        "</td>";
    }
    tbody.appendChild(tr);
  });

  document.getElementById("z-preview-card").classList.remove("hidden");
  let nApply = rows.filter(function (r) {
    if (r.skip || !r.registration) return false;
    let f = r.flags || [];
    if (f.includes("duplicate") || f.includes("unmatched")) return false;
    if (f.includes("no_pledge_code")) return false;
    if (f.includes("overpayment")) return false;
    return true;
  }).length;
  document.getElementById("z-sync-btn").disabled = nApply === 0;
}

function doZeffySync() {
  if (zeffyApplyBusy) return;
  let btn = document.getElementById("z-sync-btn");
  let log = document.getElementById("z-sync-log");
  let confirmOver = document.getElementById("z-confirm-overpay").checked;
  let items = zMatchedRows
    .filter(function (r) {
      if (r.skip || !r.registration) return false;
      let f = r.flags || [];
      if (f.includes("duplicate") || f.includes("unmatched")) return false;
      if (f.includes("no_pledge_code")) return false;
      if (f.includes("overpayment") && !confirmOver) return false;
      return true;
    })
    .map(function (r) {
      return {
        registration_id: r.registration.id,
        external_ref: r.proposed_external_ref,
        amount_cents: r.amount_cents,
        received_at: r.date || "",
        notes: "Zeffy CSV — " + (r.donor || ""),
      };
    });

  if (!items.length) {
    document.getElementById("z-sync-status").textContent =
      "No rows to apply (enable overpayment or fix duplicates).";
    return;
  }

  zeffyApplyBusy = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Applying…';
  log.innerHTML = "";
  log.classList.remove("hidden");
  zLog(log, "inf", "Applying " + items.length + " row(s)…");

  staffJson("/api/admin/import/zeffy/apply", {
    method: "POST",
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
            "ok",
            "✓ " + (row.pledge_code || row.registration_id) + " — posted",
          );
        } else {
          zLog(log, "err", "✗ " + (row.error || "failed"));
        }
      });
      zLog(
        log,
        data.failed ? "err" : "ok",
        "Done — applied: " + data.applied + ", failed: " + data.failed,
      );
      document.getElementById("z-sync-status").textContent =
        "Applied " + data.applied + " — failed " + data.failed;
      btn.textContent = data.failed ? "Retry / Refresh" : "✓ Complete";
    })
    .catch(function (err) {
      zLog(log, "err", "✗ " + err.message);
      document.getElementById("z-sync-status").textContent = err.message;
    })
    .then(function () {
      zeffyApplyBusy = false;
      btn.disabled = false;
      if (
        !btn.textContent.includes("Complete") &&
        !btn.textContent.includes("Retry")
      ) {
        btn.textContent = "Sync Matched Records →";
      }
    });
}

function resetZeffyCSV() {
  zMatchedRows = [];
  zLastCsvText = "";
  document.getElementById("z-csv-file").value = "";
  document.getElementById("z-csv-status").textContent = "";
  document.getElementById("z-preview-card").classList.add("hidden");
}

function zLog(el, cls, msg) {
  let colors = { ok: "#7dbf80", err: "#e09090", inf: "#C8A85A" };
  el.innerHTML +=
    '<span style="color:' + colors[cls] + '">' + esc(msg) + "</span>\n";
  el.scrollTop = el.scrollHeight;
}

/* ══════════════════════════════════════════════
   ZELLE — SINGLE / BATCH
══════════════════════════════════════════════ */
let szReg = null;
/** Normalized pledge/email string used for the open preview; if the code field diverges, preview clears. */
let szLookupKey = null;

function clearZelleSinglePreview() {
  szReg = null;
  szLookupKey = null;
  let res = document.getElementById("sz-result");
  if (res) res.style.display = "none";
  let dup = document.getElementById("sz-dup-warn");
  if (dup) {
    dup.classList.add("hidden");
    dup.textContent = "";
  }
  let ban = document.getElementById("sz-step-banner");
  if (ban) {
    ban.classList.add("hidden");
    ban.textContent = "";
    ban.classList.remove("msg-inf", "msg-warn", "msg-err", "msg-ok");
  }
  let st = document.getElementById("sz-status");
  if (st) {
    st.textContent = "";
    st.style.color = "rgba(232,223,200,0.38)";
  }
  syncSzConfirmButtonState();
  syncSzLookupButtonState();
  resetSzResultCardShell();
}

function invalidateZellePreviewIfLookupKeyChanged() {
  if (!szReg || szLookupKey == null) return;
  let typed = document.getElementById("sz-code")?.value.trim().toUpperCase() || "";
  if (!typed) {
    clearZelleSinglePreview();
    return;
  }
  if (typed !== szLookupKey) {
    clearZelleSinglePreview();
  }
}

/** Callout when pledge total is met (nothing left to pay on file). */
function buildZelleZeroBalanceCallout(reg, hasValidAmount) {
  let pled = regTotalPledged(reg);
  let paid = regAmountPaid(reg);
  let rem = Math.max(0, pled - paid);
  if (!(pled > 0 && rem <= 0.005)) return "";
  let body = hasValidAmount
    ? "Balance on file is <strong>$0.00</strong>. The amount you apply is an <strong>extra</strong> deposit and only posts after you confirm overpayment."
    : "Balance on file is <strong>$0.00</strong>. Enter the amount received to preview the line; recording will require overpayment confirmation.";
  return (
    '<div class="sz-reg-zero-callout" role="status">' +
    '<span class="sz-reg-zero-badge">$0 due — pledge satisfied</span>' +
    '<p class="sz-reg-zero-callout-p">' +
    body +
    "</p>" +
    "</div>"
  );
}

function resetSzResultCardShell() {
  let inner = document.getElementById("sz-result-inner");
  let titleEl = document.getElementById("sz-result-title");
  if (inner) inner.classList.remove("sz-reg-fully-paid");
  if (titleEl) titleEl.textContent = "Registration Found";
}

function syncSzResultCardShell() {
  let inner = document.getElementById("sz-result-inner");
  let titleEl = document.getElementById("sz-result-title");
  if (!inner || !szReg) {
    resetSzResultCardShell();
    return;
  }
  let pled = regTotalPledged(szReg);
  let paid = regAmountPaid(szReg);
  let rem = Math.max(0, pled - paid);
  let zero = pled > 0 && rem <= 0.005;
  inner.classList.toggle("sz-reg-fully-paid", zero);
  if (titleEl) {
    titleEl.textContent = zero
      ? "Registration Found — $0 balance (fully paid on pledge)"
      : "Registration Found";
  }
}

/** HTML for name/church + balance lines (amount comes from the live field). */
function buildQuickZelleRegInfoHtml(reg, amt) {
  let top =
    '<strong style="color:#E8C87A;font-size:1rem;">' +
    esc(reg.first_name + " " + reg.last_name) +
    "</strong><br/>" +
    "Email: " +
    esc(reg.email) +
    " &nbsp;·&nbsp; Church: " +
    esc(reg.church || "—") +
    "<br/>";
  if (!Number.isFinite(amt) || amt <= 0) {
    let co = buildZelleZeroBalanceCallout(reg, false);
    return (
      top +
      co +
      '<p class="msg msg-inf" style="margin:0.7rem 0 0 0;font-size:0.78rem;padding:0.55rem 0.75rem;">Enter a valid <strong>Amount Received</strong> to refresh the balance preview.</p>'
    );
  }
  let pled = regTotalPledged(reg);
  let paid = regAmountPaid(reg);
  let rem = Math.max(0, pled - paid);
  let newRem = pled - (paid + amt);
  let newBalColor = "rgba(232,223,200,0.35)";
  let newBalLabel = "—";
  if (pled > 0) {
    if (newRem <= 0) {
      newBalColor = "#7dbf80";
      newBalLabel = "Fully Paid ✓";
    } else {
      newBalColor = "#E8C87A";
      newBalLabel = "$" + newRem.toFixed(2);
    }
  }
  let co = buildZelleZeroBalanceCallout(reg, true);
  let curBalHtml =
    pled > 0 && rem <= 0.005
      ? 'Current balance: <strong class="sz-reg-balance-zero">$' +
        rem.toFixed(2) +
        " — fully paid on pledge</strong><br/>"
      : 'Current balance: <strong style="color:#E8C87A;">$' +
        rem.toFixed(2) +
        "</strong><br/>";
  return (
    top +
    co +
    curBalHtml +
    'Payment to apply: <strong style="color:#7dbf80;">$' +
    amt.toFixed(2) +
    "</strong><br/>" +
    'New balance after: <strong style="color:' +
    newBalColor +
    ';">' +
    newBalLabel +
    "</strong>"
  );
}

function updateQuickZelleStepBanner() {
  let ban = document.getElementById("sz-step-banner");
  if (!ban) return;
  let res = document.getElementById("sz-result");
  if (!szReg || !res || res.style.display === "none") {
    ban.classList.add("hidden");
    ban.textContent = "";
    return;
  }
  let amt = Number.parseFloat(document.getElementById("sz-amt")?.value || 0);
  let amtOk = Number.isFinite(amt) && amt > 0;
  let pled = regTotalPledged(szReg);
  let paid = regAmountPaid(szReg);
  let rem = Math.max(0, pled - paid);

  ban.classList.remove("hidden", "msg-inf", "msg-warn", "msg-err", "msg-ok");
  ban.classList.add("msg");

  if (!amtOk) {
    ban.classList.add("msg-inf");
    ban.textContent =
      "Enter the amount received and the received date before recording.";
    return;
  }
  if (pled > 0 && rem <= 0.005) {
    ban.classList.add("msg-warn");
    ban.textContent =
      "Pledge is already satisfied on file. Confirm only if this deposit is real — you will approve it as overpayment.";
    return;
  }
  if (pled > 0 && amt > rem + 0.01) {
    ban.classList.add("msg-inf");
    ban.textContent =
      "This amount is above the remaining balance; you will be asked to confirm overpayment when you record.";
    return;
  }
  if (pled > 0) {
    ban.classList.add("msg-inf");
    ban.textContent =
      "Remaining balance before this deposit: $" + rem.toFixed(2) + ".";
    return;
  }
  ban.classList.add("msg-inf");
  ban.textContent =
    "No pledge total on file for this tier. You can still record this deposit if you confirm.";
}

function syncSzConfirmButtonState() {
  let btn = document.getElementById("sz-confirm-btn");
  if (!btn) return;
  let res = document.getElementById("sz-result");
  let previewOpen = res && res.style.display !== "none";
  let dateOk = !!String(
    document.getElementById("sz-date")?.value || "",
  ).trim();
  let amt = Number.parseFloat(document.getElementById("sz-amt")?.value || 0);
  let amtOk = Number.isFinite(amt) && amt > 0;
  btn.disabled =
    szConfirmBusy || !szReg || !previewOpen || !dateOk || !amtOk;
}

function refreshQuickZellePreviewAfterEdit() {
  if (!szReg) return;
  let res = document.getElementById("sz-result");
  if (!res || res.style.display === "none") return;
  let amt = Number.parseFloat(document.getElementById("sz-amt")?.value || 0);
  let info = document.getElementById("sz-reg-info");
  if (info) info.innerHTML = buildQuickZelleRegInfoHtml(szReg, amt);
  updateQuickZelleStepBanner();
  refreshZelleDupIfPreviewOpen();
  syncSzConfirmButtonState();
  syncSzResultCardShell();
}

function buildZelleSingleExternalRef(
  regId,
  amountCents,
  dateStr,
  pledgeCode,
  senderName,
) {
  let day = String(dateStr || "")
    .trim()
    .slice(0, 10);
  return (
    "zelle-inbox-" +
    regId +
    "-" +
    day +
    "-" +
    amountCents +
    "-" +
    staffStringHash(
      String(pledgeCode || "").toUpperCase() + "|" + String(senderName || ""),
    )
  );
}

function singleZelleLookup() {
  let code = document.getElementById("sz-code").value.trim().toUpperCase();
  let amt = Number.parseFloat(document.getElementById("sz-amt").value || 0);
  let errEl = document.getElementById("sz-error");
  let st = document.getElementById("sz-status");
  let dupEl = document.getElementById("sz-dup-warn");
  errEl.style.display = "none";
  document.getElementById("sz-result").style.display = "none";
  if (dupEl) {
    dupEl.classList.add("hidden");
    dupEl.textContent = "";
  }
  if (st) st.textContent = "";
  if (!code) {
    errEl.textContent = "Please enter a pledge code.";
    errEl.style.display = "block";
    syncSzLookupButtonState();
    return;
  }
  if (!amt || amt <= 0) {
    errEl.textContent = "Please enter a valid amount.";
    errEl.style.display = "block";
    syncSzLookupButtonState();
    return;
  }
  if (szLookupBusy || szConfirmBusy) return;

  szReg = null;
  szLookupKey = null;
  let lookupBtn = document.getElementById("sz-lookup-btn");
  szLookupBusy = true;
  syncSzLookupButtonState();
  if (lookupBtn) {
    lookupBtn.innerHTML = '<span class="spinner"></span>Looking up…';
  }
  setZelleInputsDisabled(true);

  staffJson("/api/admin/registrations?lookup=" + encodeURIComponent(code))
    .then(function (data) {
      let list = data.registrations || [];
      if (!list.length) {
        errEl.textContent = "No registration found.";
        errEl.style.display = "block";
        return;
      }
      szReg = list[0];
      szLookupKey = code;
      document.getElementById("sz-result").style.display = "block";
      refreshQuickZellePreviewAfterEdit();

      let dateStr = document.getElementById("sz-date").value;

      return staffJson(
        "/api/admin/registration-payments?registration_id=" +
          encodeURIComponent(szReg.id),
      ).then(function (payData) {
        showZelleDupFromPayments(payData.payments || [], amt, dateStr);
      });
    })
    .catch(function (e) {
      errEl.textContent = e.message || String(e);
      errEl.style.display = "block";
    })
    .then(function () {
      szLookupBusy = false;
      setZelleInputsDisabled(false);
      if (lookupBtn) {
        lookupBtn.textContent = "Look Up & Preview →";
      }
      syncSzLookupButtonState();
      syncSzConfirmButtonState();
    });
}

function confirmSingleZelle() {
  if (!szReg || szConfirmBusy) return;
  let amt = Number.parseFloat(document.getElementById("sz-amt").value || 0);
  let date = String(document.getElementById("sz-date").value || "").trim();
  let name = document.getElementById("sz-name").value;
  let code = document.getElementById("sz-code").value.trim().toUpperCase();
  let btn = document.getElementById("sz-confirm-btn");
  let st = document.getElementById("sz-status");
  let cancelBtn = document.getElementById("sz-cancel-btn");
  let lookupBtn = document.getElementById("sz-lookup-btn");

  if (!date) {
    if (st) {
      st.textContent = "Choose the received date before recording.";
      st.style.color = "#e09090";
    }
    return;
  }
  if (!amt || amt <= 0) {
    if (st) {
      st.textContent = "Enter a valid amount before recording.";
      st.style.color = "#e09090";
    }
    return;
  }

  let pled = regTotalPledged(szReg);
  let paid = regAmountPaid(szReg);
  let rem = Math.max(0, pled - paid);
  let confirmOver = false;
  if (amt > rem + 0.01) {
    if (
      !confirm(
        "This payment exceeds the remaining balance. Record as overpayment?",
      )
    ) {
      return;
    }
    confirmOver = true;
  }

  let amountCents = Math.round(Number.parseFloat(amt.toFixed(2)) * 100);
  let externalRef = buildZelleSingleExternalRef(
    szReg.id,
    amountCents,
    date,
    code,
    name,
  );

  szConfirmBusy = true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Recording…';
  }
  if (cancelBtn) cancelBtn.disabled = true;
  if (lookupBtn) lookupBtn.disabled = true;
  setZelleInputsDisabled(true);
  if (st) {
    st.textContent = "";
    st.style.color = "rgba(232,223,200,0.38)";
  }

  staffFetch("/api/admin/payments/manual", {
    method: "POST",
    body: JSON.stringify({
      registration_id: szReg.id,
      amount_dollars: amt,
      received_at: date,
      payment_source: "zelle",
      notes: name ? "Sent by " + name : "",
      confirm_overpayment: confirmOver,
      external_ref: externalRef,
    }),
  })
    .then(function (r) {
      return r.json().then(function (d) {
        return { ok: r.ok, d: d };
      });
    })
    .then(function (res) {
      if (!res.ok) {
        let errCode = res.d?.error ? String(res.d.error) : "";
        if (errCode.includes("duplicate_external_ref")) {
          throw new Error(
            "DUPLICATE: This Zelle line was already recorded (same reference). If you need another line, change the date or sender name slightly so the reference differs.",
          );
        }
        throw new Error(res.d.error || res.d.message || "Failed");
      }
      let data = res.d;
      st.textContent =
        "✓ Recorded — new paid: $" +
        data.new_paid.toFixed(2) +
        (data.new_balance <= 0
          ? " — Fully Paid!"
          : " — Balance: $" + data.new_balance.toFixed(2));
      st.style.color = "#7dbf80";
      szReg = null;
      szLookupKey = null;
      resetSzResultCardShell();
      ["sz-code", "sz-amt", "sz-name"].forEach(function (id) {
        document.getElementById(id).value = "";
      });
      let dupWarn = document.getElementById("sz-dup-warn");
      if (dupWarn) {
        dupWarn.classList.add("hidden");
        dupWarn.textContent = "";
      }
      let stepBan = document.getElementById("sz-step-banner");
      if (stepBan) {
        stepBan.classList.add("hidden");
        stepBan.textContent = "";
        stepBan.classList.remove("msg-inf", "msg-warn", "msg-err", "msg-ok");
      }
      setTimeout(function () {
        document.getElementById("sz-result").style.display = "none";
      }, 3500);
    })
    .catch(function (e) {
      let msg = e.message || String(e);
      st.textContent = "✗ " + msg;
      st.style.color = "#e09090";
    })
    .then(function () {
      szConfirmBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Confirm & Record →";
      }
      if (cancelBtn) cancelBtn.disabled = false;
      setZelleInputsDisabled(false);
      syncSzLookupButtonState();
      syncSzConfirmButtonState();
    });
}

function cancelSingleZelle() {
  if (szConfirmBusy) return;
  clearZelleSinglePreview();
}

function parseBatch() {
  let text = document.getElementById("batch-text").value.trim();
  let lines = text.split("\n").filter(function (l) {
    return l.trim();
  });
  if (!lines.length) {
    document.getElementById("batch-parse-status").textContent =
      "No rows found.";
    return;
  }

  let parsed = lines
    .map(function (line) {
      let parts = line.split(",").map(function (s) {
        return s.trim();
      });
      return {
        code: (parts[0] || "").toUpperCase(),
        amount: Number.parseFloat(parts[1] || 0),
        date: parts[2] || new Date().toISOString().slice(0, 10),
        name: parts[3] || "",
        reg: null,
      };
    })
    .filter(function (r) {
      return r.code && r.amount > 0;
    });

  if (!parsed.length) {
    document.getElementById("batch-parse-status").textContent =
      "No valid rows. Format: CODE, AMOUNT, DATE, NAME";
    return;
  }
  batchRows = parsed;
  document.getElementById("batch-parse-status").textContent =
    "Looking up " + parsed.length + " code(s)…";

  let regMap = {};
  let pending = batchRows.length;
  batchRows.forEach(function (r) {
    staffJson("/api/admin/registrations?lookup=" + encodeURIComponent(r.code))
      .then(function (data) {
        let list = data.registrations || [];
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
  let nMatch = batchRows.filter(function (r) {
    return r.reg;
  }).length;
  document.getElementById("batch-parse-status").textContent =
    nMatch + " of " + batchRows.length + " matched.";

  let tbody = document.getElementById("batch-body");
  tbody.innerHTML = "";
  batchRows.forEach(function (r) {
    let pled = r.reg ? regTotalPledged(r.reg) : 0;
    let afterPaid = r.reg ? regAmountPaid(r.reg) + r.amount : null;
    let afterRem = r.reg ? pled - afterPaid : null;
    let tr = document.createElement("tr");
    let balCell = r.reg ? adminPreviewBalanceHtml(pled, afterRem) : "—";
    tr.innerHTML =
      '<td style="font-family:monospace;color:#E8C87A;letter-spacing:0.1em;">' +
      esc(r.code) +
      "</td>" +
      "<td>$" +
      r.amount.toFixed(2) +
      "</td>" +
      "<td>" +
      esc(r.date) +
      "</td>" +
      "<td>" +
      esc(r.name || "—") +
      "</td>" +
      '<td><span class="badge ' +
      (r.reg ? "b-complete" : "b-pending") +
      '">' +
      (r.reg ? "Match" : "No Match") +
      "</span></td>" +
      "<td>" +
      (r.reg ? esc(r.reg.first_name + " " + r.reg.last_name) : "—") +
      "</td>" +
      "<td>" +
      balCell +
      "</td>";
    tbody.appendChild(tr);
  });

  document.getElementById("batch-preview").style.display = "block";
  document.getElementById("batch-apply-btn").disabled = nMatch === 0;
}

function applyBatch() {
  if (batchApplyBusy) return;
  let btn = document.getElementById("batch-apply-btn");
  let log = document.getElementById("batch-log");
  batchApplyBusy = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Applying…';
  log.innerHTML = "";
  log.classList.remove("hidden");

  let toApply = batchRows.filter(function (r) {
    return r.reg;
  });
  zLog(log, "inf", "Applying " + toApply.length + " payment(s)…");
  let i = 0;
  function next() {
    if (i >= toApply.length) {
      zLog(log, "ok", "✓ Done. " + toApply.length + " processed.");
      batchApplyBusy = false;
      btn.disabled = false;
      btn.textContent = "✓ Done";
      document.getElementById("batch-apply-status").textContent =
        "Done — " + toApply.length + " applied.";
      return;
    }
    let r = toApply[i++];
    let pled = regTotalPledged(r.reg);
    let paid = regAmountPaid(r.reg);
    let rem = Math.max(0, pled - paid);
    let confirmOver = false;
    if (r.amount > rem + 0.01) {
      if (
        !confirm(
          "Row " +
            r.code +
            ": amount exceeds balance. Allow overpayment for this row?",
        )
      ) {
        zLog(
          log,
          "inf",
          "⊘ " + r.code + " skipped (overpayment not confirmed)",
        );
        next();
        return;
      }
      confirmOver = true;
    }
    staffFetch("/api/admin/payments/manual", {
      method: "POST",
      body: JSON.stringify({
        registration_id: r.reg.id,
        amount_dollars: r.amount,
        received_at: r.date,
        payment_source: "zelle",
        notes: r.name ? "Sent by " + r.name : "",
        confirm_overpayment: confirmOver,
      }),
    })
      .then(function (res) {
        return res.json().then(function (d) {
          return { ok: res.ok, d: d };
        });
      })
      .then(function (res) {
        if (res.ok) {
          zLog(
            log,
            "ok",
            "✓ " +
              r.code +
              " (" +
              r.reg.first_name +
              ") +$" +
              r.amount.toFixed(2) +
              " → paid: $" +
              res.d.new_paid.toFixed(2),
          );
        } else {
          zLog(log, "err", "✗ " + r.code + " — " + (res.d.error || "failed"));
        }
        next();
      })
      .catch(function (e) {
        zLog(log, "err", "✗ " + r.code + " — " + e.message);
        next();
      });
  }
  next();
}

/* boot */
document.addEventListener("DOMContentLoaded", function () {
  let authBoot = initSupabase();
  initStaffPaymentForms();
  initZeffyDropZone();
  authBoot.catch(function (e) {
    showLoginScreen();
    let msg = document.getElementById("login-msg");
    if (msg) {
      msg.className = "msg msg-err";
      msg.textContent = e.message || String(e);
      msg.classList.remove("hidden");
    }
  });
});
