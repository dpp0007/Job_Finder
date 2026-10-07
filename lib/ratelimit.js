// Sliding-window rate limiter held in memory (one Node process). Enough for a single server behind a reverse proxy;
// behind several instances, also set limits at the proxy (see docs/DEPLOY.md).
const hits = (globalThis.__scoutHits ??= new Map());

// Records one hit for `key`. Returns { ok, retryAfter } where retryAfter is in seconds.
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return { ok: false, retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) }; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 20000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 3600e3) hits.delete(k);   // keep memory bounded
  return { ok: true, retryAfter: 0 };
}
