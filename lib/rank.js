// Matching, hard filters, scoring and dedupe. Pure functions, no I/O.
import { tokens, norm, roleFamily, LEVELS, extractSkills, normTitle, normCompany, toInr } from './parse.js';
import { correctTerms } from './typos.js';
import { sanitizePrefs } from './validate.js';
import { termsOf, isCommonWord, levelOf } from './profile.js';

export const DEFAULT_PREFS = {
  roles: [], locations: [], workMode: 'any', seniority: [], types: [], keywords: [], must: [], exclude: [],
  visa: 'any', minSalary: 0, postedWithin: 0, portals: ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'web'],
  depth: 'standard', keywordMode: 'any', payOnly: false,
};

// Fills defaults and fixes obvious typos in roles and places ("Backend Devloper", "Banglore"). `corrected` lists what changed.
export function cleanPrefs(prefs) {
  const s = sanitizePrefs({ ...DEFAULT_PREFS, ...prefs }).prefs;   // only job-related, in-range values get this far
  const p = { ...DEFAULT_PREFS, ...s, portals: s.portals.length ? s.portals : DEFAULT_PREFS.portals };
  const roles = correctTerms(p.roles), locations = correctTerms(p.locations);
  return { ...p, roles: roles.terms, locations: locations.terms, corrected: [...roles.changes, ...locations.changes] };
}

const SYN = [
  ['software engineer', 'software developer', 'software development engineer', 'sde', 'swe', 'web developer'],
  ['frontend engineer', 'ui engineer', 'react engineer', 'web engineer', 'fullstack engineer'],
  ['backend engineer', 'api engineer', 'server engineer', 'fullstack engineer'],
  ['data scientist', 'applied scientist', 'machine learning scientist'],
  ['data analyst', 'business analyst', 'analytics engineer', 'bi analyst', 'business intelligence analyst'],
  ['machine learning engineer', 'ml engineer', 'ai engineer', 'applied ml', 'research engineer'],
  ['product manager', 'product owner', 'associate product manager', 'apm'],
  ['devops engineer', 'site reliability engineer', 'sre', 'platform engineer', 'infrastructure engineer', 'cloud engineer'],
  ['product designer', 'ux designer', 'ui designer', 'ux ui designer', 'ui ux designer', 'ui ux', 'ux', 'ui', 'visual designer', 'interaction designer'],
  ['qa engineer', 'test engineer', 'sdet', 'quality engineer'],
];

// Canonical form so "Front End Developer" and "Frontend Engineer" are the same role. Whole words only.
const STOPW = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'in', 'at', 'to', 'with']);
const canon = s => norm(s)
  .replace(/\bfront end\b/g, 'frontend').replace(/\bback end\b/g, 'backend').replace(/\bfull stack\b/g, 'fullstack')
  .replace(/\bdevelopers?\b/g, 'engineer').replace(/\bengineers?\b|\bengineering\b/g, 'engineer')
  .replace(/\bswe\b|\bsde\b/g, 'software engineer').replace(/\bdata science\b|\bscientists\b/g, m => (m === 'scientists' ? 'scientist' : 'data scientist'))
  .replace(/\binterns\b|\binternship\b|\bco op\b|\btrainee\b/g, 'intern');
const ctok = s => canon(s).split(' ').filter(w => w && !STOPW.has(w));
// words that describe the level or the job noun, not the field: "Frontend Intern" still matches "Frontend Developer"
const GENERIC = new Set(['engineer', 'intern', 'associate', 'junior', 'senior', 'sr', 'jr', 'lead', 'staff', 'principal', 'specialist']);

export const synOf = r => { const n = canon(r); const g = SYN.find(g => g.some(x => canon(x) === n)); return g ? g.filter(x => canon(x) !== n) : []; };
const allIn = (toks, hay) => toks.length && toks.every(t => hay.includes(t));

