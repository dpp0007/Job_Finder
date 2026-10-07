// Route-handler helpers.
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
