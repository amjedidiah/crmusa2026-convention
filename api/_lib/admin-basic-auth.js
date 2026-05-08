export const ADMIN_BASIC_AUTH_REALM = "CRM USA Staff Admin";

function normalizeEnvString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getAdminBasicAuthConfig(env = process.env) {
  const username = normalizeEnvString(env.ADMIN_BASIC_AUTH_USER);
  const password = normalizeEnvString(env.ADMIN_BASIC_AUTH_PASSWORD);

  return {
    username,
    password,
    configured: username !== "" && password !== "",
  };
}

export function parseBasicAuthorizationHeader(header) {
  if (typeof header !== "string") return null;

  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!match) return null;

  let decoded = "";
  try {
    decoded = atob(match[1]);
  } catch {
    return null;
  }

  const sep = decoded.indexOf(":");
  if (sep <= 0) return null;

  return {
    username: decoded.slice(0, sep),
    password: decoded.slice(sep + 1),
  };
}

function timingSafeEqualText(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;

  let mismatch = a.length === b.length ? 0 : 1;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    mismatch |= (a.codePointAt(i) || 0) ^ (b.codePointAt(i) || 0);
  }
  return mismatch === 0;
}

export function verifyAdminBasicAuthorization(header, env = process.env) {
  const cfg = getAdminBasicAuthConfig(env);
  if (!cfg.configured) {
    return {
      ok: false,
      status: 503,
      error: "admin_basic_auth_not_configured",
    };
  }

  const creds = parseBasicAuthorizationHeader(header);
  if (!creds) {
    return {
      ok: false,
      status: 401,
      error: "missing_or_invalid_basic_auth",
    };
  }

  const ok =
    timingSafeEqualText(creds.username, cfg.username) &&
    timingSafeEqualText(creds.password, cfg.password);

  if (!ok) {
    return {
      ok: false,
      status: 401,
      error: "invalid_basic_auth_credentials",
    };
  }

  return { ok: true };
}
