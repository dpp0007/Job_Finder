// Discovery pipeline: Search -> classify -> expand ATS boards (Fetch) -> deep-read postings (Fetch)
// -> Agent for custom careers pages -> feature extraction -> upsert.
import * as tf from './tinyfish.js';
import { buildJob, humanize, canonicalUrl, parseListingTitle } from './parse.js';
import { titleRelevance, synOf, isIndia, dropReasons, locMatch, DEFAULT_PREFS } from './rank.js';
import { createHash } from 'node:crypto';
import { store } from './store.js';
import { llmEnabled, extractPosting, applyLlm } from './llm.js';

export const PORTALS = [
  { id: 'greenhouse', label: 'Greenhouse', domains: ['boards.greenhouse.io', 'job-boards.greenhouse.io'] },
  { id: 'lever', label: 'Lever', domains: ['jobs.lever.co'] },
  { id: 'ashby', label: 'Ashby', domains: ['jobs.ashbyhq.com'] },
  { id: 'workable', label: 'Workable', domains: ['apply.workable.com'] },
  { id: 'smartrecruiters', label: 'SmartRecruiters', domains: ['jobs.smartrecruiters.com'] },
  { id: 'workday', label: 'Workday', domains: ['myworkdayjobs.com'] },
  { id: 'yc', label: 'Work at a Startup', domains: ['workatastartup.com'] },
  { id: 'wellfound', label: 'Wellfound', domains: ['wellfound.com'] },
  { id: 'builtin', label: 'Built In', domains: ['builtin.com'] },
  { id: 'remote', label: 'Remote boards', domains: ['remoteok.com', 'weworkremotely.com', 'himalayas.app', 'remotive.com'] },
  { id: 'india', label: 'Indian portals', domains: ['naukri.com', 'internshala.com', 'instahyre.com', 'cutshort.io', 'foundit.in', 'hirist.tech'] },
  { id: 'web', label: 'Open web & careers pages', domains: null },
];
const DEPTH = {
  quick: { roles: 1, pages: 1, boards: 5, deep: 15, agents: 1, budget: 40000, llm: 15 },
  standard: { roles: 2, pages: 1, boards: 12, deep: 40, agents: 2, budget: 75000, llm: 40 },
  deep: { roles: 3, pages: 2, boards: 25, deep: 90, agents: 4, budget: 150000, llm: 90 },
};

const AGGREGATORS = /linkedin|indeed|glassdoor|naukri|monster|ziprecruiter|simplyhired|jooble|talent\.com|builtin|wellfound|workatastartup|remoteok|weworkremotely|himalayas|remotive|internshala|instahyre|cutshort|foundit|hirist/i;

