/** Normalize pledge code for URL/query matching (uppercase alphanumeric). */
export function normalizePledgeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
