// Lightweight in-memory rate limiter (per key, sliding window). Suitable for a
// single-instance internal app. For multi-instance, back this with Redis/Postgres.
interface Bucket {
  hits: number[];
}
const KEY = "__artifex_ratelimit__";
function store(): Map<string, Bucket> {
  const g = globalThis as any;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const b = store().get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    const retryAfterMs = windowMs - (now - b.hits[0]);
    store().set(key, b);
    return { allowed: false, remaining: 0, retryAfterMs };
  }
  b.hits.push(now);
  store().set(key, b);
  return { allowed: true, remaining: limit - b.hits.length, retryAfterMs: 0 };
}

export function resetRateLimit(key: string): void {
  store().delete(key);
}
