/**
 * Single-line JSON logs for Vercel / log drains. Prefer registration_id and
 * payment_id (or payment_external_ref) on every payment-related line.
 */

import { createConsola } from "consola";

/** No badges/timestamps — one JSON line per write for log aggregators. */
const jsonDrain = createConsola({
  level: 999,
  reporters: [
    {
      log(logObj) {
        const text = logObj.args
          .map((a) => (typeof a === "string" ? a : String(a)))
          .join(" ");
        const nl = text.endsWith("\n") ? "" : "\n";
        const stream =
          logObj.type === "error" ||
          logObj.type === "fatal" ||
          logObj.type === "warn"
            ? process.stderr
            : process.stdout;
        stream.write(text + nl);
      },
    },
  ],
});

function write(level, line) {
  if (level === "error") jsonDrain.error(line);
  else if (level === "warn") jsonDrain.warn(line);
  else jsonDrain.info(line);
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
    write(
      level,
      JSON.stringify({
        ts: payload.ts,
        level,
        event,
        detail: "log_serialize_failed",
      }),
    );
  }
}
