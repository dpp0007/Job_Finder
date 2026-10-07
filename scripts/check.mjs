// Setup check: `npm run check` (add `-- --ai` to also test Gemini; that one call costs a fraction of a cent).
// Verifies each key and the database with real calls and says exactly what to fix. Reads your .env like the app does.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..')); // so .env is found wherever you run it from
const { env } = await import('../lib/env.js');
const { friendly } = await import('../lib/http.js');

const rows = [];
const log = (ok, name, detail) => { rows.push({ ok, name, detail }); console.log(`${ok === true ? '  ✓' : ok === 'skip' ? '  –' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const withAi = process.argv.includes('--ai');

console.log('\nScout setup check\n');

// 1. which settings are present (names only, never values)
const names = ['TINYFISH_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'CRON_SECRET', 'GEMINI_API_KEY'];
console.log('Settings found: ' + names.map(n => `${n}=${env(n) ? 'set' : 'missing'}`).join('  ') + '\n');

// 2. TinyFish
try {
  if (!env('TINYFISH_API_KEY')) throw Object.assign(new Error('TINYFISH_API_KEY is not set'), { code: 'nokey' });
  const r = await fetch('https://api.search.tinyfish.ai?query=job', { headers: { 'X-API-Key': env('TINYFISH_API_KEY') }, signal: AbortSignal.timeout(20000) });
  if (r.status === 200) log(true, 'TinyFish key', 'Search answered');
  else log(false, 'TinyFish key', { 401: 'rejected. The key is wrong or expired: ' + friendly({ code: 'auth' }), 402: friendly({ code: 'credits' }), 429: 'rate limited; try again in a minute' }[r.status] || `HTTP ${r.status}`);
} catch (e) { log(false, 'TinyFish key', friendly(e)); }

// 3. storage
let kind = env('STORE') || (env('GOOGLE_SERVICE_ACCOUNT_JSON') ? 'firestore' : 'sqlite'); // best guess, shown if startup fails
try {
  const { store, health } = await import('../lib/store.js');
  const info = await store.info();
  kind = info.kind;
  const h = await health();
  if (!h.ok) throw h.error;
  const probe = { at: Date.now(), note: 'written by npm run check' };
  await store.setKV('__check', probe);
  const back = await store.getKV('__check');
  if (back?.at !== probe.at) throw new Error('wrote a test value but read back something else');
  log(true, `Storage: ${info.kind}${info.project ? ' (project ' + info.project + ')' : ''}`, info.kind === 'firestore' ? 'connected; wrote and read back a test value' : info.ephemeral ? 'working, but temporary on this host' : `working (${info.file})`);
} catch (e) {
  log(false, `Storage: ${kind}`, friendly(e));
}

// 4. scheduled alerts
log(env('CRON_SECRET') ? true : 'skip', 'Scheduled alerts', env('CRON_SECRET') ? 'CRON_SECRET is set, so /api/cron/tick can be called' : 'CRON_SECRET not set (only needed for Cloud Scheduler on Vercel)');

// 5. Gemini (opt-in: it is a paid call)
if (withAi) {
  try {
    const { extractPosting, llmEnabled } = await import('../lib/llm.js');
    if (!llmEnabled()) throw Object.assign(new Error('GEMINI_API_KEY is not set'), {});
    const x = await extractPosting({ title: 'UI/UX Design Intern', company: 'Acme', location: 'Delhi', url: 'https://example.com/job', desc: 'Design interfaces in Figma. Stipend ₹15,000 per month. Work from home. Visa sponsorship is not available. ' + 'Great team. '.repeat(20) });
    log(true, 'Gemini', `read a test posting: pay ${x.salary ? x.salary.min + '–' + x.salary.max : 'none'}, visa ${x.visa}`);
  } catch (e) { log(false, 'Gemini', e.message); }
} else log('skip', 'Gemini', 'not tested (run `npm run check -- --ai` to test it; costs a fraction of a cent)');

const failed = rows.filter(r => r.ok === false).length;
console.log(failed ? `\n${failed} problem${failed > 1 ? 's' : ''} to fix (see ✗ above).\n` : '\nAll good. Start the app with `npm run dev` and press Search live.\n');
process.exit(failed ? 1 : 0);
