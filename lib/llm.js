// LLM extraction with Gemini 3.5 Flash-Lite: turns a messy posting into clean structured fields.
// The regex parser in parse.js is the baseline; the model fills gaps and corrects it. Without a key everything still works.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { toInr } from './parse.js';

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const BASE = () => process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com';
// .env wins over a stale system variable, same rule as the TinyFish key
const envFileKey = () => { try { return parseEnv(readFileSync('.env', 'utf8')).GEMINI_API_KEY?.trim(); } catch { return undefined; } };
const key = () => envFileKey() || process.env.GEMINI_API_KEY;
// A fatal error (bad key, no credits) pauses AI reading for 10 minutes so every search doesn't hammer a dead account.
export const llmState = (globalThis.__llmState ??= { until: 0, error: null });
export const llmEnabled = () => !!key() && Date.now() >= llmState.until;
export const llmKeyPresent = () => !!key();
const block = e => { llmState.until = Date.now() + 10 * 60 * 1000; llmState.error = { code: e.code, message: e.message, at: Date.now() }; };
export const llmUsage = (globalThis.__llmUsage ??= { calls: 0, ok: 0, failed: 0, inTokens: 0, outTokens: 0 });
// $0.30 / 1M input, $2.50 / 1M output
export const llmCostUsd = () => +(llmUsage.inTokens * 0.30e-6 + llmUsage.outTokens * 2.50e-6).toFixed(4);

const SYSTEM = `You extract structured data from a single job posting. Reply with ONE JSON object and nothing else.
Rules: use null (or [] / "not_mentioned") when the posting does not say. Never guess or invent. Copy numbers exactly as written.
salary values are full currency units: "18 LPA" or "18 lakh" is min/max 1800000 with period "year"; "₹25,000 per month" is 25000 with period "month"; "1.2 crore" is 12000000.
visa: "sponsors" only if the posting explicitly offers visa sponsorship; "no_sponsorship" only if it explicitly says it does not sponsor; "work_authorization_required" if it only requires existing work authorization; otherwise "not_mentioned".
is_job_posting is false for listing/search pages, blog posts, login or cookie walls, and "position closed / no longer available" pages.
Shape:
{"is_job_posting":boolean,"company":string|null,"title":string|null,"locations":string[],"work_mode":"remote"|"hybrid"|"onsite"|null,
"employment_type":"full_time"|"internship"|"contract"|"part_time"|null,"seniority":"intern"|"entry"|"mid"|"senior"|"lead"|null,
"years_experience_min":number|null,"salary":{"min":number,"max":number,"currency":"INR"|"USD"|"GBP"|"EUR","period":"year"|"month"|"hour"}|null,
"visa":"sponsors"|"no_sponsorship"|"work_authorization_required"|"not_mentioned","skills_required":string[],"skills_nice":string[],
"summary":string,"apply_deadline":string|null}
title: the role name only, without marketing text. summary: at most 25 plain words on what the person will do. Skills: short lowercase names (e.g. "python", "figma").`;

const err = (message, code, status) => Object.assign(new Error(message), { code, status });

async function call(body) {
  const url = `${BASE()}/v1beta/models/${MODEL()}:generateContent`;
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) }); }
    catch (e) { throw err(`Gemini unreachable (${e.message})`, 'ai_net'); }
    if ((res.status === 429 || res.status === 503) && attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j.error?.message || res.statusText;
      if (res.status === 402 || /credits? (are )?(depleted|exhausted)|prepayment|billing/i.test(msg)) throw err('Gemini credits are used up. Add credits in Google AI Studio (aistudio.google.com), then AI reading resumes.', 'ai_credits', 402);
      if (res.status === 403 || /api key|API_KEY/i.test(msg)) throw err(`Gemini rejected the API key (${msg.slice(0, 80)})`, 'ai_auth', res.status);
      if (res.status === 429) throw err('Gemini rate limit reached', 'ai_rate', 429);
      throw err(`Gemini ${res.status}: ${msg.slice(0, 120)}`, 'ai_http', res.status);
    }
    return j;
  }
}