// 0..1 relevance of a job title to the user's roles. Below 0.5 the job is filtered out as a different role.
export function titleRelevance(title, roles) {
  if (!roles?.length) return 1;
  const T = canon(title), Tt = ctok(title), TP = ` ${T} `, has = x => TP.includes(` ${x} `); // whole-word: 'ux' must not match 'Linux'
  let best = 0;
  for (const role of roles) {
    const rt = ctok(role), rn = canon(role);
    if (has(rn)) { best = Math.max(best, 1); continue; }
    if (allIn(rt, Tt)) best = Math.max(best, 0.9);
    if (synOf(role).some(x => has(canon(x)))) best = Math.max(best, 0.85);
    const distinct = rt.filter(t => !GENERIC.has(t));
    if (distinct.length && distinct.every(t => Tt.includes(t))) best = Math.max(best, 0.8);
    let sc = (rt.filter(t => Tt.includes(t)).length / (rt.length || 1)) * 0.6;
    const fam = roleFamily(role);
    if (fam !== 'other' && fam === roleFamily(title)) sc = Math.max(sc, 0.45); // same family alone is a weak signal, not a match
    best = Math.max(best, sc);
  }
  return best;
}

export const INDIA_CITIES = ['bengaluru', 'bangalore', 'delhi', 'new delhi', 'ncr', 'gurugram', 'gurgaon', 'noida', 'ghaziabad', 'faridabad', 'mumbai', 'navi mumbai', 'thane', 'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad', 'jaipur', 'chandigarh', 'mohali', 'kochi', 'cochin', 'thiruvananthapuram', 'coimbatore', 'indore', 'lucknow', 'nagpur', 'bhubaneswar', 'surat', 'vadodara', 'india'];
export const isIndia = s => { const n = norm(s || ''); return INDIA_CITIES.some(c => n.includes(c)); };
const ALIAS = [['us', 'usa', 'united states', 'america'], ['uk', 'united kingdom', 'england', 'britain'], ['uae', 'united arab emirates', 'dubai'], ['germany', 'deutschland'],
  ['india', 'bharat'], ['bengaluru', 'bangalore', 'bengaluru karnataka', 'karnataka'], ['delhi', 'new delhi', 'delhi ncr', 'ncr', 'gurugram', 'gurgaon', 'noida', 'ghaziabad', 'faridabad'],
  ['mumbai', 'bombay', 'navi mumbai', 'thane', 'maharashtra'], ['chennai', 'madras', 'tamil nadu'], ['kolkata', 'calcutta', 'west bengal'], ['kochi', 'cochin', 'kerala']];
const aliases = w => ALIAS.find(g => g.includes(w)) || [w];
export function locMatch(jobLoc, wanted) {
  const L = ` ${norm(jobLoc)} `;
  return wanted.some(w => aliases(norm(w)).some(a => a.length > 1 && (L.includes(` ${a} `) || L.includes(a))));
}

// Other countries / regions. A "Remote - US" job must not satisfy a search for Delhi.
const FOREIGN = /\b(united states|usa|u\.s\.|us only|canada|united kingdom|uk|europe|emea|germany|france|spain|italy|netherlands|ireland|poland|romania|portugal|sweden|australia|new zealand|brazil|mexico|latam|argentina|colombia|japan|singapore|philippines|israel|uae|dubai|nigeria|kenya|south africa)\b/i;

const isForeign = l => FOREIGN.test(l || '') || /\bUS\b|\bU\.S\./.test(l || ''); // bare "US" is case-sensitive so the word "us" never matches

