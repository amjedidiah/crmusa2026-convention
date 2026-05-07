const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

export function normalizeReceivedAt(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ISO_DATETIME_RE.test(trimmed)) {
    // Normalize SQL-style space separator to ISO 8601 'T'
    return trimmed.replace(" ", "T");
  }
  if (ISO_DATE_ONLY_RE.test(trimmed)) {
    return `${trimmed}T12:00:00.000Z`;
  }
  return null;
}
