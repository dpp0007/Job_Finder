// Server-side use cases shared by route handlers and the scheduled alert run.
import * as tf from './tinyfish.js';
import { store, forUser } from './store.js';
import { env } from './env.js';
import { isAdmin } from './auth.js';
import { removeCredential } from './credentials.js';
import { rankJobs, DEFAULT_PREFS, cleanPrefs, resumeCtx, scoreJob } from './rank.js';
import { discover, detectAts, boardName } from './discover.js';
import { humanize, buildJob, canonicalUrl } from './parse.js';
import { compact, createNotification } from './notify.js';
import { isJunkTitle } from './store/shared.js';

export const profile = async uid => ({ prefs: (await forUser(uid).getKV('profile', { prefs: DEFAULT_PREFS })).prefs || DEFAULT_PREFS, resume: await getResume(uid) });

// The uploaded resume lives under its own key so saving preferences can never overwrite it. Cached briefly per user: ranking asks for it often.
const RC = (globalThis.__resumeCache ??= new Map());
export async function getResume(uid) {
  const c = RC.get(uid);
  if (c && Date.now() - c.at < 30000) return c.v;
  const r = await forUser(uid).getKV('resume', null);
  const v = r?.skills ? r : null;
  RC.set(uid, { v, at: Date.now() });
  if (RC.size > 500) RC.delete(RC.keys().next().value);
  return v;
}
export const forgetUser = async uid => { await store.deleteUserData(uid); await removeCredential(uid); RC.delete(uid); };
export async function saveResume(uid, r) { await forUser(uid).setKV('resume', r || {}); RC.set(uid, { v: r, at: Date.now() }); } // {} marks "removed"
// What the browser may see: the facts, never the full text.
export const resumeMeta = r => r && { name: r.name, size: r.size, at: r.at, skills: r.skills, years: r.years, level: r.level, families: r.families, words: r.words };

// Daily allowances per person for the calls that spend your TinyFish and Gemini credits. 0 turns a limit off.
const CAP = { search: ['USER_DAILY_SEARCHES', 20], read: ['USER_DAILY_READS', 300], analyze: ['USER_DAILY_ANALYSES', 60] };
export async function useQuota(uid, kind, n = 1) {
  const [name, dflt] = CAP[kind];
  const raw = env(name), max = raw === undefined ? dflt : Number(raw) || 0;
  if (!max) return;
  const me = forUser(uid), day = new Date().toISOString().slice(0, 10), key = 'quota:' + day;
  const q = await me.getKV(key, {});
  if ((q[kind] || 0) + n > max) throw Object.assign(new Error(`You’ve reached today’s limit of ${max} ${{ search: 'live searches', read: 'posting reads', analyze: 'fit analyses' }[kind]}. It resets at midnight UTC.`), { status: 429, expose: true });
  await me.setKV(key, { ...q, [kind]: (q[kind] || 0) + n });
}

export async function ranked(uid, prefs) {
  const [st, jobs, resume] = await Promise.all([forUser(uid).trackerMap(), store.loadJobs(), getResume(uid)]);
  const r = rankJobs(jobs.filter(j => st[j.id]?.stage !== 'hidden' && !isJunkTitle(j.title)), { ...DEFAULT_PREFS, ...prefs }, resume);
  const tag = j => ({ ...j, stage: st[j.id]?.stage || null });
  r.results = r.results.slice(0, 250).map(tag);
  r.near = r.near.map(tag);
  return r;
}

export async function runSearch(uid, prefs, emit) {
  const me = forUser(uid);
  const watch = await me.listCompanies();
  const out = await discover(prefs, { watch, emit });
  const now = Date.now();
  await Promise.all(watch.map(c => me.updateCompany(c.id, { last_scan: now })));
  return out;
}

// Listings the search indexed without their text: read the posting pages now (one Fetch call), so the description, skills and resume fit are never missing.
export async function readPostings(ids) {
  const out = new Map();
  const todo = [];
  for (const id of ids.slice(0, 10)) {
    const j = await store.getJob(id);
    if (!j) continue;
    if (j.hasDesc) { out.set(id, j); continue; }
    if ((await store.getKV(`readfail:${id}`, 0)) > Date.now() - 6 * 36e5) { out.set(id, { ...j, unreadable: true }); continue; }   // tried recently and the page had nothing
    todo.push(j);
  }
  if (todo.length) {
    const { results } = await tf.fetchUrls(todo.map(j => j.url), { links: false, ttl: 86400 });
    const byUrl = new Map(results.map(r => [canonicalUrl(r.url), r.text || '']));
    const built = [];
    for (const j of todo) {
      const text = byUrl.get(canonicalUrl(j.url)) || '';
      if (text.length < 250) { await store.setKV(`readfail:${j.id}`, Date.now()); out.set(j.id, { ...j, unreadable: true }); continue; }
      built.push(buildJob({ title: j.title, company: j.company, location: j.location, url: j.url, desc: text, ats: j.ats, department: j.department, source: j.sources?.[0]?.name, postedAt: j.postedAt }));
    }
    if (built.length) await store.upsertJobs(built);
    for (const j of todo) if (!out.has(j.id)) out.set(j.id, (await store.getJob(j.id)) || j);
  }
  return out;
}
export const readPosting = async id => (await readPostings([id])).get(id) || null;
export const withFit = async (uid, j, prefs) => ({ ...j, ...scoreJob(j, cleanPrefs(prefs), resumeCtx(await getResume(uid))) });

