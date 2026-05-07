import { deriveRegistrationStatus, formatUsdFromCents } from './registration.js';

export function buildRegistrationEmailModel(registration) {
  const totalCents = Number(registration.total_cents) || 0;
  const amountPaidCents = Number(registration.amount_paid_cents) || 0;
  const remainingCents = Math.max(0, totalCents - amountPaidCents);

  return {
    fullName: [registration.first_name, registration.last_name].filter(Boolean).join(' ').trim(),
    pledgeCode: registration.pledge_code,
    tier: registration.tier,
    totalCents,
    amountPaidCents,
    remainingCents,
    totalUsd: formatUsdFromCents(totalCents),
    amountPaidUsd: formatUsdFromCents(amountPaidCents),
    remainingUsd: formatUsdFromCents(remainingCents),
    status: deriveRegistrationStatus(totalCents, amountPaidCents),
    attendees: Array.isArray(registration.attendees_json) ? registration.attendees_json : [],
  };
}
