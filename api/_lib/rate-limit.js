import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

function redisConfigured() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

let registerLimiter;
let lookupRequestLimiter;

function getRedis() {
  return Redis.fromEnv();
}

export function getRegisterRateLimiter() {
  if (!redisConfigured()) return null;
  if (!registerLimiter) {
    registerLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(20, '1 m'),
      analytics: false,
      prefix: 'ratelimit:register',
    });
  }
  return registerLimiter;
}

export function getLookupRequestRateLimiter() {
  if (!redisConfigured()) return null;
  if (!lookupRequestLimiter) {
    lookupRequestLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(30, '1 m'),
      analytics: false,
      prefix: 'ratelimit:lookup-request',
    });
  }
  return lookupRequestLimiter;
}

export function getClientIp(req) {
  // On Vercel, trust this first: set by the platform, not clobbered like raw
  // X-Forwarded-For can be in some proxy stacks.
  const vercelIp = req.headers['x-vercel-forwarded-for'];
  if (typeof vercelIp === 'string' && vercelIp.trim()) {
    return vercelIp.split(',')[0].trim();
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return 'unknown';
}

/**
 * @returns {Promise<{ ok: boolean }>}
 */
export async function enforceRateLimit(req, limiterFactory) {
  const limiter = limiterFactory();
  if (!limiter) {
    return { ok: true };
  }
  const ip = getClientIp(req);
  if (ip === 'unknown') {
    return { ok: true };
  }
  try {
    const result = await limiter.limit(ip);
    return { ok: result.success };
  } catch (err) {
    // Fail open: allow the request through if Redis is unavailable.
    console.error("[rate-limit] Redis error, failing open:", err);
    return { ok: true };
  }
}