const CLOSED = /no longer (?:available|accepting)|position (?:has been|is) (?:filled|closed)|job (?:not found|has expired|is closed)|this job (?:is )?(?:closed|expired)|posting (?:has )?(?:expired|closed)|no longer open/i;
export async function verify(id) {
  const j = await store.getJob(id); if (!j) return null;
  const { results, errors } = await tf.fetchUrls([j.url], { ttl: 0, links: false });
  const r = results[0], err = errors[0];
  const gone = (err && /page_not_found|404|410/.test(JSON.stringify(err))) || (r && (CLOSED.test((r.text || '').slice(0, 3000)) || /error=true/.test(r.final_url || '')));
  const status = gone ? 'closed' : 'open'; // a transient fetch error is not proof the job closed
  await store.setJobStatus(id, status);
  return status;
}

export async function resolveCompany(input) {
  const isUrl = /^https?:\/\//i.test(input);
  let url = input;
  if (!isUrl) {
    const res = await tf.search({ query: `${input} careers jobs`, purpose: 'Find the official careers or jobs page of this company' });
    const hit = res.find(h => detectAts(h.url) || /career|jobs/i.test(h.url)) || res[0];
    if (!hit) throw new Error(`Couldn't find a careers page for "${input}"`);
    url = hit.url;
  }
  let a = detectAts(url);
  if (!a) { // a custom careers page may link to an ATS board
    const { results } = await tf.fetchUrls([url], { links: true });
    for (const l of results[0]?.links || []) { a = detectAts(typeof l === 'string' ? l : l.url || ''); if (a) break; }
  }
  let name = input;
  if (isUrl) { // a job-board URL names the company by its slug / board name, not by "boards.greenhouse.io"
    name = (a && (await boardName(a.ats, a.slug).catch(() => null))) || (a ? humanize(a.slug) : new URL(input).hostname.replace(/^(www|jobs|careers)\./, '').split('.')[0].replace(/\b\w/g, c => c.toUpperCase()));
  }
  return { name, careers_url: url, ats: a?.ats || null, slug: a?.slug || null };
}

// Re-run saved searches that are due, flag new matches, re-verify tracked links.
// Called by the in-process timer (instrumentation.js) on a normal server, or by /api/cron/tick on serverless hosts.
export async function tick() {
  const summary = { alerts: 0, notified: 0, verified: 0 };
  if (!tf.cfg.key()) return summary;
  for (const s of await store.dueSearches(Date.now())) {   // every user's due searches; each is run and notified as its own user
    const me = forUser(s.uid);
    try {
      await useQuota(s.uid, 'search');
      const start = Date.now();
      await runSearch(s.uid, s.prefs, () => {});
      const found = rankJobs((await store.loadJobs()).filter(j => j.firstSeen >= start), { ...DEFAULT_PREFS, ...s.prefs }, await getResume(s.uid)).results;
      await me.finishSearchRun(s.id, found.length);
      summary.alerts++;
      if (found.length) {
        await createNotification(s.uid, {
          title: `${found.length} new match${found.length > 1 ? 'es' : ''} for ${s.name}`,
          body: found.slice(0, 3).map(j => `${(j.title || '').split(/\s[|•]\s/)[0]} at ${j.company}`).join(' · '),
          searchId: s.id, jobs: found.slice(0, 5).map(compact),
        }, { external: isAdmin((await store.getUser(s.uid))?.email) });   // Telegram is one shared chat: only the admin's alerts go there
        summary.notified++;
      }
    } catch (e) { console.error('alert run failed:', e.message); await me.finishSearchRun(s.id, 0).catch(() => {}); }
  }
  for (const jobId of await store.openTrackedJobIds()) {
    const at = await store.jobVerifiedAt(jobId);
    if (at != null && Date.now() - at > 864e5) { await verify(jobId).catch(() => {}); summary.verified++; }
  }
  return summary;
}

export const needKey = () => !tf.cfg.key();
