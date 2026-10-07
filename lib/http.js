// Route-handler helpers.
export function friendly(e) {
  if (e.code === 'nokey') return 'TinyFish isn’t configured on the server. Add TINYFISH_API_KEY to .env and restart.';
  if (e.code === 'auth') return 'TinyFish rejected the server’s API key. Check TINYFISH_API_KEY in .env and restart.';
  if (e.code === 'credits') return 'TinyFish credits are used up. Top up your wallet, then retry.';
  if (e.code === 'rate') return 'TinyFish rate limit reached. Wait a minute, then retry.';
  if (/fetch failed|timeout|aborted|ENOTFOUND|ECONN/i.test(e.message)) return 'Couldn’t reach TinyFish. Check your connection and retry.';
  return e.message;
}
export const json = (o, status = 200) => Response.json(o, { status });

// Wrap a handler so thrown errors become JSON {error} with the right status.
export const handler = fn => async (req, ctx) => {
  try { return await fn(req, ctx); } catch (e) { return json({ error: friendly(e), code: e.code }, e.status || 500); }
};

// NDJSON stream: fn(emit) runs while the client reads progress events.
export const ndjson = fn => new Response(new ReadableStream({
  async start(c) {
    const enc = new TextEncoder();
    const emit = e => { try { c.enqueue(enc.encode(JSON.stringify(e) + '\n')); } catch { /* client went away */ } };
    try { await fn(emit); } catch (e) { emit({ type: 'error', message: friendly(e), code: e.code }); }
    try { c.close(); } catch { /* already closed */ }
  },
}), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform' } });
