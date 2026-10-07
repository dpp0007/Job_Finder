// Input validation for every field that reaches the search: only job-related text gets through.
// Pure functions shared by the browser (instant inline errors) and the server (the real gate).
import { isKnownWord } from './typos.js';

export const LIMITS = { roles: 5, locations: 8, keywords: 12, must: 6, exclude: 12 };
const KIND = {
  roles: { max: 60, words: 7, what: 'a job title', example: 'Data Analyst' },
  locations: { max: 50, words: 5, what: 'a city, state or country', example: 'Pune' },
  keywords: { max: 40, words: 4, what: 'a skill or keyword', example: 'python' },
};
KIND.must = KIND.exclude = KIND.keywords;

const UNSAFE = /https?:\/\/|www\.|\S+@\S+\.\S+|[{}<>\\`$]|javascript:|ignore (all |any |the |previous )|system prompt|drop table|select .+ from/i;
const QUESTION = /^(how|what|why|who|when|where|can|could|would|please|tell|write|show|give|explain|do you|are you)\b|\?\s*$/i;
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

// Does a word look like language rather than keyboard mashing? Known job and place words always pass.
function plausible(word) {
  const w = word.toLowerCase();
  if (w.length <= 3 || isKnownWord(w) || /\d/.test(w) || (word === word.toUpperCase() && w.length <= 6)) return true; // short acronyms: SAP, HDFC, SDET
  if (/(.)\1{3,}/.test(w) || /[^aeiouy]{6,}/.test(w) || w.length > 24) return false;
  for (const t of [w, [...w].reverse().join('')]) for (let i = 0; i + 4 <= t.length; i++) if (ROWS.some(r => r.includes(t.slice(i, i + 4)))) return false; // keyboard rows: asdf, qwer
  const v = (w.match(/[aeiouy]/g) || []).length;
  return v > 0 && v / w.length >= 0.15;
}

// One search term. Returns { ok, value } or { ok: false, error }.
export function checkTerm(kind, raw) {
  const k = KIND[kind];
  const value = String(raw ?? '').replace(/\s+/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '');
  if (!value) return { ok: false, error: '' };
  const need = `Enter ${k.what}, like “${k.example}”.`;
  if (value.length > k.max || value.split(' ').length > k.words) return { ok: false, error: `That’s too long for ${k.what}. ${need}` };
  if (UNSAFE.test(value)) return { ok: false, error: `Links, emails and code aren’t ${k.what}. ${need}` };
  if (QUESTION.test(value)) return { ok: false, error: `That reads like a question, not ${k.what}. ${need}` };
  const letters = (value.match(/\p{L}/gu) || []).length;
  if (letters < 1 || (value.length > 4 && (letters < 2 || letters / value.replace(/\s/g, '').length < 0.6)) || !/^[\p{L}\p{N}\s&/+#.,'’()\-–]+$/u.test(value)) return { ok: false, error: `“${value.slice(0, 30)}” isn’t ${k.what}. ${need}` };
  const bad = value.split(/[\s/&,()\-–]+/).map(t => t.replace(/[^\p{L}]/gu, '')).find(t => t.length > 3 && !plausible(t));
  if (bad) return { ok: false, error: `“${bad}” doesn’t look like ${k.what}. Check the spelling.` };
  return { ok: true, value };
}

// A company on the watchlist: a name, or a careers link.
export function checkCompany(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, error: '' };
  if (/^[a-z]+:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return { ok: false, error: 'Only web links (http or https) work here. Paste a careers page, like https://razorpay.com/jobs.' };
  if (/^https?:\/\//i.test(value)) {
    try { const u = new URL(value); if (/^[\w-]+(\.[\w-]+)+$/.test(u.hostname) && !/\s/.test(value) && !u.username && !u.password && !/^\d+(\.\d+){3}$/.test(u.hostname) && !/\.(local|internal|localhost|lan)$/i.test(u.hostname)) return { ok: true, value }; } catch { /* fall through */ }
    return { ok: false, error: 'That link doesn’t look right. Paste a company’s careers page, like https://razorpay.com/jobs.' };
  }
  if (value.length > 60 || /[{}<>\\`$]|@|ignore (all |previous)|system prompt/i.test(value) || QUESTION.test(value)) return { ok: false, error: 'Enter a company name, like “Razorpay”, or its careers link.' };
  const letters = (value.match(/\p{L}/gu) || []).length;
  if (letters < 2 || letters / value.replace(/\s/g, '').length < 0.5) return { ok: false, error: 'Enter a company name, like “Razorpay”, or its careers link.' };
  const bad = value.split(/\s+/).find(t => t.length > 5 && t === t.toLowerCase() && /^[a-z]+$/.test(t) && !plausible(t));
  if (bad) return { ok: false, error: `“${bad}” doesn’t look like a company name. Check the spelling.` };
  return { ok: true, value };
}

