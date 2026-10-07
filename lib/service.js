// Server-side use cases shared by route handlers and the background scheduler.
import * as tf from './tinyfish.js';
import { all, get, run, getKV, loadJobs, getJob } from './db.js';
import { rankJobs, DEFAULT_PREFS } from './rank.js';
import { discover, detectAts, boardName } from './discover.js';
import { humanize } from './parse.js';
import { compact, createNotification } from './notify.js';

export const profile = () => getKV('profile', { prefs: DEFAULT_PREFS, resume: '' });
const stageMap = () => Object.fromEntries(all('SELECT job_id, stage, note FROM tracker').map(r => [r.job_id, r]));

export function ranked(prefs, resume) {
  const st = stageMap();
  const r = rankJobs(loadJobs().filter(j => st[j.id]?.stage !== 'hidden'), { ...DEFAULT_PREFS, ...prefs }, resume);
  const tag = j => ({ ...j, stage: st[j.id]?.stage || null });
  r.results = r.results.slice(0, 250).map(tag);
  r.near = r.near.map(tag);
  return r;
}

export async function runSearch(prefs, emit) {
  const watch = all('SELECT * FROM companies');
  const out = await discover(prefs, { watch, emit });
  for (const c of watch) run('UPDATE companies SET last_scan=? WHERE id=?', Date.now(), c.id);
  return out;
}

const CLOSED = /no longer (?:available|accepting)|position (?:has been|is) (?:filled|closed)|job (?:not found|has expired|is closed)|this job (?:is )?(?:closed|expired)|posting (?:has )?(?:expired|closed)|no longer open/i;
export async function verify(id) {
  const j = getJob(id); if (!j) return null;
  const { results, errors } = await tf.fetchUrls([j.url], { ttl: 0, links: false });
  const r = results[0], err = errors[0];
  const gone = (err && /page_not_found|404|410/.test(JSON.stringify(err))) || (r && (CLOSED.test((r.text || '').slice(0, 3000)) || /error=true/.test(r.final_url || '')));
  const status = gone ? 'closed' : 'open'; // a transient fetch error is not proof the job closed
  run('UPDATE jobs SET status=?, last_verified=? WHERE id=?', status, Date.now(), id);
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

// Re-run saved searches, flag new matches, re-verify tracked links. Called by instrumentation.js.
export async function tick() {
  if (!tf.cfg.key()) return;
  for (const s of all('SELECT * FROM searches WHERE auto=1 AND ? - last_run > interval_h * 3600000', Date.now())) {
    try {
      const start = Date.now(), prefs = JSON.parse(s.prefs);
      await runSearch(prefs, () => {});
      const found = rankJobs(loadJobs().filter(j => j.firstSeen >= start), { ...DEFAULT_PREFS, ...prefs }, profile().resume).results;
      run('UPDATE searches SET last_run=?, new_count=new_count+? WHERE id=?', Date.now(), found.length, s.id);
      if (found.length) createNotification({
        title: `${found.length} new match${found.length > 1 ? 'es' : ''} for ${s.name}`,
        body: found.slice(0, 3).map(j => `${(j.title || '').split(/\s[|•]\s/)[0]} at ${j.company}`).join(' · '),
        searchId: s.id, jobs: found.slice(0, 5).map(compact),
      });
    } catch (e) { console.error('alert run failed:', e.message); run('UPDATE searches SET last_run=? WHERE id=?', Date.now(), s.id); }
  }
  for (const t of all("SELECT job_id FROM tracker WHERE stage IN ('saved','applied')")) {
    const j = get('SELECT last_verified FROM jobs WHERE id=?', t.job_id);
    if (j && Date.now() - j.last_verified > 864e5) await verify(t.job_id).catch(() => {});
  }
}

export const needKey = () => !tf.cfg.key();
