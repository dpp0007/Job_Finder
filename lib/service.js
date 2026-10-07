// Server-side use cases shared by route handlers and the scheduled alert run.
import * as tf from './tinyfish.js';
import { store } from './store.js';
import { rankJobs, DEFAULT_PREFS } from './rank.js';
import { discover, detectAts, boardName } from './discover.js';
import { humanize } from './parse.js';
import { compact, createNotification } from './notify.js';

export const profile = () => store.getKV('profile', { prefs: DEFAULT_PREFS, resume: '' });

export async function ranked(prefs, resume) {
  const [st, jobs] = await Promise.all([store.trackerMap(), store.loadJobs()]);
  const r = rankJobs(jobs.filter(j => st[j.id]?.stage !== 'hidden'), { ...DEFAULT_PREFS, ...prefs }, resume);
  const tag = j => ({ ...j, stage: st[j.id]?.stage || null });
  r.results = r.results.slice(0, 250).map(tag);
  r.near = r.near.map(tag);
  return r;
}

export async function runSearch(prefs, emit) {
  const watch = await store.listCompanies();
  const out = await discover(prefs, { watch, emit });
  const now = Date.now();
  await Promise.all(watch.map(c => store.updateCompany(c.id, { last_scan: now })));
  return out;
}

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
  const resume = (await profile()).resume;
  for (const s of await store.dueSearches(Date.now())) {
    try {
      const start = Date.now();
      await runSearch(s.prefs, () => {});
      const found = rankJobs((await store.loadJobs()).filter(j => j.firstSeen >= start), { ...DEFAULT_PREFS, ...s.prefs }, resume).results;
      await store.finishSearchRun(s.id, found.length);
      summary.alerts++;
      if (found.length) {
        await createNotification({
          title: `${found.length} new match${found.length > 1 ? 'es' : ''} for ${s.name}`,
          body: found.slice(0, 3).map(j => `${(j.title || '').split(/\s[|•]\s/)[0]} at ${j.company}`).join(' · '),
          searchId: s.id, jobs: found.slice(0, 5).map(compact),
        });
        summary.notified++;
      }
    } catch (e) { console.error('alert run failed:', e.message); await store.finishSearchRun(s.id, 0).catch(() => {}); }
  }
  for (const jobId of await store.trackerOpenIds()) {
    const at = await store.jobVerifiedAt(jobId);
    if (at != null && Date.now() - at > 864e5) { await verify(jobId).catch(() => {}); summary.verified++; }
  }
  return summary;
}

export const needKey = () => !tf.cfg.key();
