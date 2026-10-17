// In-process token-bucket rate limiter per (route, key) pair.
// Spec D7 budgets:
//   POST /oauth/device  → 5  per minute per IP
//   POST /oauth/token   → 30 per minute per IP
// We use a simple sliding-counter approach keyed by a 60s floor of now().
// Entries are lazily evicted on every check (cheap O(N) sweep over a small
// map; for the volumes spec'd this is well under 1ms per call).

export type RateLimitRoute = 'oauth_device' | 'oauth_token';

export type RateLimiter = {
  /**
   * Returns `true` if the request is allowed (and consumes one token).
   * Returns `false` if the limit is exceeded for the current window.
   */
  consume: (route: RateLimitRoute, key: string, now?: () => number) => boolean;
  /**
   * Returns the current count and limit for diagnostics.
   */
  status: (route: RateLimitRoute, key: string, now?: () => number) => { count: number; limit: number };
  /**
   * Drops all counters (test helper).
   */
  reset: () => void;
};

export type RateLimiterOptions = {
  budgets: Record<RateLimitRoute, number>; // requests per minute
  windowMs?: number;
  now?: () => number;
};

const DEFAULT_WINDOW_MS = 60_000;

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, { windowStart: number; count: number }>();

  function bucketKey(route: RateLimitRoute, key: string): string {
    return `${route}::${key}`;
  }

  function getOrCreateWindow(route: RateLimitRoute, key: string, nowMs: number) {
    const k = bucketKey(route, key);
    const floor = Math.floor(nowMs / windowMs) * windowMs;
    let bucket = buckets.get(k);
    if (!bucket || bucket.windowStart !== floor) {
      bucket = { windowStart: floor, count: 0 };
      buckets.set(k, bucket);
    }
    return bucket;
  }

  function sweep(nowMs: number): void {
    const floor = Math.floor(nowMs / windowMs) * windowMs;
    for (const [k, b] of buckets) {
      if (b.windowStart < floor) {
        buckets.delete(k);
      }
    }
  }

  return {
    consume(route, key, nowFn = now) {
      const nowMs = nowFn();
      sweep(nowMs);
      const bucket = getOrCreateWindow(route, key, nowMs);
      const limit = opts.budgets[route];
      if (bucket.count >= limit) {
        return false;
      }
      bucket.count += 1;
      return true;
    },
    status(route, key, nowFn = now) {
      const nowMs = nowFn();
      const bucket = getOrCreateWindow(route, key, nowMs);
      return { count: bucket.count, limit: opts.budgets[route] };
    },
    reset() {
      buckets.clear();
    },
  };
}

export function ipFromRequest(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, unknown>;
}): string {
  // We deliberately do NOT trust forwarded headers in this in-process
  // limiter (the deployment puts aem-mcp behind a single trusted proxy
  // whose config is recorded in runbooks, not in env). Direct socket
  // address is the only key.
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
