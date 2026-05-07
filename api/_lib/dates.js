export function normalizeReceivedAt(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes('T')) return trimmed;
  return `${trimmed}T12:00:00.000Z`;
}
