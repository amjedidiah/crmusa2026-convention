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
  const result = await limiter.limit(ip);
  return { ok: result.success };
}
