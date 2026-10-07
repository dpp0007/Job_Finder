// SQLite backend (node:sqlite). The default for local use: one file, no setup, fully persistent on a machine with a disk.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') ?? {}; // builtin lookup keeps bundlers out of it
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isJunkTitle, isKnown, planUpsert } from './shared.js';

export function createSqliteStore() {
  if (!DatabaseSync) throw new Error('Scout needs Node.js 22.13 or newer: it uses the built-in node:sqlite module.');

  // Locally: data/scout.db. Serverless hosts have a read-only project folder: only the temp directory is writable, and it is
  // neither persistent nor shared. Opening the database must never crash the app, so fall back to temp, then to memory.
  const SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  const tmp = join(tmpdir(), 'scout.db');
  const wanted = process.env.SCOUT_DB || (SERVERLESS ? tmp : 'data/scout.db'); // SCOUT_DB lets tests run against a copy
  let db = null, file = ':memory:', ephemeral = true;
  for (const f of new Set([wanted, tmp])) {
    try {
      mkdirSync(dirname(f), { recursive: true });
      db = new DatabaseSync(f);
      db.exec('PRAGMA busy_timeout = 10000'); // several Next workers share this file: wait for the lock instead of failing
      file = f; ephemeral = SERVERLESS || f !== wanted;
      break;
    } catch (e) { console.error(`database: cannot use ${f}: ${e.message}`); }
  }
  if (!db) db = new DatabaseSync(':memory:');

  db.exec(`
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, data TEXT, first_seen INT, last_seen INT, status TEXT DEFAULT 'open', last_verified INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS tracker(job_id TEXT PRIMARY KEY, stage TEXT, note TEXT DEFAULT '', updated INT);
CREATE TABLE IF NOT EXISTS searches(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, prefs TEXT, auto INT DEFAULT 1, interval_h INT DEFAULT 12, last_run INT DEFAULT 0, new_count INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, careers_url TEXT, ats TEXT, slug TEXT, last_scan INT DEFAULT 0, job_count INT DEFAULT 0, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, created INT, title TEXT, body TEXT, search_id INT, jobs TEXT, demo INT DEFAULT 0, is_read INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
-- everything below belongs to one signed-in user (uid): no query may read or write another user's rows
CREATE TABLE IF NOT EXISTS users(uid TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT, created INT, last_login INT);
CREATE TABLE IF NOT EXISTS u_kv(uid TEXT, key TEXT, value TEXT, PRIMARY KEY(uid, key));
CREATE TABLE IF NOT EXISTS u_tracker(uid TEXT, job_id TEXT, stage TEXT, note TEXT DEFAULT '', updated INT, PRIMARY KEY(uid, job_id));
CREATE TABLE IF NOT EXISTS u_searches(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT, prefs TEXT, auto INT DEFAULT 1, interval_h INT DEFAULT 12, last_run INT DEFAULT 0, new_count INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS u_companies(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT, careers_url TEXT, ats TEXT, slug TEXT, last_scan INT DEFAULT 0, job_count INT DEFAULT 0, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS u_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, created INT, title TEXT, body TEXT, search_id INT, jobs TEXT, demo INT DEFAULT 0, is_read INT DEFAULT 0);
CREATE INDEX IF NOT EXISTS u_searches_uid ON u_searches(uid);
CREATE INDEX IF NOT EXISTS u_companies_uid ON u_companies(uid);
CREATE INDEX IF NOT EXISTS u_notifications_uid ON u_notifications(uid);
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

  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const rowOf = r => r ? { id: r.id, data: JSON.parse(r.data), first_seen: r.first_seen } : null;
  const search = r => ({ ...r, prefs: JSON.parse(r.prefs) });
  const job = r => r ? { ...JSON.parse(r.data), firstSeen: r.first_seen } : null;

  return {
    info: () => ({ kind: 'sqlite', ephemeral, file }),

    // ---- key/value (profile, search cache) ----
    async getKV(k, def = null) { const r = get('SELECT value FROM kv WHERE key=?', k); return r ? JSON.parse(r.value) : def; },
    async setKV(k, v) { run('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v)); },

    // ---- jobs ----
    // Inserts or merges each job; returns how many were new to the index.
    async upsertJobs(jobs) {
      const now = Date.now();
      let fresh = 0;
      for (const j of jobs) {
        const byId = rowOf(get('SELECT id, data, first_seen FROM jobs WHERE id=?', j.id));
        const byUrl = byId ? null : rowOf(get('SELECT id, data, first_seen FROM jobs WHERE url=?', j.url));
        const p = planUpsert(j, byId, byUrl, now);
        if (p.type === 'insert') { run('INSERT INTO jobs(id,data,first_seen,last_seen,url) VALUES(?,?,?,?,?)', p.id, JSON.stringify(p.data), p.first_seen, now, j.url); fresh++; }
        else if (p.type === 'replace') {
          run('UPDATE OR IGNORE u_tracker SET job_id=? WHERE job_id=?', p.id, p.oldId);
          run('DELETE FROM jobs WHERE id=?', p.oldId);
          run('INSERT INTO jobs(id,data,first_seen,last_seen,url) VALUES(?,?,?,?,?)', p.id, JSON.stringify(p.data), p.first_seen, now, j.url);
        } else run("UPDATE jobs SET data=?, last_seen=?, status='open' WHERE id=?", JSON.stringify(p.data), now, p.id);
      }
      return fresh;
    },
    async getJob(id) { return job(get('SELECT data,first_seen FROM jobs WHERE id=?', id)); },
    async loadJobs(sinceDays = 45) {
      return all("SELECT id,data,first_seen FROM jobs WHERE status='open' AND last_seen > ?", Date.now() - sinceDays * 864e5).map(job).filter(j => !isJunkTitle(j.title));
    },
    async knownUrls(canon) {
      const set = new Set();
      for (const r of all("SELECT data FROM jobs WHERE status='open'")) { const d = JSON.parse(r.data); if (isKnown(d)) for (const s of d.sources) set.add(canon(s.url)); }
      return set;
    },
    async saveJob(j) { run('UPDATE jobs SET data=? WHERE id=?', JSON.stringify(j), j.id); },
    async markJunk(id) { run("UPDATE jobs SET status='junk' WHERE id=?", id); },
    async setJobStatus(id, status) { run('UPDATE jobs SET status=?, last_verified=? WHERE id=?', status, Date.now(), id); },
    async jobVerifiedAt(id) { const r = get('SELECT last_verified FROM jobs WHERE id=?', id); return r ? r.last_verified : null; },

    // ---- users ----
    async upsertUser({ uid, email, name, picture }) {
      const now = Date.now();
      run('INSERT INTO users(uid,email,name,picture,created,last_login) VALUES(?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture, last_login=excluded.last_login', uid, email, name || '', picture || '', now, now);
    },
    async getUser(uid) { return get('SELECT * FROM users WHERE uid=?', uid) || null; },
    // Erases one person: resume, preferences, tracker, alerts, watchlist, notifications and the account record.
    async deleteUserData(uid) {
      for (const t of ['u_kv', 'u_tracker', 'u_searches', 'u_companies', 'u_notifications', 'users']) run(`DELETE FROM ${t} WHERE uid=?`, uid);
    },
    async listUsers() { return all('SELECT uid, email FROM users'); },

    // ---- per-user key/value (profile, resume, analysis cache) ----
    async getUserKV(uid, k, def = null) { const r = get('SELECT value FROM u_kv WHERE uid=? AND key=?', uid, k); return r ? JSON.parse(r.value) : def; },
    async setUserKV(uid, k, v) { run('INSERT INTO u_kv(uid,key,value) VALUES(?,?,?) ON CONFLICT(uid,key) DO UPDATE SET value=excluded.value', uid, k, JSON.stringify(v)); },

    // ---- tracker ----
    async trackerMap(uid) { return Object.fromEntries(all('SELECT job_id, stage, note FROM u_tracker WHERE uid=?', uid).map(r => [r.job_id, { stage: r.stage, note: r.note }])); },
    async trackerList(uid) {
      return all("SELECT t.job_id, t.stage, t.note, t.updated, j.status FROM u_tracker t LEFT JOIN jobs j ON j.id = t.job_id WHERE t.uid=? AND t.stage != 'hidden' ORDER BY t.updated DESC", uid)
        .map(t => ({ ...t, job: job(get('SELECT data,first_seen FROM jobs WHERE id=?', t.job_id)) })).filter(t => t.job);
    },
    // note: undefined/null keeps the existing note
    async trackerSet(uid, jobId, stage, note) {
      run('INSERT INTO u_tracker(uid,job_id,stage,note,updated) VALUES(?,?,?,?,?) ON CONFLICT(uid,job_id) DO UPDATE SET stage=excluded.stage, note=COALESCE(?, note), updated=excluded.updated', uid, jobId, stage, note ?? '', Date.now(), note ?? null);
    },
    async trackerRemove(uid, jobId) { run('DELETE FROM u_tracker WHERE uid=? AND job_id=?', uid, jobId); },
    async openTrackedJobIds() { return all("SELECT DISTINCT job_id FROM u_tracker WHERE stage IN ('saved','applied')").map(r => r.job_id); },

    // ---- saved searches (alerts) ----
    async listSearches(uid) { return all('SELECT * FROM u_searches WHERE uid=? ORDER BY id DESC', uid).map(search); },
    async hasSearchWithPrefs(uid, prefs) { return !!get('SELECT id FROM u_searches WHERE uid=? AND prefs=?', uid, JSON.stringify(prefs)); },
    async countSearches(uid) { return get('SELECT COUNT(*) n FROM u_searches WHERE uid=?', uid).n; },
    async addSearch(uid, { name, prefs }) { return Number(run('INSERT INTO u_searches(uid,name,prefs,last_run) VALUES(?,?,?,?)', uid, name, JSON.stringify(prefs), Date.now()).lastInsertRowid); },
    async patchSearch(uid, id, { auto, interval_h, new_count }) {
      run('UPDATE u_searches SET auto=COALESCE(?,auto), interval_h=COALESCE(?,interval_h), new_count=COALESCE(?,new_count) WHERE id=? AND uid=?', auto ?? null, interval_h ?? null, new_count ?? null, id, uid);
    },
    async deleteSearch(uid, id) { run('DELETE FROM u_searches WHERE id=? AND uid=?', id, uid); },
    async dueSearches(now) { return all('SELECT * FROM u_searches WHERE auto=1 AND ? - last_run > interval_h * 3600000', now).map(search); }, // every user's: each row carries its uid
    async finishSearchRun(uid, id, found = 0) { run('UPDATE u_searches SET last_run=?, new_count=new_count+? WHERE id=? AND uid=?', Date.now(), found, id, uid); },
    async alertsNewTotal(uid) { return get('SELECT SUM(new_count) n FROM u_searches WHERE uid=?', uid).n || 0; },

    // ---- company watchlist ----
    async listCompanies(uid) { return all('SELECT * FROM u_companies WHERE uid=? ORDER BY id DESC', uid); },
    async getCompany(uid, id) { return get('SELECT * FROM u_companies WHERE id=? AND uid=?', id, uid) || null; },
    async addCompany(uid, { name, careers_url, ats, slug }) { return Number(run('INSERT INTO u_companies(uid,name,careers_url,ats,slug) VALUES(?,?,?,?,?)', uid, name, careers_url, ats, slug).lastInsertRowid); },
    async deleteCompany(uid, id) { run('DELETE FROM u_companies WHERE id=? AND uid=?', id, uid); },
    async updateCompany(uid, id, { last_scan, job_count, note }) {
      run('UPDATE u_companies SET last_scan=COALESCE(?,last_scan), job_count=COALESCE(?,job_count), note=COALESCE(?,note) WHERE id=? AND uid=?', last_scan ?? null, job_count ?? null, note ?? null, id, uid);
    },

    // ---- notifications ----
    async addNotification(uid, { title, body, searchId = null, jobs = [], demo = false }) {
      return Number(run('INSERT INTO u_notifications(uid,created,title,body,search_id,jobs,demo) VALUES(?,?,?,?,?,?,?)', uid, Date.now(), title, body, searchId, JSON.stringify(jobs), demo ? 1 : 0).lastInsertRowid);
    },
    async listNotifications(uid) {
      const items = all('SELECT * FROM u_notifications WHERE uid=? ORDER BY id DESC LIMIT 30', uid).map(n => ({ id: n.id, created: n.created, title: n.title, body: n.body, searchId: n.search_id, jobs: JSON.parse(n.jobs || '[]'), demo: !!n.demo, read: !!n.is_read }));
      return { items, unread: get('SELECT COUNT(*) n FROM u_notifications WHERE uid=? AND is_read=0', uid).n };
    },
    async notificationsUnread(uid) { return get('SELECT COUNT(*) n FROM u_notifications WHERE uid=? AND is_read=0', uid).n; },
    async markNotificationsRead(uid, { id, all: everything }) { if (everything) run('UPDATE u_notifications SET is_read=1 WHERE uid=?', uid); else run('UPDATE u_notifications SET is_read=1 WHERE id=? AND uid=?', id, uid); },
  };
}