const MODES = ['any', 'remote', 'hybrid', 'onsite'], LV = ['intern', 'entry', 'mid', 'senior', 'lead'], TY = ['fulltime', 'intern', 'contract', 'parttime'];
const AGE = [0, 1, 3, 7, 14, 30], DEPTHS = ['quick', 'standard', 'deep'];
const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
const subset = (v, allowed) => (Array.isArray(v) ? [...new Set(v.filter(x => allowed.includes(x)))] : []);

// Cleans a whole preferences object. Bad terms are dropped and listed in `errors`; nothing out of range survives.
export function sanitizePrefs(input) {
  const p = input && typeof input === 'object' ? input : {};
  const errors = [];
  const list = field => {
    const out = [];
    for (const raw of Array.isArray(p[field]) ? p[field] : []) {
      const r = checkTerm(field, raw);
      if (!r.ok) { if (r.error) errors.push({ field, value: String(raw), message: r.error }); continue; }
      if (!out.some(x => x.toLowerCase() === r.value.toLowerCase())) out.push(r.value);
    }
    if (out.length > LIMITS[field]) { errors.push({ field, value: '', message: `Use at most ${LIMITS[field]} entries here.` }); out.length = LIMITS[field]; }
    return out;
  };
  let minSalary = Math.round(Number(p.minSalary) || 0);
  if (minSalary < 0) minSalary = 0;
  if (minSalary > 1e8) { errors.push({ field: 'minSalary', value: String(p.minSalary), message: 'That pay floor is too high. Enter it in lakhs per year (LPA), like 12.' }); minSalary = 0; }
  const prefs = {
    roles: list('roles'), locations: list('locations'), keywords: list('keywords'), must: list('must'), exclude: list('exclude'),
    workMode: pick(p.workMode, MODES, 'any'), seniority: subset(p.seniority, LV), types: subset(p.types, TY),
    visa: pick(p.visa, ['any', 'need'], 'any'), minSalary, postedWithin: pick(Number(p.postedWithin), AGE, 0),
    portals: (Array.isArray(p.portals) ? p.portals : []).filter(x => typeof x === 'string' && /^[a-z]{2,20}$/.test(x)).slice(0, 12),
    depth: pick(p.depth, DEPTHS, 'standard'), keywordMode: pick(p.keywordMode, ['any', 'boost'], 'any'), payOnly: p.payOnly === true,
  };
  return { prefs, errors };
}

// For routes that start work: refuse out-of-context input with a message the person can act on.
export function assertPrefs(input) {
  const { prefs, errors } = sanitizePrefs(input);
  if (errors.length) throw Object.assign(new Error(errors[0].message), { status: 400 });
  return prefs;
}

// Identifiers that arrive from the browser are checked before they reach a database or a URL.
export const isJobId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(v);
export const isNumId = v => Number.isSafeInteger(Number(v)) && Number(v) > 0 && String(v).length < 20;
export const STAGES = ['saved', 'applied', 'interview', 'offer', 'rejected', 'hidden'];
