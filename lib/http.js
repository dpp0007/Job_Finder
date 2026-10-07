// Route-handler helpers. Every API route goes through handler(): it signs the request in, blocks cross-site requests,
// rate-limits, hides internal error details and keeps responses out of shared caches.
import { assertSameOrigin, clientIp, requireUser } from './auth.js';
import { rateLimit } from './ratelimit.js';

export function friendly(e) {
  const c = e?.code;
  if (c === 'nokey') return 'TinyFish isn’t configured on the server. Add TINYFISH_API_KEY to .env and restart.';
  if (c === 'auth') return 'TinyFish rejected the server’s API key. Check TINYFISH_API_KEY in .env and restart.';
  if (c === 'credits') return 'TinyFish credits are used up. Top up your wallet, then retry.';
  if (c === 'rate') return 'TinyFish rate limit reached. Wait a minute, then retry.';
  // Google Firestore reports gRPC status codes as numbers
  if (c === 5) return 'Firestore database not found. In Google Cloud, create a Firestore database (Native mode) for this project.';
  if (c === 7) return 'Google rejected the Firestore credentials. Give the service account the “Cloud Datastore User” role and enable the Firestore API.';
  if (c === 8) return 'The Firestore free daily quota is used up. It resets at midnight Pacific time.';
  if (c === 16) return 'Google could not authenticate the service account. Check GOOGLE_SERVICE_ACCOUNT_JSON.';
  if (/fetch failed|timeout|aborted|ENOTFOUND|ECONN/i.test(e?.message || '')) return 'Couldn’t reach TinyFish. Check your connection and retry.';
  return e?.message || 'Something went wrong.';
}

// What the browser may be told. Messages Scout wrote itself (marked `expose` or a 4xx) pass; anything else from deep inside
// a library is logged on the server and replaced, so file paths, queries and stack details never leave it.
export function publicMessage(e) {
  const status = e?.status || 500, msg = friendly(e);
  if (e?.expose || status < 500 || msg !== e?.message) return msg;
  console.error('server error:', e?.stack || e);
  return 'Something went wrong on the server. Please try again.';
}

export const json = (o, status = 200, headers = {}) => Response.json(o, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

// A request body as JSON, capped so a huge upload cannot exhaust memory.
export async function readJson(req, max = 64 * 1024) {
  if (Number(req.headers.get('content-length')) > max) throw Object.assign(new Error('That request is too large.'), { status: 413, expose: true });
  const text = await req.text();
  if (text.length > max) throw Object.assign(new Error('That request is too large.'), { status: 413, expose: true });
  try { const v = text ? JSON.parse(text) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch { throw Object.assign(new Error('That request was not valid JSON.'), { status: 400, expose: true }); }
}

// opts: public (no sign-in needed), limit: [name, max, windowMs] extra per-user limit for expensive routes, admin: admins only.
export const handler = (fn, opts = {}) => async (req, ctx) => {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    let user = null;
    if (!opts.public) {
      const ipLimit = rateLimit('ip:' + ip, 600, 60_000);
      if (!ipLimit.ok) return json({ error: 'Too many requests. Slow down and try again shortly.' }, 429, { 'Retry-After': String(ipLimit.retryAfter) });
      user = requireUser(req);
      if (opts.admin && !user.admin) return json({ error: 'Not allowed.' }, 403);
      const general = rateLimit('u:' + user.uid, 300, 60_000);
      if (!general.ok) return json({ error: 'Too many requests. Slow down and try again shortly.' }, 429, { 'Retry-After': String(general.retryAfter) });
      if (opts.limit) {
        const [name, max, windowMs] = opts.limit;
        const l = rateLimit(`${name}:${user.uid}`, max, windowMs);
        if (!l.ok) return json({ error: `You’re doing that too often. Try again in ${l.retryAfter > 90 ? Math.ceil(l.retryAfter / 60) + ' minutes' : l.retryAfter + ' seconds'}.` }, 429, { 'Retry-After': String(l.retryAfter) });
      }
    } else if (opts.limit) {
      const [name, max, windowMs] = opts.limit;
      const l = rateLimit(`${name}:${ip}`, max, windowMs);
      if (!l.ok) return json({ error: 'Too many attempts. Try again later.' }, 429, { 'Retry-After': String(l.retryAfter) });
    }
    return await fn(req, { ...ctx, user, ip });
  } catch (e) { return json({ error: publicMessage(e), code: e.expose || e.status < 500 ? e.code : undefined }, e.status || 500); }
};

// NDJSON stream: fn(emit) runs while the client reads progress events.
export const ndjson = fn => new Response(new ReadableStream({
  async start(c) {
    const enc = new TextEncoder();
    const emit = e => { try { c.enqueue(enc.encode(JSON.stringify(e) + '\n')); } catch { /* client went away */ } };
    try { await fn(emit); } catch (e) { emit({ type: 'error', message: publicMessage(e), code: e.code }); }
    try { c.close(); } catch { /* already closed */ }
  },
}), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff' } });
