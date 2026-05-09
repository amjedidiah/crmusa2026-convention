/**
 * User-visible recovery copy (`LOOKUP_LINK_GENERIC_MESSAGE`, `RESEND_CONFIRMATION_GENERIC_MESSAGE`).
 *
 * Anti-enumeration is mandatory: for HTTP 200 outcomes, never vary `message` (or `ok`) based on
 * whether a registration matched, whether email send succeeded, or invalid vs valid input.
 * Only 429 and other non-200 errors may differ. Keep `index.html` fallbacks in sync when changing text.
 */
export const LOOKUP_LINK_GENERIC_MESSAGE =
  "If your email and pledge code match a registration on file, we sent a secure link to that address. " +
  "You will always see this same message—for privacy we never confirm whether there was a match. " +
  "Delivery is usually within a few minutes; check inbox, spam, and Promotions. " +
  'Subject line: "Your CRM 2026 registration link". ' +
  "If nothing arrives after about 15 minutes, try again or email info@crm-na.org.";

export const RESEND_CONFIRMATION_GENERIC_MESSAGE =
  "If the email and pledge code you entered match a registration on file, we sent a confirmation email to that address. " +
  "Most messages arrive within a few minutes. Check inbox, spam, and promotions. " +
  'Look for the subject line: "CRM 2026 Registration Confirmed - Code:". ' +
  "If nothing arrives after about 15 minutes, try again or contact info@crm-na.org.";
