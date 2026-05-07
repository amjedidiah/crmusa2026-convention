import { deriveRegistrationStatus, formatUsdFromCents } from './registration.js';

export function buildRegistrationEmailModel(registration) {
  const totalCents = Math.max(0, Number(registration.total_cents) || 0);
  const amountPaidCents = Math.max(
    0,
    Number(registration.amount_paid_cents) || 0,
  );
  const remainingCents = Math.max(0, totalCents - amountPaidCents);

  return {
    fullName: [registration.first_name, registration.last_name]
      .filter(Boolean)
      .join(" ")
      .trim(),
    pledgeCode: registration.pledge_code,
    tier: registration.tier,
    totalCents,
    amountPaidCents,
    remainingCents,
    totalUsd: formatUsdFromCents(totalCents),
    attendees: (() => {
      if (Array.isArray(registration.attendees_json))
        return registration.attendees_json;
      if (typeof registration.attendees_json === "string") {
        try {
          const parsed = JSON.parse(registration.attendees_json);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })(),
    remainingUsd: formatUsdFromCents(remainingCents),
    status: deriveRegistrationStatus(totalCents, amountPaidCents),
    attendees: Array.isArray(registration.attendees_json)
      ? registration.attendees_json
      : [],
  };
}
