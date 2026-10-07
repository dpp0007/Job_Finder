// Thin TinyFish client: Search, Fetch, Agent. Throttled to the documented rate limits.
const sleep = ms => new Promise(r => setTimeout(r, ms));
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
// .env wins over a stale system-level variable (process.loadEnvFile and Next never override existing env).
const envFileKey = () => { try { return parseEnv(readFileSync('.env', 'utf8')).TINYFISH_API_KEY?.trim(); } catch { return undefined; } };
export const cfg = { key: () => envFileKey() || process.env.TINYFISH_API_KEY };
// globalThis: Next bundles each route separately; counters and throttle must be shared.
export const usage = (globalThis.__tfUsage ??= { search: 0, fetch: 0, agent: 0 });

const nextAt = (globalThis.__tfNext ??= {});
async function gate(k, ms) {
  const t = Math.max(Date.now(), nextAt[k] || 0);
  nextAt[k] = t + ms;
  if (t > Date.now()) await sleep(t - Date.now());
}

async function call(url, { method = 'GET', body, timeout = 30000, gateKey, gateMs } = {}) {
  const key = cfg.key();
  if (!key) throw Object.assign(new Error('No TinyFish API key configured'), { status: 401, code: 'nokey' });
  for (let i = 0; ; i++) {
    if (gateKey) await gate(gateKey, gateMs);
    const res = await fetch(url, {
      method, signal: AbortSignal.timeout(timeout),
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && i < 3) { await sleep(4000 * (i + 1)); continue; }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      const msg = json.error?.message || json.error || json.message || text;
      throw Object.assign(new Error(`TinyFish ${res.status}: ${String(msg).slice(0, 200)}`), { status: res.status, code: { 401: 'auth', 402: 'credits', 429: 'rate' }[res.status] });
    }
    return json;
  }
}

// Search API: ranked web results. Free tier, 30 req/min.
export async function search(params) {
  usage.search++;
  const u = new URL('https://api.search.tinyfish.ai');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== null) u.searchParams.set(k, Array.isArray(v) ? v.join(',') : v);
  const j = await call(u, { timeout: 20000, gateKey: 's', gateMs: 2100 });
  return j.results || [];
}

// Fetch API: renders pages in a real browser, up to 10 URLs per request.
export async function fetchUrls(urls, opts = {}) {
  const results = [], errors = [];
  for (let i = 0; i < urls.length; i += 10) {
    const chunk = urls.slice(i, i + 10);
    usage.fetch += chunk.length;
    try {
      const j = await call('https://api.fetch.tinyfish.ai', {
        method: 'POST', timeout: 150000, gateKey: 'f', gateMs: 420 * chunk.length, // 150 URLs/min, charged per URL
        body: { urls: chunk, format: 'markdown', links: true, ttl: 3600, per_url_timeout_ms: 30000, ...opts }, // a slow page fails fast instead of stalling the batch
      });
      results.push(...(j.results || (Array.isArray(j) ? j : [])));
      errors.push(...(j.errors || []));
    } catch (e) {
      if (e.status === 401 || e.status === 402) throw e;
      chunk.forEach(url => errors.push({ url, error: e.message }));
    }
  }
  return { results, errors };
}

// Agent API: natural-language goal on a live site, structured output. Async run + poll.
export async function agent({ url, goal, output_schema, stealth = false }, maxMs = 150000) {
  usage.agent++;
  const { run_id, error } = await call('https://agent.tinyfish.ai/v1/automation/run-async', {
    method: 'POST', timeout: 30000,
    body: { url, goal, output_schema, browser_profile: stealth ? 'stealth' : 'lite' },
  });
  if (!run_id) throw new Error(`Agent did not start: ${JSON.stringify(error)}`);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(3000);
    const r = await call(`https://agent.tinyfish.ai/v1/runs/${run_id}`, { timeout: 20000 });
    if (r.status === 'COMPLETED') {
      let out = r.result ?? r.result_json;
      if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* keep string */ } }
      return out;
    }
    if (r.status === 'FAILED' || r.status === 'CANCELLED') throw new Error(`Agent ${r.status}: ${r.error?.message || r.error || ''}`);
  }
  throw new Error('Agent timed out');
}
