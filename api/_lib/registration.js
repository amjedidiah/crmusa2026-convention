import { randomInt } from "node:crypto";

const CENTRAL_TIMEZONE = "America/Chicago";

export const PRICING_CENTS = {
  earlybird: { u10: 0, u17: 10000, adu: 20000 },
  regular: { u10: 5000, u17: 15000, adu: 25000 },
  late: { u10: 30000, u17: 30000, adu: 30000 },
};

export const REGISTRATION_STATUSES = [
  "pending",
  "partial",
  "complete",
  "cancelled",
];

export function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/**
 * Digits-only key for duplicate registration checks. Returns null when the
 * value is blank or too short to treat as a reliable unique contact (so shared
 * extensions / partial numbers do not block everyone).
 */
export function normalizePhoneForDedup(phone) {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  if (digits.length === 10) return digits;
  if (digits.length > 10) return digits;
  return null;
}

export function activeTierForDate(input = new Date()) {
  // Early bird through Jun 30; regular Jul 1–16; late Jul 17+ (America/Chicago).
  // Jan–Mar also map to earlybird until a registration-open gate exists elsewhere.
  // If a plain date string like "2026-07-01" is passed, parse it as wall-clock
  // components directly to avoid UTC-midnight → previous-day drift in Chicago.
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-").map(Number);
    // Use those components directly — skip Intl conversion for this branch.
    if (month < 7) return "earlybird";
    if (month === 7 && day <= 16) return "regular";
    return "late";
  }
  const date = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      values[part.type] = Number(part.value);
    }
  }

  const month = values.month;
  const day = values.day;

  if (month < 7) return "earlybird";
  if (month === 7 && day <= 16) return "regular";
  return "late";
}

export function attendeePriceCents(age, tier) {
  const numericAge = Number(age);
  const pricing = PRICING_CENTS[tier];

  if (!pricing || !Number.isFinite(numericAge) || numericAge < 0) {
    return 0;
  }

  if (numericAge <= 10) return pricing.u10;
  if (numericAge < 18) return pricing.u17;
  return pricing.adu;
}

export function calculateRegistrationTotalCents(attendees, tier) {
  if (!Array.isArray(attendees)) return 0;

  return attendees.reduce((sum, attendee) => {
    return sum + attendeePriceCents(attendee && attendee.age, tier);
  }, 0);
}

export function deriveRegistrationStatus(totalCents, amountPaidCents) {
  const total = Number(totalCents) || 0;
  const paid = Number(amountPaidCents) || 0;

  if (total <= 0 || paid >= total) return "complete";
  if (paid > 0) return "partial";
  return "pending";
}

// randomSource(n) must return a cryptographically random integer in [0, n).
// The default uses Node's CSPRNG; pass a seeded stub in tests.
export function generatePledgeCode(randomSource = (n) => randomInt(n)) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < 6; index += 1) {
    const next = randomSource(alphabet.length);
    code += alphabet[next];
  }

  return code;
}

export function formatUsdFromCents(cents) {
  const amount = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/** Normalize Supabase `attendees_json` (object or JSON string) to attendee array. */
export function parseAttendeesFromColumn(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
