// Runs the real discovery pipeline against a simulated TinyFish (no network, no keys), on whichever storage backend is selected.
//   node test-discover.js                       -> SQLite (temp file)
//   npm run test:firestore                      -> Firestore emulator
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const kind = process.env.STORE || (process.env.FIRESTORE_EMULATOR_HOST ? 'firestore' : 'sqlite');
process.env.STORE = kind;
if (kind === 'sqlite') process.env.SCOUT_DB = join(tmpdir(), `scout-disc-${process.pid}.db`);
else process.env.FIRESTORE_PROJECT_ID = `demo-scout-d${Date.now()}`;
process.env.TINYFISH_API_KEY = 'test-key';
delete process.env.GEMINI_API_KEY;
process.chdir(tmpdir());                                   // never read the project's real .env

// ---- a fake TinyFish and a fake Greenhouse board ----
const calls = { search: 0, fetch: [], other: [] };
const description = 'Back to jobs\n\n# Frontend Developer\n\nRemote - India\n\n### About the Role\n\nYou will build interfaces with React and Next.js. ' + 'We value craft and care. '.repeat(30) + '\n\n* Build features end to end\n* Work with design\n\nVisa sponsorship is not available.';
const pageFor = url => {
  if (url === 'https://boards-api.greenhouse.io/v1/boards/acme/jobs') {
    const body = { jobs: [
      { title: 'Frontend Developer', location: { name: 'Remote - India' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/101', first_published: new Date().toISOString() },
      { title: 'Senior Backend Engineer', location: { name: 'Berlin' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/102', first_published: new Date().toISOString() },
    ] };
    // TinyFish renders markdown, which backslash-escapes underscores: absolute\_url
    return { url, final_url: url, title: '', text: JSON.stringify(body).replace(/_/g, '\\_') };
  }
  if (url === 'https://boards-api.greenhouse.io/v1/boards/acme') return { url, final_url: url, title: '', text: '{"name":"Acme Corp"}' };
  if (url.startsWith('https://boards.greenhouse.io/acme/jobs/')) return { url, final_url: url, title: 'Job Application for Frontend Developer at Acme Corp', text: description, links: [], published_date: new Date().toISOString() };
  return null;
};
globalThis.fetch = async (input, opts = {}) => {
  const u = String(input instanceof URL ? input.href : input);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://api.search.tinyfish.ai')) {
    calls.search++;
    return json({ results: [{ position: 1, site_name: 'greenhouse', title: 'Frontend Developer at Acme Corp', snippet: 'React', url: 'https://boards.greenhouse.io/acme/jobs/101' }] });
  }
  if (u.startsWith('https://api.fetch.tinyfish.ai')) {
    const urls = JSON.parse(opts.body).urls;
    calls.fetch.push(...urls);
    return json({ results: urls.map(pageFor).filter(Boolean), errors: urls.filter(x => !pageFor(x)).map(url => ({ url, error: 'page_not_found' })) });
  }
  calls.other.push(u);
  throw new Error('unexpected network call: ' + u);
};

const { store } = await import(new URL('./lib/store.js', import.meta.url));
const { discover } = await import(new URL('./lib/discover.js', import.meta.url));
const { ranked } = await import(new URL('./lib/service.js', import.meta.url));

const prefs = { roles: ['Frontend Developer'], locations: [], workMode: 'any', seniority: [], types: [], keywords: [], must: [], exclude: [], visa: 'any', minSalary: 0, postedWithin: 0, portals: ['greenhouse'], depth: 'quick' };

// ---- first run: search → board expansion → posting read → stored ----
const events = [];
const out = await discover(prefs, { emit: e => events.push(e) });
assert.deepEqual(out.issues, [], 'no problems reported');
assert.ok(out.stats.boards >= 1, 'the company board was expanded');
assert.ok(events.some(e => e.type === 'batch'), 'batches were announced');

const jobs = await store.loadJobs();
const fe = jobs.find(j => j.title === 'Frontend Developer');
assert.ok(fe, 'the matching job was stored');
assert.equal(fe.company, 'Acme Corp', 'company name came from the board API (escaped JSON was parsed)');
assert.equal(fe.workMode, 'remote'); assert.equal(fe.visa, 'no'); assert.ok(fe.hasDesc, 'description was read');
assert.ok(!jobs.some(j => /Backend/.test(j.title)), 'a different role is filtered out before it is read');
const searchesAfterFirst = calls.search;
assert.ok(searchesAfterFirst >= 1);

// ---- ranking works on what was stored ----
const r = await ranked({ ...prefs, workMode: 'remote' }, '');
assert.ok(r.results.some(j => j.title === 'Frontend Developer' && j.score > 0), 'ranked result');

// ---- second run: the search is cached and the posting is already known, so nothing is fetched again ----
const fetchedBefore = calls.fetch.filter(u => u.startsWith('https://boards.greenhouse.io/acme/jobs/101')).length;
await discover(prefs, { emit: () => {} });
assert.equal(calls.search, searchesAfterFirst, 'search results were served from the local cache');
assert.equal((await store.loadJobs()).filter(j => j.title === 'Frontend Developer').length, 1, 'no duplicate job');
assert.deepEqual(calls.other, [], 'no unexpected network calls');

try { if (kind === 'sqlite') for (const s of ['', '-wal', '-shm', '-journal']) rmSync(process.env.SCOUT_DB + s, { force: true }); } catch { /* the OS still holds the temp file; it is deleted with the temp folder */ }
console.log(`discover ok [${kind}] — ${out.stats.found} parsed, ${out.stats.boardJobs} board listings, ${calls.search} searches, ${calls.fetch.length} pages fetched`);
process.exit(0);
