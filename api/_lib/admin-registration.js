/**
 * Normalize DB registration row for admin / report JSON (dollars + cents).
 */
export function registrationToAdminJson(row) {
  if (!row) return null;
  const totalCents = Number(row.total_cents) || 0;
  const paidCents = Number(row.amount_paid_cents) || 0;
  const remaining = Math.max(0, totalCents - paidCents);
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pledge_code: row.pledge_code,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    email_normalized: row.email_normalized,
    phone: row.phone,
    church: row.church,
    city: row.city,
    tier: row.tier,
    total_cents: totalCents,
    amount_paid_cents: paidCents,
    remaining_cents: remaining,
    total_amount: totalCents / 100,
    amount_paid: paidCents / 100,
    status: row.status,
    attendees_json: row.attendees_json,
    last_reminder_at: row.last_reminder_at,
    metadata: row.metadata,
  };
}
