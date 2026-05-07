const CENTRAL_TIMEZONE = 'America/Chicago';

export const PRICING_CENTS = {
  earlybird: { u10: 0, u17: 10000, adu: 20000 },
  regular: { u10: 5000, u17: 15000, adu: 25000 },
  late: { u10: 30000, u17: 30000, adu: 30000 },
};

export const REGISTRATION_STATUSES = ['pending', 'partial', 'complete', 'cancelled'];

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function activeTierForDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      values[part.type] = Number(part.value);
    }
  }

  const month = values.month;
  const day = values.day;

  if (month < 6 || (month === 6 && day <= 15)) return 'earlybird';
  if (month < 7 || (month === 7 && day <= 16)) return 'regular';
  return 'late';
}

export function attendeePriceCents(age, tier) {
  const numericAge = Number(age);
  const pricing = PRICING_CENTS[tier];

  if (!pricing || !Number.isFinite(numericAge) || numericAge < 0) {
    return 0;
  }

  if (numericAge <= 10) return pricing.u10;
  if (numericAge <= 17) return pricing.u17;
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

  if (total <= 0 || paid >= total) return 'complete';
  if (paid > 0) return 'partial';
  return 'pending';
}

export function generatePledgeCode(randomSource = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';

  for (let index = 0; index < 6; index += 1) {
    const next = Math.floor(randomSource() * alphabet.length);
    code += alphabet[next];
  }

  return code;
}

export function formatUsdFromCents(cents) {
  const amount = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}
