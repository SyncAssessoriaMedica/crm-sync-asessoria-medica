// In-memory sliding-window rate limiter.
// LIMITATION: state is per-process and resets on each serverless cold start.
// For persistent cross-instance limiting, replace the store with Upstash Redis
// or another shared store. This implementation is intentionally simple and
// provides basic flood protection against single-source abuse.

type WindowEntry = { count: number; resetAt: number };

const store = new Map<string, WindowEntry>();

// Prune expired entries periodically so the map doesn't grow unbounded.
// (Each serverless instance is short-lived, so this is mostly a safety net.)
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
let lastPruned = Date.now();

function maybePrune(now: number) {
  if (now - lastPruned < PRUNE_INTERVAL_MS) return;
  lastPruned = now;
  for (const [key, entry] of store.entries()) {
    if (now >= entry.resetAt) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Check whether a keyed caller is within the allowed rate.
 *
 * @param key       Unique identifier (e.g. "evolution:<ip>")
 * @param limit     Max requests per window
 * @param windowMs  Window duration in milliseconds
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  maybePrune(now);

  const existing = store.get(key);

  if (!existing || now >= existing.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterMs: 0 };
}

/**
 * Derive a rate-limit key from an incoming request.
 * Uses X-Forwarded-For (first hop) or X-Real-IP, falling back to "unknown".
 */
export function getRateLimitKey(
  request: { headers: { get: (header: string) => string | null } },
  prefix: string,
): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return `${prefix}:${ip}`;
}
