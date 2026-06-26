import { Request, Response, NextFunction, RequestHandler } from 'express';
import { TooManyRequestsError } from '../common/errors';
import { env } from '../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory sliding-window rate limiter.
// For distributed deployments, replace with Redis-backed express-rate-limit.
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

function getClientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return ip ?? req.socket.remoteAddress ?? 'unknown';
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyPrefix?: string;
}

/**
 * Create a rate-limiter middleware.
 *
 * @example
 * // Strict limit for auth routes
 * router.post('/login', rateLimiter({ max: 10, windowMs: 60_000 }), handler);
 */
export function rateLimiter(options: RateLimiterOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? env.rateLimitWindowMs;
  const max = options.max ?? env.rateLimitMax;
  const prefix = options.keyPrefix ?? 'rl';

  // Purge stale entries every 5 minutes to prevent memory leaks
  setInterval(purgeExpired, 300_000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${prefix}:${getClientKey(req)}`;
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', max - 1);
      return next();
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return next(new TooManyRequestsError(options.message ?? 'Too many requests, please try again later'));
    }

    next();
  };
}

/** Pre-configured strict limiter for authentication endpoints. */
export const authRateLimiter = rateLimiter({
  max: 10,
  windowMs: 15 * 60 * 1000, // 15 minutes
  keyPrefix: 'auth',
  message: 'Too many authentication attempts, please try again in 15 minutes',
});
