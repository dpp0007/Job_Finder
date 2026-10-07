const { DatabaseSync } = process.getBuiltinModule('node:sqlite') ?? {}; // builtin lookup keeps bundlers out of it
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mergeJob } from './rank.js';
import { PARSE_VERSION } from './parse.js';

if (!DatabaseSync) throw new Error('Scout needs Node.js 22.13 or newer: it uses the built-in node:sqlite module.');

// Where the database lives. Locally: data/scout.db. Serverless hosts (Vercel, Lambda, Netlify) have a read-only project folder:
// only the temp directory is writable, and it is neither persistent nor shared between instances. Opening the database must
// never crash the app, so fall back to the temp directory and finally to memory, and report that storage is temporary.
export const SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
function openDb() {
  const tmp = join(tmpdir(), 'scout.db');
  const wanted = process.env.SCOUT_DB || (SERVERLESS ? tmp : 'data/scout.db'); // SCOUT_DB lets tests run against a copy
  for (const file of new Set([wanted, tmp])) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const d = new DatabaseSync(file);
      d.exec('PRAGMA busy_timeout = 10000'); // several Next workers and the scheduler share this file: wait for the lock instead of failing
      return { db: d, file, ephemeral: SERVERLESS || file !== wanted };
    } catch (e) { console.error(`database: cannot use ${file}: ${e.message}`); }
  }
  return { db: new DatabaseSync(':memory:'), file: ':memory:', ephemeral: true };
}
const { db, file: DB_FILE, ephemeral } = openDb();
export const storage = { file: DB_FILE, ephemeral };
db.exec(`
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, data TEXT, first_seen INT, last_seen INT, status TEXT DEFAULT 'open', last_verified INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS tracker(job_id TEXT PRIMARY KEY, stage TEXT, note TEXT DEFAULT '', updated INT);
CREATE TABLE IF NOT EXISTS searches(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, prefs TEXT, auto INT DEFAULT 1, interval_h INT DEFAULT 12, last_run INT DEFAULT 0, new_count INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, careers_url TEXT, ats TEXT, slug TEXT, last_scan INT DEFAULT 0, job_count INT DEFAULT 0, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, created INT, title TEXT, body TEXT, search_id INT, jobs TEXT, demo INT DEFAULT 0, is_read INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
`);

// url column: lets a re-parsed job replace the stale row for the same page even when its fingerprint changed.
// Migration only writes when something is missing, so concurrent workers do not fight over the lock.
if (!db.prepare('PRAGMA table_info(jobs)').all().some(c => c.name === 'url')) {
  try { db.exec('ALTER TABLE jobs ADD COLUMN url TEXT'); } catch { /* another worker added it first */ }
}
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='jobs_url'").get()) db.exec('CREATE INDEX IF NOT EXISTS jobs_url ON jobs(url)');
if (db.prepare('SELECT COUNT(*) n FROM jobs WHERE url IS NULL').get().n) {
  const todo = db.prepare('SELECT id, data FROM jobs WHERE url IS NULL').all();
  db.exec('BEGIN IMMEDIATE');
  try { for (const r of todo) { let u = ''; try { u = JSON.parse(r.data).url || ''; } catch { /* unreadable row */ } db.prepare('UPDATE jobs SET url=? WHERE id=?').run(u, r.id); } db.exec('COMMIT'); }
  catch { try { db.exec('ROLLBACK'); } catch { /* nothing to roll back */ } }
}

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export const getKV = (k, def = null) => { const r = get('SELECT value FROM kv WHERE key=?', k); return r ? JSON.parse(r.value) : def; };
export const setKV = (k, v) => run('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));

// Insert or merge; returns true when the job is new to the index.
export function upsertJob(job) {
  const now = Date.now();
  let row = get('SELECT data, first_seen FROM jobs WHERE id=?', job.id);
  if (!row) {
    const old = get('SELECT id, data, first_seen FROM jobs WHERE url=?', job.url); // same page stored under another fingerprint
    if (old) {
      const prev = JSON.parse(old.data);
      if (prev.pv !== PARSE_VERSION && !prev.llm) { // parsed by an older parser: replace it, keep first_seen and anything the user tracked
        run('UPDATE OR IGNORE tracker SET job_id=? WHERE job_id=?', job.id, old.id);
        run('DELETE FROM jobs WHERE id=?', old.id);
        run('INSERT INTO jobs(id,data,first_seen,last_seen,url) VALUES(?,?,?,?,?)', job.id, JSON.stringify({ ...job, firstSeen: old.first_seen }), old.first_seen, now, job.url);
        return false;
      }
      job = { ...job, id: old.id }; row = old; // current parse of the same page: merge into the existing row
    }
  }
  if (!row) {
    run('INSERT INTO jobs(id,data,first_seen,last_seen,url) VALUES(?,?,?,?,?)', job.id, JSON.stringify({ ...job, firstSeen: now }), now, now, job.url);
    return true;
  }
  const ex = { ...JSON.parse(row.data), firstSeen: row.first_seen };
  // A job the model has already read keeps its extracted fields; a fresh scrape only adds new sources.
  const merged = ex.llm ? { ...ex, sources: [...ex.sources, ...job.sources.filter(x => !ex.sources.some(e => e.url === x.url))] } : mergeJob(ex, job);
  run("UPDATE jobs SET data=?, last_seen=?, status='open' WHERE id=?", JSON.stringify(merged), now, job.id);
  return false;
}

export function loadJobs(sinceDays = 45) {
  return all("SELECT id,data,first_seen FROM jobs WHERE status='open' AND last_seen > ?", Date.now() - sinceDays * 864e5)
    .map(r => ({ ...JSON.parse(r.data), firstSeen: r.first_seen }))
    .filter(j => !/^((current |all |open )?(job )?(openings?|positions?|roles?|jobs?|vacancies)|careers?|home|apply)\W*\d*$|^\d[\d,]*\+?\s|\bjob vacancies\b/i.test(j.title.trim())); // legacy junk rows
}

export const getJob = id => { const r = get('SELECT data,first_seen FROM jobs WHERE id=?', id); return r && { ...JSON.parse(r.data), firstSeen: r.first_seen }; };

// Canonical URLs already indexed with a full description: repeat searches skip re-reading them.
export function knownUrls(canon) {
  const set = new Set();
  for (const r of all("SELECT data FROM jobs WHERE status='open'")) {
    const j = JSON.parse(r.data);
    if (j.hasDesc && j.pv === PARSE_VERSION) for (const s of j.sources) set.add(canon(s.url)); // older parses are re-read
  }
  return set;
}

export const saveJob = j => run('UPDATE jobs SET data=? WHERE id=?', JSON.stringify(j), j.id);
export const markJunk = id => run("UPDATE jobs SET status='junk' WHERE id=?", id);
