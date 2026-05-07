export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function getSupabaseServiceConfig() {
  return {
    url: requireEnv('SUPABASE_URL'),
    serviceKey: requireEnv('SUPABASE_SERVICE_KEY'),
  };
}

export function createSupabaseHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
}

export async function supabaseRestRequest(
  method,
  path,
  { body, headers, timeoutMs = 10000 } = {},
) {
  const { url, serviceKey } = getSupabaseServiceConfig();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      ...createSupabaseHeaders(serviceKey),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}
