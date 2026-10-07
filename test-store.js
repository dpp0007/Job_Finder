// Storage contract test: the same assertions run against whichever backend is selected.
//   node test-store.js                        -> SQLite (temp file)
//   STORE=firestore FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test-store.js   -> Firestore emulator (npm run test:firestore)
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const kind = process.env.STORE || (process.env.FIRESTORE_EMULATOR_HOST ? 'firestore' : 'sqlite');
process.env.STORE = kind;
if (kind === 'sqlite') process.env.SCOUT_DB = join(tmpdir(), `scout-test-${process.pid}.db`);
else process.env.FIRESTORE_PROJECT_ID = `demo-scout-${Date.now()}`;           // a fresh, empty project per run
process.chdir(tmpdir());                                                     // never read the project's real .env in a test

const { store, health } = await import(new URL('./lib/store.js', import.meta.url));
const { buildJob, PARSE_VERSION } = await import(new URL('./lib/parse.js', import.meta.url));
const long = 'We build products with React and Python. '.repeat(12);
let n = 0;
const mk = o => buildJob({ company: 'Acme', url: `https://x.test/job/${++n}`, desc: long, location: 'Delhi', ...o });

// ---- info + health ----
assert.equal((await store.info()).kind, kind);
assert.deepEqual(await health(), { ok: true });

// ---- key/value ----
assert.equal(await store.getKV('nope', 'dflt'), 'dflt');
await store.setKV('profile', { prefs: { roles: ['x'] }, resume: 'r' });
assert.deepEqual(await store.getKV('profile'), { prefs: { roles: ['x'] }, resume: 'r' });

// ---- jobs: insert, idempotent re-insert, merge ----
const a = mk({ title: 'Frontend Intern' }), b = mk({ title: 'Data Analyst' });
assert.equal(await store.upsertJobs([a, b]), 2, 'two new jobs');
assert.equal(await store.upsertJobs([a, b]), 0, 'same jobs again are not new');
const got = await store.getJob(a.id);
assert.equal(got.title, 'Frontend Intern'); assert.equal(typeof got.firstSeen, 'number');
assert.equal((await store.loadJobs()).length, 2);
await store.upsertJobs([{ ...a, sources: [{ name: 'other', url: 'https://other.test/a' }] }]);
assert.equal((await store.getJob(a.id)).sources.length, 2, 'a second source is merged, not duplicated');
assert.equal(await store.getJob('missing'), null);

// ---- jobs: the same page re-parsed under a new fingerprint replaces the stale row and keeps the tracker link ----
const stale = { ...mk({ title: 'Old Title', url: 'https://x.test/same-page' }), pv: PARSE_VERSION - 1 };
await store.upsertJobs([stale]);
await store.trackerSet(stale.id, 'saved', 'my note');
const better = mk({ title: 'Better Parsed Title', url: 'https://x.test/same-page' });
assert.notEqual(better.id, stale.id);
await store.upsertJobs([better]);
assert.equal(await store.getJob(stale.id), null, 'stale row replaced');
assert.equal((await store.getJob(better.id)).title, 'Better Parsed Title');
assert.equal((await store.trackerMap())[better.id]?.note, 'my note', 'tracker entry followed the job to its new id');
assert.equal((await store.trackerMap())[stale.id], undefined);

// ---- jobs: a job the model has read keeps its fields when a fresh scrape arrives ----
const c = mk({ title: 'AI Read Job' });
await store.upsertJobs([c]);
await store.saveJob({ ...(await store.getJob(c.id)), llm: { v: 1 }, summary: 'keep me' });
await store.upsertJobs([{ ...c, summary: undefined }]);
assert.equal((await store.getJob(c.id)).summary, 'keep me');

// ---- jobs: known URLs, junk, status ----
const thin = mk({ title: 'Thin Job', desc: 'short' });
await store.upsertJobs([thin]);
const known = await store.knownUrls(u => u);
assert.ok(known.has(a.url) && !known.has(thin.url), 'only described, current-parser jobs are known');
await store.markJunk(b.id);
assert.ok(!(await store.loadJobs()).some(j => j.id === b.id), 'junk is hidden');
assert.equal(await store.jobVerifiedAt(a.id), 0);
await store.setJobStatus(a.id, 'closed');
assert.ok(!(await store.loadJobs()).some(j => j.id === a.id), 'closed jobs are hidden');
assert.ok((await store.jobVerifiedAt(a.id)) > 0);
await store.setJobStatus(a.id, 'open');
assert.ok((await store.loadJobs()).some(j => j.id === a.id), 'reopened');