// ---- validation: never trust model output ----
const oneOf = (v, list) => (list.includes(v) ? v : null);
const str = (v, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const strs = (v, max) => [...new Set((Array.isArray(v) ? v : []).map(x => str(x, 40)?.toLowerCase()).filter(Boolean))].slice(0, max);
const CUR = { INR: '₹', USD: '$', GBP: '£', EUR: '€' };

export function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let salary = null;
  const s = raw.salary;
  if (s && Number(s.min) > 0 && Number(s.max) >= Number(s.min) && CUR[s.currency] && ['year', 'month', 'hour'].includes(s.period)) {
    const f = s.period === 'month' ? 12 : s.period === 'hour' ? 2080 : 1;
    const min = Math.round(s.min * f), max = Math.round(s.max * f);
    if (min >= 8000 && toInr(max, CUR[s.currency]) <= 5e8) salary = { min, max, currency: CUR[s.currency], period: s.period };
  }
  const years = Number(raw.years_experience_min);
  return {
    isJob: raw.is_job_posting !== false,
    company: str(raw.company, 80), title: str(raw.title, 140),
    locations: (Array.isArray(raw.locations) ? raw.locations : []).map(l => str(l, 60)).filter(Boolean).slice(0, 6),
    workMode: oneOf(raw.work_mode, ['remote', 'hybrid', 'onsite']),
    employmentType: { full_time: 'fulltime', internship: 'intern', contract: 'contract', part_time: 'parttime' }[raw.employment_type] || null,
    seniority: oneOf(raw.seniority, ['intern', 'entry', 'mid', 'senior', 'lead']),
    years: Number.isFinite(years) && years >= 0 && years <= 30 ? years : null,
    salary,
    visa: { sponsors: 'yes', no_sponsorship: 'no', work_authorization_required: 'auth' }[raw.visa] || 'unknown',
    skillsRequired: strs(raw.skills_required, 12), skillsNice: strs(raw.skills_nice, 8),
    summary: str(raw.summary, 220), deadline: /^\d{4}-\d{2}-\d{2}/.test(raw.apply_deadline || '') ? raw.apply_deadline.slice(0, 10) : null,
  };
}

export async function extractPosting(job) {
  if (!llmEnabled()) return null;
  const host = (() => { try { return new URL(job.url).hostname; } catch { return ''; } })();
  const text = `Title: ${job.title}\nCompany (may be wrong): ${job.company}\nLocation (may be wrong): ${job.location || '-'}\nSource: ${host}\n\nPosting:\n${(job.desc || '').slice(0, 7000)}`;
  llmUsage.calls++;
  try {
    const j = await call({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 900 },
    });
    llmUsage.inTokens += j.usageMetadata?.promptTokenCount || 0;
    llmUsage.outTokens += j.usageMetadata?.candidatesTokenCount || 0;
    const out = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').replace(/^\s*```(?:json)?|```\s*$/g, '').trim();
    const parsed = clean(JSON.parse(out));
    if (!parsed) throw err('Gemini returned an unusable answer', 'ai_parse');
    llmUsage.ok++;
    if (llmState.error) llmState.error = null; // it works again
    return parsed;
  } catch (e) {
    llmUsage.failed++;
    if (e.code === 'ai_credits' || e.code === 'ai_auth') block(e);
    if (e instanceof SyntaxError) throw err('Gemini returned invalid JSON', 'ai_parse');
    throw e;
  }
}

// Merge the model's reading into the baseline job. The model reads the whole context, so it wins on negation-heavy fields (visa)
// and fills what regexes could not find; it never overwrites a title-based seniority or a real company name.
export function applyLlm(job, x) {
  const j = { ...job, llm: { v: 1, at: Date.now(), model: MODEL() } };
  if (!x) return j;
  if (!x.isJob) { j.junk = true; return j; }
  if (x.company && (/^unknown/i.test(j.company) || !/\s/.test(j.company) && j.company.length > 14)) j.company = x.company;
  if (!j.location && x.locations.length) j.location = x.locations.join('; ');
  if (j.workMode === 'unknown' && x.workMode) j.workMode = x.workMode;
  if (x.employmentType && j.employmentType !== 'intern') j.employmentType = x.employmentType;
  if (j.seniorityConf !== 'title' && x.seniority) { j.seniority = x.seniority; j.seniorityConf = 'llm'; }
  if (j.years == null && x.years != null) j.years = x.years;
  if (!j.salary && x.salary) j.salary = x.salary;
  j.visa = x.visa;
  j.skills = [...new Set([...x.skillsRequired, ...j.skills, ...x.skillsNice])].slice(0, 14);
  j.skillsRequired = x.skillsRequired; j.skillsNice = x.skillsNice;
  if (x.summary) j.summary = x.summary;
  if (x.deadline) j.deadline = x.deadline;
  return j;
}
