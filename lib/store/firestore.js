// Google Firestore backend: permanent, shared storage that works on serverless hosts such as Vercel.
//
// Firestore's free tier allows 50,000 reads/day, and Scout re-ranks its whole job index whenever a filter changes, so the
// design is read-frugal: the job index is loaded once and cached in memory (60 s), writes go through the cache, counters
// (unread notifications, new-alert total) are cached for 10 s, and no query needs a composite index.
import { env } from '../env.js';
import { isJunkTitle, isKnown, newId, planUpsert } from './shared.js';

const TTL = { jobs: 60_000, small: 20_000, counters: 10_000 };

// Pasted key files often pick up a trailing comma before the closing brace; tolerate that one mistake.
function parseKey(text) {
  try { return JSON.parse(text); } catch (first) {
    try { return JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')); } catch { throw first; }
  }
}

function clientConfig() {
  if (process.env.FIRESTORE_EMULATOR_HOST) return { projectId: env('FIRESTORE_PROJECT_ID') || 'demo-scout' }; // the SDK talks to the emulator by itself
  let raw = env('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('Firestore needs GOOGLE_SERVICE_ACCOUNT_JSON (a Google Cloud service-account key).');
  if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8'); // also accept the key as base64
  let sa;
  try { sa = parseKey(raw); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole key file on one line, or its base64.'); }
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.');
  return { projectId: env('FIRESTORE_PROJECT_ID') || sa.project_id, credentials: { client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, '\n') } };
}

export async function createFirestoreStore() {
  const { Firestore, FieldValue } = await import('@google-cloud/firestore');
  // Next bundles each route separately: keep the client and every cache on globalThis so they are shared and invalidated together.
  const S = (globalThis.__scoutFs ??= { db: null, cache: new Map() });
  const cfg = clientConfig();
  S.db ??= new Firestore({ ...cfg, ignoreUndefinedProperties: true });
  const db = S.db;
  const col = n => db.collection(n);

  const cached = (key, ttl, loader) => {
    const c = S.cache.get(key);
    if (c && Date.now() - c.at < ttl) return c.p;
    const p = loader();
    S.cache.set(key, { at: Date.now(), p });
    p.catch(() => S.cache.delete(key)); // never cache a failure
    return p;
  };
  const bust = (...keys) => keys.forEach(k => S.cache.delete(k));
  const ignoreMissing = e => { if (e?.code !== 5) throw e; }; // update() on a document that does not exist: nothing to do

  // ---------- jobs: whole index cached as a Map ----------
  const rowFromDoc = d => { const x = d.data(); return { id: d.id, data: JSON.parse(x.data), first_seen: x.first_seen, last_seen: x.last_seen, status: x.status, last_verified: x.last_verified || 0, url: x.url || '' }; };
  const toDoc = r => ({ data: JSON.stringify(r.data), first_seen: r.first_seen, last_seen: r.last_seen, status: r.status, last_verified: r.last_verified || 0, url: r.url || '' });
  const jobRows = () => cached('jobs', TTL.jobs, async () => {
    const m = new Map();
    for (const d of (await col('jobs').get()).docs) { try { const r = rowFromDoc(d); m.set(r.id, r); } catch { /* skip an unreadable document */ } }
    return m;
  });
  const asJob = r => ({ ...r.data, firstSeen: r.first_seen });
  const commitOps = async ops => {
    for (let i = 0; i < ops.length; i += 400) { // a Firestore batch holds at most 500 writes
      const batch = db.batch();
      for (const [op, a] of ops.slice(i, i + 400)) { if (op === 'set') batch.set(col('jobs').doc(a.id), toDoc(a)); else batch.delete(col('jobs').doc(a)); }
      await batch.commit();
    }
  };

  // ---------- per-user data lives under users/{uid}/…: a path can never reach another user's documents ----------
  const UID = /^u_[a-f0-9]{24}$/;
  const ucol = (uid, n) => { if (!UID.test(uid || '')) throw Object.assign(new Error('Invalid user'), { status: 401 }); return db.collection('users').doc(uid).collection(n); };
  const listUsers = () => cached('users', TTL.small, async () => (await col('users').get()).docs.map(d => ({ uid: d.id, email: d.data().email })));
  const trackerRows = uid => cached(uid + ':tracker', TTL.small, async () => {
    const m = new Map();
    for (const d of (await ucol(uid, 'tracker').get()).docs) m.set(d.id, d.data());
    return m;
  });
  const searchRows = uid => cached(uid + ':searches', TTL.small, async () => (await ucol(uid, 'searches').get()).docs
    .map(d => { const x = d.data(); return { id: Number(d.id), uid, name: x.name, prefs: JSON.parse(x.prefs), auto: x.auto, interval_h: x.interval_h, last_run: x.last_run, new_count: x.new_count || 0 }; })
    .sort((a, b) => b.id - a.id));
  const companyRows = uid => cached(uid + ':companies', TTL.small, async () => (await ucol(uid, 'companies').get()).docs
    .map(d => ({ id: Number(d.id), ...d.data() })).sort((a, b) => b.id - a.id));
  const kvDoc = (uid, k) => ucol(uid, 'kv').doc(encodeURIComponent(k));   // keys may contain ":" etc.

  return {
    info: () => ({ kind: 'firestore', ephemeral: false, project: cfg.projectId }),

    // ---- key/value ----
    async getKV(k, def = null) {
      const v = await cached('kv:' + k, TTL.small, async () => { const d = await col('kv').doc(k).get(); return d.exists ? { v: JSON.parse(d.data().value) } : null; });
      return v ? v.v : def;
    },
    async setKV(k, v) {
      await col('kv').doc(k).set({ value: JSON.stringify(v) });
      S.cache.set('kv:' + k, { at: Date.now(), p: Promise.resolve({ v }) }); // write-through
    },

    // ---- jobs ----
    async upsertJobs(jobs) {
      const rows = await jobRows(), now = Date.now();
      const byUrl = new Map();
      for (const r of rows.values()) if (r.url) byUrl.set(r.url, r);
      const ops = [], repoint = [];
      let fresh = 0;
      for (const j of jobs) {
        const byId = rows.get(j.id) || null;
        const p = planUpsert(j, byId, byId ? null : byUrl.get(j.url) || null, now);
        if (p.type === 'merge') {
          const r = rows.get(p.id); r.data = p.data; r.last_seen = now; r.status = 'open';
          ops.push(['set', r]);
        } else {
          if (p.type === 'replace') {
            const old = rows.get(p.oldId); rows.delete(p.oldId); if (old?.url) byUrl.delete(old.url);
            ops.push(['delete', p.oldId]); repoint.push([p.oldId, p.id]);
          } else fresh++;
          const r = { id: p.id, data: p.data, first_seen: p.first_seen, last_seen: now, status: 'open', last_verified: 0, url: j.url };
          rows.set(r.id, r); byUrl.set(j.url, r);
          ops.push(['set', r]);
        }
      }
      await commitOps(ops);
      if (repoint.length) { // keep every user's tracker entries attached to a job that was re-parsed under a new id
        for (const { uid } of await listUsers()) {
          const t = await trackerRows(uid);
          for (const [from, to] of repoint) {
            if (!t.has(from)) continue;
            const v = t.get(from);
            await ucol(uid, 'tracker').doc(to).set(v); await ucol(uid, 'tracker').doc(from).delete();
            t.set(to, v); t.delete(from);
          }
        }
      }
      return fresh;
    },
    async getJob(id) {
      const rows = await jobRows();
      let r = rows.get(id);
      if (!r) { const d = await col('jobs').doc(id).get(); if (d.exists) { r = rowFromDoc(d); rows.set(id, r); } }
      return r ? asJob(r) : null;
    },
    async loadJobs(sinceDays = 45) {
      const cutoff = Date.now() - sinceDays * 864e5;
      return [...(await jobRows()).values()].filter(r => r.status === 'open' && r.last_seen > cutoff && !isJunkTitle(r.data.title)).map(asJob);
    },
    async knownUrls(canon) {
      const set = new Set();
      for (const r of (await jobRows()).values()) if (r.status === 'open' && isKnown(r.data)) for (const s of r.data.sources) set.add(canon(s.url));
      return set;
    },
    async saveJob(j) {
      const r = (await jobRows()).get(j.id);
      if (r) r.data = j;
      await col('jobs').doc(j.id).update({ data: JSON.stringify(j) }).catch(ignoreMissing);
    },
    async markJunk(id) {
      const r = (await jobRows()).get(id); if (r) r.status = 'junk';
      await col('jobs').doc(id).update({ status: 'junk' }).catch(ignoreMissing);
    },
    async setJobStatus(id, status) {
      const now = Date.now(), r = (await jobRows()).get(id);
      if (r) { r.status = status; r.last_verified = now; }
      await col('jobs').doc(id).update({ status, last_verified: now }).catch(ignoreMissing);
    },
    async jobVerifiedAt(id) { const r = (await jobRows()).get(id); return r ? r.last_verified : null; },

    // ---- users ----
    async upsertUser({ uid, email, name, picture }) {
      if (!UID.test(uid)) throw new Error('Invalid user');
      const ref = col('users').doc(uid), now = Date.now(), d = await ref.get();
      await ref.set({ email, name: name || '', picture: picture || '', created: d.exists ? d.data().created : now, last_login: now });
      bust('users');
    },
    async getUser(uid) { if (!UID.test(uid || '')) return null; const d = await col('users').doc(uid).get(); return d.exists ? { uid, ...d.data() } : null; },
    listUsers,
    // Erases one person: everything under users/{uid} (resume, preferences, tracker, alerts, watchlist, notifications) and the account record.
    async deleteUserData(uid) {
      if (!UID.test(uid || '')) throw new Error('Invalid user');
      await db.recursiveDelete(col('users').doc(uid));
      for (const k of [...S.cache.keys()]) if (k === 'users' || k.startsWith(uid + ':')) S.cache.delete(k);
    },

    // ---- per-user key/value (profile, resume, analysis cache) ----
    async getUserKV(uid, k, def = null) {
      const v = await cached(`${uid}:kv:${k}`, TTL.small, async () => { const d = await kvDoc(uid, k).get(); return d.exists ? { v: JSON.parse(d.data().value) } : null; });
      return v ? v.v : def;
    },
    async setUserKV(uid, k, v) {
      await kvDoc(uid, k).set({ value: JSON.stringify(v) });
      S.cache.set(`${uid}:kv:${k}`, { at: Date.now(), p: Promise.resolve({ v }) }); // write-through
    },

    // ---- tracker ----
    async trackerMap(uid) { return Object.fromEntries([...(await trackerRows(uid))].map(([id, t]) => [id, { stage: t.stage, note: t.note }])); },
    async trackerList(uid) {
      const [t, rows] = await Promise.all([trackerRows(uid), jobRows()]);
      return [...t].filter(([, v]) => v.stage !== 'hidden')
        .map(([job_id, v]) => { const r = rows.get(job_id); return r && { job_id, stage: v.stage, note: v.note, updated: v.updated, status: r.status, job: asJob(r) }; })
        .filter(Boolean).sort((a, b) => b.updated - a.updated);
    },
    async trackerSet(uid, jobId, stage, note) { // note: undefined/null keeps the existing note
      const t = await trackerRows(uid);
      const v = { stage, note: note ?? t.get(jobId)?.note ?? '', updated: Date.now() };
      t.set(jobId, v);
      await ucol(uid, 'tracker').doc(jobId).set(v);
    },
    async trackerRemove(uid, jobId) { (await trackerRows(uid)).delete(jobId); await ucol(uid, 'tracker').doc(jobId).delete(); },
    async openTrackedJobIds() {
      const ids = new Set();
      for (const { uid } of await listUsers()) for (const [id, v] of await trackerRows(uid)) if (v.stage === 'saved' || v.stage === 'applied') ids.add(id);
      return [...ids];
    },

    // ---- saved searches (alerts) ----
    async listSearches(uid) { return searchRows(uid); },
    async hasSearchWithPrefs(uid, prefs) { const s = JSON.stringify(prefs); return (await searchRows(uid)).some(r => JSON.stringify(r.prefs) === s); },
    async countSearches(uid) { return (await searchRows(uid)).length; },
    async addSearch(uid, { name, prefs }) {
      const id = newId();
      await ucol(uid, 'searches').doc(String(id)).set({ name, prefs: JSON.stringify(prefs), auto: 1, interval_h: 12, last_run: Date.now(), new_count: 0 });
      bust(uid + ':searches'); return id;
    },
    async patchSearch(uid, id, { auto, interval_h, new_count }) {
      const f = {};
      if (auto != null) f.auto = auto;
      if (interval_h != null) f.interval_h = interval_h;
      if (new_count != null) f.new_count = new_count;
      if (Object.keys(f).length) await ucol(uid, 'searches').doc(String(id)).update(f).catch(ignoreMissing);
      bust(uid + ':searches');
    },
    async deleteSearch(uid, id) { await ucol(uid, 'searches').doc(String(id)).delete(); bust(uid + ':searches'); },
    async dueSearches(now) { // every user's due searches: each row carries its uid
      const out = [];
      for (const { uid } of await listUsers()) out.push(...(await searchRows(uid)).filter(s => s.auto && now - s.last_run > s.interval_h * 3600000));
      return out;
    },
    async finishSearchRun(uid, id, found = 0) {
      await ucol(uid, 'searches').doc(String(id)).update({ last_run: Date.now(), new_count: FieldValue.increment(found) }).catch(ignoreMissing);
      bust(uid + ':searches');
    },
    async alertsNewTotal(uid) { return (await searchRows(uid)).reduce((n, s) => n + (s.new_count || 0), 0); },

    // ---- company watchlist ----
    async listCompanies(uid) { return companyRows(uid); },
    async getCompany(uid, id) { return (await companyRows(uid)).find(c => c.id === Number(id)) || null; },
    async addCompany(uid, { name, careers_url, ats, slug }) {
      const id = newId();
      await ucol(uid, 'companies').doc(String(id)).set({ name, careers_url, ats: ats ?? null, slug: slug ?? null, last_scan: 0, job_count: 0, note: '' });
      bust(uid + ':companies'); return id;
    },
    async deleteCompany(uid, id) { await ucol(uid, 'companies').doc(String(id)).delete(); bust(uid + ':companies'); },
    async updateCompany(uid, id, { last_scan, job_count, note }) {
      const f = {};
      if (last_scan != null) f.last_scan = last_scan;
      if (job_count != null) f.job_count = job_count;
      if (note != null) f.note = note;
      if (Object.keys(f).length) await ucol(uid, 'companies').doc(String(id)).update(f).catch(ignoreMissing);
      bust(uid + ':companies');
    },

    // ---- notifications ----
    async addNotification(uid, { title, body, searchId = null, jobs = [], demo = false }) {
      const id = newId();
      await ucol(uid, 'notifications').doc(String(id)).set({ created: Date.now(), title, body, search_id: searchId, jobs: JSON.stringify(jobs), demo: !!demo, is_read: false });
      bust(uid + ':notifs', uid + ':unread'); return id;
    },
    async notificationsUnread(uid) {
      return cached(uid + ':unread', TTL.counters, async () => (await ucol(uid, 'notifications').where('is_read', '==', false).count().get()).data().count);
    },
    async listNotifications(uid) {
      const items = await cached(uid + ':notifs', TTL.counters, async () => (await ucol(uid, 'notifications').orderBy('created', 'desc').limit(30).get()).docs.map(d => {
        const n = d.data();
        return { id: Number(d.id), created: n.created, title: n.title, body: n.body, searchId: n.search_id, jobs: JSON.parse(n.jobs || '[]'), demo: !!n.demo, read: !!n.is_read };
      }));
      return { items, unread: await this.notificationsUnread(uid) };
    },
    async markNotificationsRead(uid, { id, all: everything }) {
      if (everything) {
        const snap = await ucol(uid, 'notifications').where('is_read', '==', false).get();
        for (let i = 0; i < snap.docs.length; i += 400) { const b = db.batch(); snap.docs.slice(i, i + 400).forEach(d => b.update(d.ref, { is_read: true })); await b.commit(); }
      } else await ucol(uid, 'notifications').doc(String(id)).update({ is_read: true }).catch(ignoreMissing);
      bust(uid + ':notifs', uid + ':unread');
    },
  };
}
