/**
 * Single-line JSON logs for Vercel / log drains. Prefer registration_id and
 * payment_id (or payment_external_ref) on every payment-related line.
 */

function write(level, line) {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * @param {'info'|'warn'|'error'} level
 * @param {string} event dot-separated stable name, e.g. register.persisted
 * @param {Record<string, unknown>} [fields]
 */
export function serverLog(level, event, fields = {}) {
  const payload = {
    ...fields,
    ts: new Date().toISOString(),
    level,
    event,
  };
  try {
    write(level, JSON.stringify(payload));
  } catch {
    write(level, JSON.stringify({ ts: payload.ts, level, event, detail: 'log_serialize_failed' }));
  }
}
