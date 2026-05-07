import { consola } from "consola";

/**
 * Minimal HTTP smoke checks against a live deployment or `vercel dev`.
 *
 *   SMOKE_BASE_URL=https://your-project.vercel.app bun run test:smoke-http
 *
 * Does not send secrets; asserts status codes only. Staff/Zeffy preview routes
 * are checked for unauthenticated 401, not for successful CSV handling.
 * GET /api/admin/auth-config: 200 or 500 (missing Supabase env); 500 logs a WARN.
 */

const base = (process.env.SMOKE_BASE_URL || "").replace(/\/+$/, "");
if (!base) {
  consola.error(
    "Missing SMOKE_BASE_URL. Example: SMOKE_BASE_URL=http://localhost:3000 bun run test:smoke-http",
  );
  process.exit(1);
}

async function http(method, path, { body, headers } = {}) {
  const url = `${base}${path}`;
  return fetch(url, {
    method,
    headers: {
      ...(body == null ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

let failures = 0;

function ok(name, condition, detail = "") {
  if (condition) {
    consola.log(`OK   ${name}`);
  } else {
    failures += 1;
    consola.error(`FAIL ${name}`, detail);
  }
}

try {
  let r = await http("GET", "/api/lookup");
  ok("GET /api/lookup (no token)", r.status === 400);

  r = await http("POST", "/api/register", { body: {} });
  ok("POST /api/register (empty body)", r.status === 400);

  r = await http("POST", "/api/lookup-request", {
    body: { email: "smoke@example.com", pledge_code: "AB" },
  });
  ok(
    "POST /api/lookup-request (short pledge → generic success)",
    r.status === 200,
  );

  r = await http("GET", "/api/remind");
  ok("GET /api/remind (no cron secret)", r.status === 401);

  r = await http("GET", "/api/admin/registrations");
  ok("GET /api/admin/registrations (no bearer)", r.status === 401);

  r = await http("POST", "/api/admin/import/zeffy/preview", {
    body: { csv_text: "" },
  });
  ok("POST /api/admin/import/zeffy/preview (no bearer)", r.status === 401);

  r = await http("POST", "/api/admin/payments/manual", {
    body: { registration_id: "x", amount_dollars: 1 },
  });
  ok("POST /api/admin/payments/manual (no bearer)", r.status === 401);

  r = await http("POST", "/api/admin/import/zeffy/apply", {
    body: { items: [] },
  });
  ok("POST /api/admin/import/zeffy/apply (no bearer)", r.status === 401);

  r = await http("GET", "/api/admin/auth-config");
  if (r.status === 500) {
    consola.warn(
      "WARN GET /api/admin/auth-config returned 500 — check SUPABASE_URL / SUPABASE_ANON_KEY on this deployment",
    );
  }
  ok(
    "GET /api/admin/auth-config",
    r.status === 200 || r.status === 500,
    `(got ${r.status})`,
  );

  r = await http("GET", "/privacy-policy.html");
  ok("GET /privacy-policy.html", r.status === 200);

  r = await http("GET", "/sitemap.xml");
  ok("GET /sitemap.xml", r.status === 200);

  r = await http("GET", "/robots.txt");
  ok("GET /robots.txt", r.status === 200);
} catch (err) {
  consola.error("Smoke failed with network error:", err);
  process.exit(1);
}

if (failures > 0) {
  consola.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

consola.log("\nAll smoke checks passed.");