// Indian portals: which URLs are a single posting, and which are category pages that list dozens of them.
const IN_POSTING = [/naukri\.com\/job-listings-/i, /instahyre\.com\/job-\d+/i, /cutshort\.io\/job\//i, /internshala\.com\/(internship|job)\/detail\//i, /foundit\.in\/(job|jobs)\/[^/]+-\d+/i, /hirist\.tech\/j\//i];
const IN_LISTING = [/internshala\.com\/(internships|jobs)\//i, /naukri\.com\/[^/]*-jobs/i, /instahyre\.com\/[^/]*(jobs|internships)/i, /cutshort\.io\/jobs\//i];
const isInPosting = u => IN_POSTING.some(r => r.test(u));
const isInListing = u => !isInPosting(u) && IN_LISTING.some(r => r.test(u));

const JUNK_TITLE = /^((current |all |open )?(job )?(openings?|positions?|roles?|jobs?|vacancies)|careers?|home|apply|join us|work with us|search jobs)\W*\d*$|^\d[\d,]*\+?\s|\bjob vacancies\b|^[\w .+#/-]+ jobs?:\s/i; // also: "2979+ Frontend Developer in …", "Figma Jobs: 64 …" (category pages)

// ---- ATS detection ----
const ATS = [
  ['greenhouse', /(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_app\?for=)?([\w-]+)(?:\/jobs\/(\d+))?/i],
  ['lever', /jobs(?:\.eu)?\.lever\.co\/([\w.-]+)(?:\/([0-9a-f-]{36}))?/i],
  ['ashby', /jobs\.ashbyhq\.com\/([\w.%-]+)(?:\/([0-9a-f-]{36}))?/i],
  ['workable', /apply\.workable\.com\/([\w-]+)(?:\/j\/([\w]+))?/i],
  ['smartrecruiters', /jobs\.smartrecruiters\.com\/([\w-]+)(?:\/(\d+))?/i],
  ['workday', /\/\/([\w-]+)\.wd\d+\.myworkdayjobs\.com\/.*\/job\//i],
];
export function detectAts(url) {
  for (const [ats, re] of ATS) {
    const m = url.match(re);
    if (m && m[1] && !['embed', 'api', 'v1'].includes(m[1])) return { ats, slug: m[1], jobId: ats === 'workday' ? 'x' : m[2] || null };
  }
  return null;
}

const ADAPTERS = {
  greenhouse: {
    api: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    map: j => (j.jobs || []).map(x => ({ title: x.title, location: x.location?.name, url: x.absolute_url, postedAt: Date.parse(x.first_published || x.updated_at) })),
  },
  lever: {
    api: s => `https://api.lever.co/v0/postings/${s}?mode=json`,
    map: j => (Array.isArray(j) ? j : []).map(x => ({
      title: x.text, location: x.categories?.allLocations?.join('; ') || x.categories?.location, url: x.hostedUrl, postedAt: x.createdAt,
      desc: `${x.descriptionPlain || ''}\n${x.additionalPlain || ''}`, employmentType: x.categories?.commitment, workplace: x.workplaceType,
      salaryRange: x.salaryRange, department: x.categories?.team,
    })),
  },
  ashby: {
    api: s => `https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`,
    map: j => (j.jobs || []).map(x => ({
      title: x.title, location: [x.location, ...(x.secondaryLocations || []).map(l => l.location)].filter(Boolean).join('; '), url: x.jobUrl,
      postedAt: Date.parse(x.publishedAt), desc: x.descriptionPlain, employmentType: x.employmentType,
      workplace: x.isRemote ? 'remote' : x.workplaceType, comp: x.compensation?.compensationTierSummary, department: x.department,
    })),
  },
  smartrecruiters: {
    api: s => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`,
    map: (j, s) => (j.content || []).map(x => ({
      title: x.name, url: `https://jobs.smartrecruiters.com/${s}/${x.id}`, postedAt: Date.parse(x.releasedDate), employmentType: x.typeOfEmployment?.label,
      location: [x.location?.city, x.location?.country?.toUpperCase()].filter(Boolean).join(', ') + (x.location?.remote ? ' (Remote)' : ''), company: x.company?.name,
    })),
  },
};

// Page <title> -> {title, company}, per ATS.
function splitTitle(ats, t = '') {
  const m = (re, a, b) => { const x = t.match(re); return x ? { title: x[a], company: x[b] } : null; };
  return (ats === 'greenhouse' && m(/^(?:Job Application for )?(.+) at (.+?)$/i, 1, 2))
    || (ats === 'lever' && m(/^(.+?) - (.+)$/, 2, 1))
    || (ats === 'ashby' && m(/^(.+?) @ (.+)$/, 1, 2))
    || (['workable', 'smartrecruiters'].includes(ats) && m(/^(.+?) [-–|] (.+)$/, 1, 2))
    || { title: t, company: '' };
}

const LOC_LINE = /remote|hybrid|on-?site|united states|usa|\bUK\b|india|germany|canada|australia|singapore|london|new york|san francisco|berlin|bangalore|bengaluru|,\s*[A-Z]{2}\b/i;
function guessLocation(md) {
  const lines = md.split('\n').map(l => l.replace(/[#*_>`[\]]/g, '').trim()).filter(Boolean).slice(0, 14);
  const lab = md.match(/(?:Location|Office|Based in)\s*[:\n]+\s*([^\n]{2,80})/i);
  return lab ? lab[1].replace(/[*_]/g, '').trim() : lines.find(l => l.length < 70 && LOC_LINE.test(l) && !/apply|interested|share|save|sign in|log in|cookie|menu|follow/i.test(l)) || '';
}

// TinyFish renders pages as markdown, which backslash-escapes punctuation (absolute\_url) and breaks JSON.parse.
const unescapeMd = s => s.replace(/\\([_*\[\]()#+\-.!`~>|])/g, '$1');

function parseJsonText(t) {
  if (t && typeof t === 'object') return t;
  try { return JSON.parse(t); } catch { /* fall through */ }
  try { return JSON.parse(unescapeMd(String(t || ''))); } catch { /* fall through */ }
  const s = unescapeMd(String(t || '')), a = s.search(/[[{]/), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  try { return a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null; } catch { return null; }
}

async function boardName(ats, slug) {
  if (ats !== 'greenhouse') return null;
  const { results } = await tf.fetchUrls([`https://boards-api.greenhouse.io/v1/boards/${slug}`], { links: false, ttl: 86400 });
  return parseJsonText(results[0]?.text)?.name || null;
}

async function fetchBoard(ats, slug) {
  const a = ADAPTERS[ats], url = a.api(slug);
  const { results, errors } = await tf.fetchUrls([url], { format: 'markdown', links: false, ttl: 600 });
  let json = parseJsonText(results[0]?.text);
  if (!json) { // Board APIs are public; a direct read keeps the run alive if TinyFish was rate limited or mangled the JSON.
    json = await fetch(url, { signal: AbortSignal.timeout(25000) }).then(r => r.json()).catch(() => null);
  }
  if (!json) throw new Error(`couldn't read the ${ats} job board${errors[0]?.error ? ` (${errors[0].error})` : ''}`); // visible failure, not a silent zero
  return a.map(json, slug);
}

// Small concurrency limiter: at most n tasks in flight.
// Identical queries within 6 hours are served from the local cache: repeat searches and alerts get much faster.
const SEARCH_TTL = 6 * 3600e3;
async function cachedSearch(params) {
  const key = 'sc:' + createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 20);
  const hit = await store.getKV(key);
  if (hit && Date.now() - hit.t < SEARCH_TTL) return hit.r;
  const r = await tf.search(params);
  await store.setKV(key, { t: Date.now(), r });
  return r;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
globalThis.__bg ??= 0; // slow tasks still finishing after a search returned (read by /api/status)

const limiter = n => {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const { fn, res, rej } = q.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return fn => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
};

// Fatal errors (bad key, no credits) must stop the run; everything else degrades gracefully.
const fatal = e => e && (e.code === 'auth' || e.code === 'credits' || e.code === 'nokey');

export { boardName };
export async function discover(prefsIn, { watch = [], emit = () => {}, onlyWatch = false } = {}) {
  const prefs = { ...DEFAULT_PREFS, ...prefsIn };
  const D = DEPTH[prefs.depth] || DEPTH.standard;
  const stats = { searches: 0, hits: 0, boards: 0, boardJobs: 0, fetched: 0, agent: 0, found: 0, fresh: 0, failed: 0, skipped: 0, ai: 0 };
  const names = new Map();            // ats:slug -> company name learned from postings
  const boardSeen = new Set();
  const postings = new Map();         // canonical url -> {url, hit, ats}
  const listings = new Set();         // Indian category pages: expanded into the postings they link to
  const known = await store.knownUrls(canonicalUrl); // already indexed with a description: don't re-read
  const raw = [];                     // raw job records waiting to be committed
  const thin = [];                    // jobs that arrived without a description
  const pool = { fetch: [], agent: [] };
  const deadline = Date.now() + (onlyWatch ? 330000 : D.budget); // a search always returns by its budget; slow work moves to the background
  const left = () => Math.max(0, deadline - Date.now());
  const pending = new Set();
  let timedOut = false;
  const issues = [];                  // human-readable reasons something failed, shown to the user
  const ids = new Set();
  const touched = new Set();          // ids committed this run: candidates for AI reading              // unique openings this run (enrichment re-commits the same jobs)
  let fatalErr = null;
  const note = (api, msg) => emit({ type: 'stage', api, msg });
  const lim = { fetch: limiter(3), agent: limiter(2) };
  const fail = (label, e) => {
    stats.failed++;
    const why = /timed out/i.test(e.message) ? 'timed out (the site may block automated browsing)' : e.message;
    issues.push(`${label}: ${why}`); note('error', `${label}: ${why}`);
  };
  const task = (kind, fn, label = 'A request') => {
    const p = lim[kind](fn).catch(e => { if (fatal(e)) fatalErr ||= e; else fail(label, e); });
    pending.add(p); p.finally(() => pending.delete(p)); pool[kind].push(p);
  };

  // ---- AI reading (Gemini 3.5 Flash-Lite): a streaming queue, so the model reads postings while pages are still being fetched ----
  const llmQ = [], llmSeen = new Set(), llmRuns = [];
  let llmClosed = false, llmStop = false, llmBad = 0;
  const llmWorker = async () => {
    while (!llmStop) {
      const id = llmQ.shift();
      if (id === undefined) { if (llmClosed) return; await sleep(250); continue; }
      const j = await store.getJob(id);
      if (!j || j.llm) continue;
      try {
        const out = applyLlm(j, await extractPosting(j));
        if (out.junk) await store.markJunk(j.id); else await store.saveJob(out);
        if (++stats.ai % 5 === 0) emit({ type: 'batch', stats });
      } catch (e) {
        if (e.code === 'ai_auth' || e.code === 'ai_credits') { llmStop = true; issues.push(`AI reading skipped: ${e.message}`); note('error', `AI reading skipped: ${e.message}`); }
        else if (e.code === 'ai_rate' && ++llmBad >= 3) { llmStop = true; issues.push('AI reading paused: Gemini rate limit reached'); }
      }
    }
  };
  // A posting is worth the model's time when it passes every filter, or fails only because something is unstated
  // (work mode / location unknown): that is exactly what the model can read from the text.
  const worthReading = job => {
    const why = dropReasons(job, prefs);
    if (!why.length) return true;
    const unstated = job.workMode === 'unknown' && (!job.location || !prefs.locations.length || locMatch(job.location, prefs.locations));
    return unstated && why.every(r => ['location', 'keywords', 'seniority', 'type'].includes(r));
  };
  const enqueueLlm = job => {
    if (!llmEnabled() || !D.llm || llmStop || llmSeen.size >= D.llm || llmSeen.has(job.id)) return;
    if (!job.hasDesc || !worthReading(job)) return; // only postings the user could actually see, and that have text to read
    llmSeen.add(job.id); llmQ.push(job.id);
    if (llmRuns.length < 4) {
      if (!llmRuns.length) note('ai', 'Reading postings with AI as they arrive');
      const p = llmWorker(); llmRuns.push(p);
      pending.add(p); p.finally(() => pending.delete(p));
    }
  };

  // Build features, dedupe-by-id upsert, and tell the client there is something new to show.
  const commit = async () => {
    const jobs = [];
    for (const r of raw.splice(0)) {
      if (!r.title || !r.url || JUNK_TITLE.test(r.title.trim())) continue;
      const job = buildJob(r);
      if (!ids.has(job.id)) { ids.add(job.id); stats.found++; }
      touched.add(job.id);
      jobs.push(job);
    }
    if (jobs.length) stats.fresh += await store.upsertJobs(jobs); // one batched write
    for (const job of jobs) enqueueLlm(job);                       // after the write, so the model reads what is stored
    emit({ type: 'batch', stats });
  };

  // ---- board expansion (Fetch on public ATS endpoints) ----
  const startBoard = (b, company) => {
    const key = `${b.ats}:${b.slug}`;
    if (!ADAPTERS[b.ats] || boardSeen.has(key) || boardSeen.size >= D.boards + watch.length) return;
    boardSeen.add(key);
    if (company) names.set(key, company);
    task('fetch', async () => {
      const [jobs, nm] = await Promise.all([fetchBoard(b.ats, b.slug), names.get(key) ? null : boardName(b.ats, b.slug).catch(() => null)]);
      stats.boards++; stats.boardJobs += jobs.length;
      const co = names.get(key) || nm || humanize(b.slug);
      const keep = jobs.map(j => ({ ...j, ats: b.ats, source: b.ats, company: j.company || co, _r: titleRelevance(j.title, prefs.roles) }))
        .filter(j => j._r >= 0.5 && j.url).sort((a, c) => c._r - a._r).slice(0, onlyWatch ? 60 : 25); // a watchlist scan wants the whole company
      for (const j of keep) { raw.push(j); if (!j.desc && !known.has(canonicalUrl(j.url))) thin.push(j); }
      await commit();
    }, `${names.get(key) || humanize(b.slug)} board`);
  };

  const readPostings = async plist => {
    note('fetch', `Reading ${plist.length} postings`);
    const chunks = [];
    for (let i = 0; i < plist.length; i += 3) chunks.push(plist.slice(i, i + 3));
    await Promise.all(chunks.map(readChunk)); // small parallel chunks: one slow page no longer holds up the rest
  };
  const readChunk = async plist => {
    const { results } = await tf.fetchUrls(plist.map(p => p.url), { links: true, per_url_timeout_ms: 20000 });
    stats.fetched += results.length;
    const byUrl = new Map(results.map(r => [canonicalUrl(r.url), r]));
    const blocked = [];
    for (const p of plist) {
      const r = byUrl.get(p.url) || results.find(x => canonicalUrl(x.final_url || '') === p.url);
      const md = r?.text || '';
      if (!r || md.length < 200) { blocked.push(p); continue; }
      const sp = splitTitle(p.ats, r.title || p.hit.title);
      const key = p.ats ? `${p.ats}:${p.slug}` : null;
      const aggregator = !p.ats && AGGREGATORS.test(new URL(p.url).hostname);
      const fromTitle = aggregator && (r.title || p.hit.title || '').match(/\s(?:at|bei|@)\s+([^|—–\-]{2,60}?)(?:\s*[|—–\-]|$)/i)?.[1];
      const company = sp.company || (key && names.get(key)) || (p.ats ? humanize(p.slug) : aggregator ? (fromTitle || '').trim() : p.hit.site_name || new URL(p.url).hostname.replace(/^(www|jobs|careers)\./, ''));
      if (key && sp.company) names.set(key, sp.company);
      if (!p.ats && !/apply|responsibilit|requirement|qualification/i.test(md)) continue; // not a posting
      const lt = !p.ats && aggregator ? parseListingTitle(r.title || p.hit.title) : null; // company / role / place straight from the page title
      raw.push({ title: lt?.title || sp.title || p.hit.title, company: lt?.company || company, url: p.url, location: lt?.location || guessLocation(md), desc: md, postedAt: r.published_date, ats: p.ats, source: p.ats || p.hit.site_name || 'web' });
      if (!p.ats) for (const l of r.links || []) { const a = detectAts(typeof l === 'string' ? l : l.url || ''); if (a) startBoard(a); } // careers page -> ATS board
    }
    await commit();
    if (blocked.length) stats.skipped += 0; // blocked search hits are dropped, not sent to a slow Agent run
  };

  // ---- 0. watchlist first: known boards start immediately, custom sites go to the Agent ----
  for (const c of watch) {
    const a = c.ats && c.slug ? { ats: c.ats, slug: c.slug } : detectAts(c.careers_url);
    if (a && ADAPTERS[a.ats]) startBoard(a, c.name);
    else task('fetch', async () => { // custom careers site: cheap Fetch first, Agent only if that finds nothing
      note('fetch', `Reading ${c.name} careers page`);
      const { results } = await tf.fetchUrls([c.careers_url], { links: true, ttl: 0 });
      stats.fetched += results.length;
      const page = results[0];
      const links = (page?.links || []).map(l => (typeof l === 'string' ? l : l.url || ''));
      const before = boardSeen.size;
      for (const l of links) { const x = detectAts(l); if (x) startBoard(x, c.name); }
      if (boardSeen.size > before) return; // the page links to an ATS board: it will be read directly
      const root = new URL(c.careers_url).hostname.replace(/^www\./, '').split('.').slice(-2).join('.');
      const self = canonicalUrl(c.careers_url);
      const cands = [...new Set(links.map(canonicalUrl))].filter(u => {
        try { const x = new URL(u); return x.hostname.endsWith(root) && u !== self && /\/(jobs?|positions?|openings?|roles?|careers?|vacanc\w+)\/[^/]+/i.test(x.pathname); } catch { return false; }
      }).filter(u => !known.has(u)).slice(0, D.deep);
      if (cands.length >= 3) { await readPostings(cands.map(url => ({ url, hit: { title: '', site_name: c.name }, ats: null, slug: null }))); return; }
      if (!D.agents) { issues.push(`${c.name}: no job links found on its careers page`); return; }
      const walled = (page?.text || '').length < 500;
      task('agent', async () => {
        note('agent', `${walled ? `${c.name} blocks plain readers. ` : ''}Agent browsing ${c.name} (can take a few minutes)`);
        const out = await tf.agent({
          url: c.careers_url, stealth: true,
          goal: `Find currently open job postings on this careers page${prefs.roles.length ? ` relevant to: ${prefs.roles.join(', ')}` : ''}${prefs.locations.length ? ` in or near: ${prefs.locations.join(', ')}` : ''}. Use the page's search or filters if available and check up to 3 pages of results. For each job return title, location, the absolute URL to apply or view it, department, posted date if visible, and employment type. Return at most 30 jobs.`,
          output_schema: { type: 'object', properties: { jobs: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, location: { type: 'string' }, url: { type: 'string' }, department: { type: 'string' }, posted_date: { type: 'string' }, employment_type: { type: 'string' } }, required: ['title', 'url'] } } }, required: ['jobs'] },
        }, 300000);
        stats.agent++;
        const list = Array.isArray(out) ? out : out?.jobs || [];
        for (const j of list) if (j.title && j.url) raw.push({ title: j.title, company: c.name, url: new URL(j.url, c.careers_url).href, location: j.location, postedAt: j.posted_date, department: j.department, employmentType: j.employment_type, source: 'agent' });
        if (!list.length) issues.push(`${c.name}: the Agent found no openings on its careers page`);
        await commit();
      }, `${c.name} careers page`);
    }, `${c.name} careers page`);
  }

  // ---- 1. SEARCH: boards found here start expanding while later searches are still running ----
  const roles = [...new Set((prefs.roles.length ? prefs.roles : ['']).slice(0, D.roles).flatMap(r => [r, ...synOf(r).slice(0, 1)]))];
  const wantsIntern = prefs.types.includes('intern') || prefs.seniority.includes('intern');
  const indian = prefs.locations.some(isIndia);
  const portals = PORTALS.filter(p => prefs.portals.includes(p.id) || (indian && p.id === 'india'));
  const loc = prefs.locations[0] || (prefs.workMode === 'remote' ? 'remote' : '');
  // one query per source group (Search accepts many domains at once), not one per portal: far fewer round trips
  const GROUPS = [['ats', ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'workday']], ['india', ['india']], ['boards', ['yc', 'wellfound', 'builtin', 'remote']]];
  const groups = GROUPS.map(([id, ids]) => ({ id, domains: portals.filter(p => ids.includes(p.id)).flatMap(p => p.domains || []) })).filter(g => g.domains.length);
  if (portals.some(p => !p.domains)) groups.push({ id: 'web', domains: null });
  const queries = [];
  for (const role of roles) for (const p of groups) for (let page = 0; page < D.pages; page++) {
    const r = wantsIntern && !/intern/i.test(role) ? `${role} intern` : role;
    queries.push({ p, page, query: [r || 'jobs', loc, ...prefs.keywords.slice(0, 2), p.domains ? '' : 'careers apply'].filter(Boolean).join(' ') });
  }
  if (onlyWatch) queries.length = 0; // a company scan reads that company only, no portal searches
  if (queries.length) note('search', `Running ${queries.length} searches across ${groups.length} source groups`);
  for (const q of queries) {
    if (fatalErr) break;
    if (left() < 4000) { timedOut = true; break; }
    try {
      const res = await cachedSearch({
        query: q.query, include_domains: q.p.domains, page: q.page, location: indian ? 'IN' : undefined,
        recency_minutes: prefs.postedWithin ? prefs.postedWithin * 1440 : undefined,
        purpose: 'Find individual job postings or company careers pages matching a job seeker\'s criteria',
      });
      stats.searches++; stats.hits += res.length;
      for (const h of res) {
        const url = canonicalUrl(h.url), a = detectAts(url);
        if (a?.jobId) { if (known.has(url)) stats.skipped++; else postings.set(url, { url, hit: h, ...a }); startBoard(a); }
        else if (a) startBoard(a);
        else if (isInPosting(url)) { if (!known.has(url)) postings.set(url, { url, hit: h, ats: null }); }
        else if (isInListing(url)) { if (listings.size < 3) listings.add(url); }
        else if (/\/(jobs?|positions?|openings?|roles?|careers?|vacanc\w+)\/[^/]+/i.test(new URL(url).pathname) && !known.has(url)) postings.set(url, { url, hit: h, ats: null });
      }
      emit({ type: 'progress', stats });
    } catch (e) { if (fatal(e)) throw e; stats.failed++; }
  }
  if (fatalErr) throw fatalErr;
  if (queries.length) note('search', `${stats.hits} hits → ${postings.size} new postings, ${boardSeen.size} company boards${stats.skipped ? `, ${stats.skipped} already indexed` : ''}`);

  // ---- 1b. category pages (Internshala, Naukri...) -> the individual postings they link to ----
  for (const url of listings) task('fetch', async () => {
    note('fetch', `Opening ${new URL(url).hostname} category page`);
    const { results } = await tf.fetchUrls([url], { links: true, per_url_timeout_ms: 20000 });
    stats.fetched += results.length;
    const links = [...new Set((results[0]?.links || []).map(l => canonicalUrl(typeof l === 'string' ? l : l.url || '')))].filter(u => isInPosting(u) && !known.has(u) && !postings.has(u)).slice(0, 8);
    if (links.length) await readPostings(links.map(u => ({ url: u, hit: { title: '', site_name: '' }, ats: null, slug: null })));
  }, `${new URL(url).hostname} category page`);

  // ---- 2. read search-found postings (Fetch, batched) ----
  const plist = [...postings.values()].slice(0, D.deep);
  if (plist.length) task('fetch', () => readPostings(plist), 'Reading postings');

  // boards and postings first; slow Agent runs must not hold up everything behind them
  const drain = async kind => { for (let done = 0; done < pool[kind].length;) { const b = pool[kind].slice(done); done += b.length; await Promise.all(b); } };
  const withinBudget = p => Promise.race([p, sleep(left()).then(() => { timedOut = true; })]);
  await withinBudget(drain('fetch'));
  if (fatalErr) throw fatalErr;

  // enrich promising board jobs that came without text (salary, visa, skills) while any Agent runs finish
  const enrich = async () => {
    if (left() < 10000) return; // not enough budget left to read more pages
    const todo = thin.sort((a, b) => titleRelevance(b.title, prefs.roles) - titleRelevance(a.title, prefs.roles)).slice(0, D.deep);
    if (!todo.length) return;
    note('fetch', `Reading ${todo.length} promising openings for salary, visa and skills`);
    const { results } = await tf.fetchUrls(todo.map(j => j.url), { links: false });
    stats.fetched += results.length;
    const m = new Map(results.map(r => [canonicalUrl(r.url), r]));
    for (const j of todo) { const r = m.get(canonicalUrl(j.url)); if (r?.text) raw.push({ ...j, desc: r.text, postedAt: j.postedAt || r.published_date }); }
    await commit();
  };
  const agentsDone = drain('agent');
  await withinBudget(enrich());
  llmClosed = true;                       // no more postings are coming: let the workers drain the queue and stop
  await withinBudget(Promise.all(llmRuns));
  // A company scan waits for its Agent run. A normal search never does: Agents are slow, so they finish in the background.
  if (onlyWatch) await withinBudget(agentsDone); else await Promise.race([agentsDone, sleep(Math.min(4000, left()))]);
  if (fatalErr) throw fatalErr;

  // anything still running keeps going in the background and lands in the index when it finishes
  const still = pending.size;
  if (still) {
    for (const p of pending) { globalThis.__bg++; p.finally(() => { globalThis.__bg--; }); }
    note('search', `${timedOut ? 'Time budget reached. Showing what we found. ' : ''}${still} slower task${still > 1 ? 's' : ''} (like a browsing agent on a hard-to-read site) will finish in the background.`);
  }
  note('rank', `Indexed ${stats.found} openings (${stats.fresh} new)`);
  return { stats, issues, timedOut, background: still };
}