function locScore(j, p) {
  const want = p.locations || [], mode = p.workMode;
  if (!want.length && mode === 'any') return 1;
  const match = want.length ? locMatch(j.location, want) : true;
  const foreign = want.length > 0 && !match && isForeign(j.location);
  if (mode === 'remote') { // "remote" must be stated by the posting; an unstated work mode is not remote
    if (j.workMode !== 'remote') return 0;
    return foreign ? 0 : match || !want.length ? 1 : 0.8;   // 0.8 = global / unspecified region
  }
  const modeOk = mode === 'any' || j.workMode === mode || j.workMode === 'unknown';
  if (!want.length) return modeOk ? 1 : 0.2;
  if (match) return modeOk ? 1 : 0.4;
  return j.workMode === 'remote' && mode === 'any' && !foreign ? 0.5 : 0;
}

const levelDist = (a, b) => Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(b));
function seniorityScore(j, want) {
  if (!want?.length) return null;
  const set = new Set(want);
  if (j.employmentType === 'intern' && set.has('intern')) return 1;
  if (j.seniorityConf === 'default') return 0.6;
  if (set.has(j.seniority)) return 1;
  const d = Math.min(...want.map(w => levelDist(w, j.seniority)));
  return d === 1 ? 0.3 : 0;
}


// ---- resume fit: how well one posting matches what the resume says ----
const JT = new WeakMap();
// The posting's 25 most telling words (title counts triple, skills double), ignoring filler. Cached per job object.
function jobTerms(j) {
  let t = JT.get(j);
  if (t) return t;
  const f = new Map();
  const add = (text, w) => { for (const x of tokens(text)) if (x.length >= 4 && !isCommonWord(x) && !/^\d/.test(x)) f.set(x, (f.get(x) || 0) + w); };
  add(j.title, 3); add((j.skills || []).join(' '), 2); add((j.desc || '').slice(0, 3500), 1);
  t = [...f.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(e => e[0]);
  JT.set(j, t);
  return t;
}

// resume: a stored profile ({ skills, years, level, families, terms }) or plain text; returns null when there is nothing to compare.
export function resumeCtx(resume) {
  if (typeof resume === 'string') resume = resume.trim() ? { skills: extractSkills(resume), terms: termsOf(resume), years: null, families: [] } : null;
  if (!resume?.skills) return null;
  return { ...resume, skillSet: new Set(resume.skills), termSet: new Set(resume.terms || []) };
}

function resumeFit(j, rc, hay) {
  const parts = {};
  const H = ` ${hay} `;
  const matched = j.skills.filter(s => rc.skillSet.has(s)), missing = j.skills.filter(s => !rc.skillSet.has(s));
  for (const s of rc.skills) { const n = norm(s); if (n && !matched.includes(s) && !j.skills.includes(s) && H.includes(` ${n} `)) matched.push(s); } // skills only the resume lists, but the posting mentions
  const skillHits = j.skills.length - missing.length;
  const sk = j.skills.length ? skillHits / j.skills.length : null;
  if (sk != null) parts.resume = [sk, 18];
  const jt = jobTerms(j);
  if (rc.termSet.size && jt.length >= 5) parts.terms = [Math.min(1, jt.filter(t => rc.termSet.has(t)).length / jt.length / 0.6), sk != null ? 6 : 14];
  if (rc.years != null) { // experience asked vs experience shown
    let e = null;
    if (j.years != null) { const d = rc.years - j.years; e = d >= 0 ? 1 : d >= -1 ? 0.6 : d >= -2 ? 0.3 : 0; }
    else if (j.employmentType === 'intern') e = rc.years <= 1.5 ? 1 : rc.years <= 3 ? 0.5 : 0.2;
    else if (j.seniorityConf !== 'default') { const d = levelDist(rc.level || levelOf(rc.years), j.seniority); e = d === 0 ? 1 : d === 1 ? 0.5 : 0.1; }
    if (e != null) parts.exp = [e, 8];
  }
  if (rc.families?.length && j.family !== 'other') parts.family = [rc.families.includes(j.family) ? 1 : 0.15, 5];
  const W = Object.values(parts).reduce((a, [, w]) => a + w, 0);
  // A fit needs evidence about the posting's content (skills or wording). Without listed skills the ceiling is lower: less proof, less confidence.
  const fit = W && (parts.resume || parts.terms) ? Math.round(100 * Object.values(parts).reduce((a, [v, w]) => a + v * w, 0) / (W + (parts.resume ? 0 : 12))) : null;
  return { parts, matched, missing, fit, skillHits };
}

const DAY = 864e5;
const ageDays = j => (Date.now() - (j.postedAt || j.firstSeen || Date.now())) / DAY;

export function scoreJob(j, p, rc) {
  const hay = norm(`${j.title} ${j.desc}`), titleN = norm(j.title);
  const parts = {}, reasons = [];

  parts.title = [titleRelevance(j.title, p.roles), 35];
  if (p.roles?.length && parts.title[0] >= 0.85) reasons.push(`Title matches “${p.roles.find(r => norm(j.title).includes(norm(r))) || p.roles[0]}”`);

  parts.location = [locScore(j, p), 15];
  if (parts.location[0] === 1 && (p.locations?.length || p.workMode !== 'any')) reasons.push(j.workMode === 'remote' ? 'Remote' : `Location fits (${j.location || j.workMode})`);

  const sen = seniorityScore(j, p.seniority);
  if (sen != null) { parts.seniority = [sen, 15]; if (sen === 1) reasons.push(j.employmentType === 'intern' ? 'Internship' : `Level: ${j.seniority}`); }

  if (p.keywords?.length) {
    const hits = p.keywords.map(k => titleN.includes(norm(k)) ? 1 : hay.includes(norm(k)) ? 0.7 : 0);
    parts.keywords = [hits.reduce((a, b) => a + b, 0) / hits.length, 12];
    const found = p.keywords.filter((_, i) => hits[i]);
    if (found.length) reasons.push(`Keywords: ${found.join(', ')}`);
  }

  if (p.visa === 'need') {
    parts.visa = [{ yes: 1, unknown: 0.5, auth: 0.25, no: 0 }[j.visa], 10];
    if (j.visa === 'yes') reasons.push('Sponsors visas');
    if (j.optCpt) reasons.push('Mentions OPT/CPT');
  }

  const age = ageDays(j);
  parts.fresh = [Math.pow(0.5, Math.max(age, 0) / 21), 8];
  if (age < 3) reasons.push(age < 1 ? 'Posted today' : `Posted ${Math.floor(age)}d ago`);

  let matched = [], missing = [], fit = null;
  if (rc) {
    const r = resumeFit(j, rc, hay);
    matched = r.matched; missing = r.missing; fit = r.fit;
    for (const [k, v] of Object.entries(r.parts)) parts[k] = v;
    if (r.skillHits) reasons.push(`${r.skillHits}/${j.skills.length} of your skills match`);
  }

  if (p.minSalary && j.salary && j.employmentType !== 'intern') {
    parts.salary = [toInr(j.salary.max, j.salary.currency) >= p.minSalary ? 1 : 0, 5];
    if (toInr(j.salary.max, j.salary.currency) >= p.minSalary) reasons.push('Pay meets your minimum');
  }

  const W = Object.values(parts).reduce((a, [, w]) => a + w, 0);
  const score = Math.round(100 * Object.values(parts).reduce((a, [s, w]) => a + s * w, 0) / W);
  return { score, fit, parts: Object.fromEntries(Object.entries(parts).map(([k, [s]]) => [k, +s.toFixed(2)])), reasons, matched, missing };
}

// Hard filters. Returns every filter the job fails (empty = passes).
export function dropReasons(j, p) {
  const r = [];
  if (p.roles?.length && titleRelevance(j.title, p.roles) < 0.5) r.push('role');
  if (p.types?.length && !p.types.includes(j.employmentType)) r.push('type');
  if (p.seniority?.length && seniorityScore(j, p.seniority) === 0) r.push('seniority');
  if (locScore(j, p) < 0.2) r.push('location');
  if (p.visa === 'need' && j.visa === 'no') r.push('visa');
  if (p.postedWithin && j.postedAt && ageDays(j) > p.postedWithin) r.push('age');
  if (p.minSalary && j.salary && j.employmentType !== 'intern' && toInr(j.salary.max, j.salary.currency) < p.minSalary * 0.9) r.push('salary'); // stipends are not compared with a yearly floor
  const hay = norm(`${j.title} ${j.company} ${j.desc}`);
  if (p.keywords?.length && p.keywordMode !== 'boost' && j.hasDesc && !p.keywords.some(k => hay.includes(norm(k)))) r.push('keywords');
  if (p.payOnly && !j.salary) r.push('pay');
  if (p.exclude?.some(x => hay.includes(norm(x)))) r.push('excluded');
  if (j.hasDesc && p.must?.some(x => !hay.includes(norm(x)))) r.push('must-have');
  return r;
}

// A near miss is the right role that fails exactly one soft filter: shown so a strict search never dead-ends.
const SOFT = new Set(['type', 'seniority', 'location', 'age', 'salary', 'visa', 'keywords', 'pay']);

export function rankJobs(jobs, prefs, resume = '') {
  const p = cleanPrefs(prefs);
  const rc = resumeCtx(resume);
  const dropped = {}; const out = []; const near = [];
  for (const j of dedupe(jobs)) {
    const d = dropReasons(j, p);
    if (!d.length) { out.push({ ...j, ...scoreJob(j, p, rc) }); continue; }
    dropped[d[0]] = (dropped[d[0]] || 0) + 1;
    if (d.length === 1 && SOFT.has(d[0])) near.push({ ...j, ...scoreJob(j, p, rc), missed: d[0] });
  }
  out.sort((a, b) => b.score - a.score || (b.postedAt || 0) - (a.postedAt || 0));
  near.sort((a, b) => b.score - a.score);
  return { results: out, near: near.slice(0, 12), dropped, scanned: jobs.length, corrected: p.corrected };
}

// ---- dedupe ----
const ATS_NAMES = new Set(['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'workday']);
export function mergeJob(a, b) {
  const rank = j => (ATS_NAMES.has(j.ats) ? 2 : 1) + (j.hasDesc ? 1 : 0);
  const [keep, other] = rank(b) > rank(a) ? [b, a] : [a, b];
  const seen = new Set(keep.sources.map(s => s.url));
  return {
    ...keep,
    sources: [...keep.sources, ...other.sources.filter(s => !seen.has(s.url))],
    salary: keep.salary || other.salary, postedAt: keep.postedAt || other.postedAt,
    skills: [...new Set([...keep.skills, ...other.skills])],
    firstSeen: Math.min(a.firstSeen || Infinity, b.firstSeen || Infinity) === Infinity ? undefined : Math.min(a.firstSeen || Infinity, b.firstSeen || Infinity),
  };
}

const jac = (x, y) => { const A = new Set(x), B = new Set(y); let i = 0; for (const t of A) if (B.has(t)) i++; return i / (A.size + B.size - i || 1); };

// Exact fingerprint/url merge first, then fuzzy: same company, near-identical title, same place.
export function dedupe(jobs) {
  const byId = new Map();
  for (const j of jobs) byId.set(j.id, byId.has(j.id) ? mergeJob(byId.get(j.id), j) : j);
  const list = [...byId.values()], out = [];
  const byCo = new Map();
  for (const j of list) {
    const co = normCompany(j.company), tt = tokens(normTitle(j.title));
    const peers = byCo.get(co) || [];
    const dup = peers.find(o => jac(o._t, tt) >= 0.85 && (o.location === j.location || !o.location || !j.location || locMatch(o.location, [j.location])));
    if (dup) { Object.assign(dup.job, mergeJob(dup.job, j)); continue; }
    peers.push({ _t: tt, job: j }); byCo.set(co, peers); out.push(j);
  }
  return out;
}