// ---- tracker ----
await store.trackerSet(a.id, 'saved');
assert.equal((await store.trackerMap())[a.id].note, '', 'new entry starts with an empty note');
await store.trackerSet(a.id, 'saved', 'hello');
await store.trackerSet(a.id, 'applied');                                       // no note given: keep the existing one
assert.equal((await store.trackerMap())[a.id].note, 'hello');
await store.trackerSet(c.id, 'hidden');
let list = await store.trackerList();
assert.ok(list.some(t => t.job_id === a.id && t.stage === 'applied' && t.job.title === 'Frontend Intern' && t.status === 'open'));
assert.ok(!list.some(t => t.job_id === c.id), 'hidden jobs are not listed');
assert.ok((await store.trackerMap())[c.id], 'but they are in the map used for ranking');
assert.ok((await store.trackerOpenIds()).includes(a.id));
await store.trackerRemove(a.id);
assert.equal((await store.trackerMap())[a.id], undefined);

// ---- saved searches (alerts) ----
const prefs = { roles: ['Designer'], locations: ['Delhi'] };
assert.equal(await store.hasSearchWithPrefs(prefs), false);
const sid = await store.addSearch({ name: 'Designer · Delhi', prefs });
assert.equal(typeof sid, 'number');
assert.equal(await store.hasSearchWithPrefs(prefs), true);
assert.deepEqual((await store.listSearches())[0].prefs, prefs);
assert.equal((await store.dueSearches(Date.now())).length, 0, 'just created: not due');
assert.equal((await store.dueSearches(Date.now() + 13 * 3600000)).length, 1, '12 h later: due');
await store.patchSearch(sid, { interval_h: 3 });
assert.equal((await store.listSearches())[0].interval_h, 3);
await store.finishSearchRun(sid, 3);
assert.equal(await store.alertsNewTotal(), 3);
await store.patchSearch(sid, { new_count: 0 });
assert.equal(await store.alertsNewTotal(), 0);
await store.patchSearch(sid, { auto: 0 });
assert.equal((await store.dueSearches(Date.now() + 99 * 3600000)).length, 0, 'switched off: never due');
await store.deleteSearch(sid);
assert.equal((await store.listSearches()).length, 0);

// ---- company watchlist ----
const cid = await store.addCompany({ name: 'Razorpay', careers_url: 'https://razorpay.com/careers', ats: 'greenhouse', slug: 'razorpay' });
assert.equal(typeof cid, 'number');
assert.equal((await store.getCompany(cid)).slug, 'razorpay');
await store.updateCompany(cid, { last_scan: 123, job_count: 7, note: '!blocked' });
const co = await store.getCompany(cid);
assert.deepEqual([co.last_scan, co.job_count, co.note, co.name], [123, 7, '!blocked', 'Razorpay']);
assert.equal((await store.listCompanies()).length, 1);
await store.deleteCompany(cid);
assert.equal(await store.getCompany(cid), null);

// ---- notifications ----
const n1 = await store.addNotification({ title: 'Real', body: 'b', jobs: [{ id: 'j', title: 'T' }] });
const n2 = await store.addNotification({ title: 'Demo', body: 'b', demo: true });
assert.ok(n2 > n1 && typeof n1 === 'number', 'ids are numeric and increasing');
let nl = await store.listNotifications();
assert.deepEqual(nl.items.map(i => i.title), ['Demo', 'Real'], 'newest first');
assert.equal(nl.unread, 2); assert.equal(nl.items[0].demo, true); assert.equal(nl.items[1].jobs[0].title, 'T');
await store.markNotificationsRead({ id: n1 });
assert.equal(await store.notificationsUnread(), 1);
await store.markNotificationsRead({ all: true });
nl = await store.listNotifications();
assert.equal(nl.unread, 0); assert.ok(nl.items.every(i => i.read));

// ---- persistence: for Firestore, drop every in-memory cache and read again from the database ----
if (kind === 'firestore') {
  globalThis.__scoutFs.cache.clear();
  assert.equal((await store.getJob(better.id)).title, 'Better Parsed Title', 'job survived a cold read');
  assert.equal((await store.getKV('profile')).resume, 'r', 'kv survived a cold read');
  assert.equal((await store.listNotifications()).items.length, 2, 'notifications survived a cold read');
}

try { if (kind === 'sqlite') for (const s of ['', '-wal', '-shm', '-journal']) rmSync(process.env.SCOUT_DB + s, { force: true }); } catch { /* temp file */ }
console.log(`store ok [${kind}]`);
process.exit(0);
