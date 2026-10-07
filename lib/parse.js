// Feature engineering: turn raw posting text into structured, comparable fields.
import { createHash } from 'node:crypto';

// Bump when extraction improves: jobs stored by an older parser are re-read on the next search instead of staying wrong.
export const PARSE_VERSION = 2;

export const LEVELS = ['intern', 'entry', 'mid', 'senior', 'lead'];
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'in', 'at', 'to', 'with', '&']);

export const norm = s => (s || '').toLowerCase().replace(/[^\p{L}\p{N}+#\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export const tokens = s => norm(s).split(' ').filter(w => w && !STOP.has(w));
export const humanize = s => (s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
export const normTitle = t => norm((t || '').replace(/\([^)]*\)/g, ' ').replace(/[-–|]\s*(remote|hybrid)\s*$/i, ''));
export const normCompany = c => norm(c).replace(/\b(inc|llc|ltd|gmbh|corp|corporation|co|company|plc)\b/g, '').replace(/\s+/g, ' ').trim();
const normLoc = l => /remote|anywhere/i.test(l || '') ? 'remote' : norm((l || '').split(/[,;|/]/)[0]);

export const fingerprint = (company, title, loc) =>
  createHash('sha1').update(`${normCompany(company)}|${normTitle(title)}|${normLoc(loc)}`).digest('hex').slice(0, 16);

export function canonicalUrl(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (!/^(gh_jid|jid|id|jobid)$/i.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return x.toString().replace(/\/$/, '');
  } catch { return u; }
}

// ---- role family ----
const FAMILIES = [
  ['ml', /machine learning|\bml\b|\bai\b|artificial intelligence|deep learning|\bnlp\b|computer vision|\bllm\b|applied scientist|research scientist|research engineer/],
  ['de', /data engineer|analytics engineer|\betl\b|data platform|big data/],
  ['ds', /data scien|data analy|business analy|\bbi\b|analytics|statistic|quantitative/],
  ['mobile', /android|\bios\b|mobile|react native|flutter/],
  ['devops', /devops|\bsre\b|site reliability|platform engineer|infrastructure|cloud engineer|systems engineer/],
  ['security', /security|appsec|pentest|infosec|cyber/],
  ['qa', /\bqa\b|quality assurance|test engineer|\bsdet\b|automation engineer/],
  ['design', /design|\bux\b|\bui\b/],
  ['pm', /product manager|product management|program manager|product owner|\bpm\b/],
  ['sales', /sales|account executive|\bsdr\b|\bbdr\b|business development|customer success|solutions? engineer/],
  ['swe', /software|developer|engineer|backend|back-end|frontend|front-end|full[- ]?stack|\bsde\b|\bswe\b|programmer/],
  ['marketing', /marketing|growth|\bseo\b|content|brand|communications|social media/],
  ['hr', /recruit|talent|people partner|people ops|human resources|\bhr\b/],
  ['finance', /financ|accountant|accounting|audit|investment|banker|controller/],
  ['ops', /operations|supply chain|logistics|support|administrat/],
];
export const roleFamily = t => { const s = (t || '').toLowerCase(); for (const [f, re] of FAMILIES) if (re.test(s)) return f; return 'other'; };

// ---- seniority / type / years ----
export function extractYears(desc = '') {
  const m = desc.match(/(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b[^.\n]{0,45}?(?:experience|exp\b)/i)
    || desc.match(/experience[^.\n]{0,25}?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i);
  const n = m ? +m[1] : null;
  return n != null && n <= 25 ? n : null;
}

export function detectSeniority(title = '', years = null) {
  const t = title.toLowerCase();
  if (/\b(intern|internship|co-?op|trainee|working student|werkstudent|apprentice)\b/.test(t)) return ['intern', 'title'];
  if (/\b(staff|principal|distinguished|architect|head of|director|vp|vice president|chief|lead|fellow)\b|(?<!product |program |project |account |customer |marketing |community |content |social media |office |general |territory )manager/.test(t)) return ['lead', 'title'];
  if (/\b(senior|sr\.?|iii|iv)\b|\b3$/.test(t)) return ['senior', 'title'];
  if (/\b(new grad|graduate|entry[- ]level|junior|jr\.?|early career|associate|university)\b|\b(i|1)$/.test(t)) return ['entry', 'title'];
  if (/\bii\b|\bmid[- ]level\b|\b2$/.test(t)) return ['mid', 'title'];
  if (years != null) return [years <= 1 ? 'entry' : years <= 4 ? 'mid' : years <= 7 ? 'senior' : 'lead', 'years'];
  return ['mid', 'default'];
}

export function detectType(title = '', raw = '') {
  const s = `${raw} ${title}`.toLowerCase();
  if (/\b(intern|internship|co-?op|working student)\b/.test(s)) return 'intern';
  if (/contract|contractor|freelance|temporary|fixed[- ]term/.test(s)) return 'contract';
  if (/part[- ]time/.test(s)) return 'parttime';
  return 'fulltime';
}

export function detectWorkMode(title = '', loc = '', workplace = '', desc = '') {
  const s = `${workplace} ${title} ${loc}`.toLowerCase();
  if (/hybrid/.test(s)) return 'hybrid';
  if (/remote|anywhere|work from home|distributed/.test(s)) return 'remote';
  if (/on-?site|in[- ]office/.test(s)) return 'onsite';
  const d = desc.slice(0, 2500).toLowerCase();
  if (/\bhybrid\b/.test(d)) return 'hybrid';
  if (/fully remote|100% remote|remote[- ]first|work[- ]from[- ]home|this (?:is a )?remote|remote position/.test(d)) return 'remote';
  if (/on-?site|in[- ]office/.test(d)) return 'onsite';
  return 'unknown';
}

// ---- visa ----
const NO_VISA = /\b(?:no|not (?:able|eligible|offer(?:ing)?|provid(?:e|ing)|sponsor(?:ing)?)|unable|cannot|can't|won't|will not|do not|don't|does not|doesn't)\b[^.\n]{0,40}\bsponsor|sponsorship (?:is )?(?:not|unavailable)|without (?:the need for )?(?:current or future )?(?:visa )?sponsorship|(?:u\.?s\.?|us) citizen(?:ship)?s? (?:only|required)|security clearance (?:is )?required/i;
const AUTH_VISA = /must (?:already )?(?:be|have) (?:legally |currently )?(?:authori[sz]ed|eligible|permission)[^.\n]{0,60}work|(?:legal|valid) (?:right|authori[sz]ation) to work/i;
const YES_VISA = /(?:visa|h-?1b|work permit)[^.\n]{0,30}sponsorship[^.\n]{0,30}(?:available|provided|offered|supported|possible)|\b(?:we|company|will)\b[^.\n]{0,20}sponsor(?:s|ing)?\b[^.\n]{0,20}(?:visa|work permit|h-?1b)|sponsorship (?:is )?(?:available|provided|offered)|relocation (?:and|&|\+) visa|visa support|\bvisa sponsor/i;
export function detectVisa(text = '') {
  if (NO_VISA.test(text)) return 'no';
  if (YES_VISA.test(text)) return 'yes';
  if (AUTH_VISA.test(text)) return 'auth';
  return 'unknown';
}
export const detectOptCpt = t => /\b(stem[- ]opt|opt\b|cpt\b)/i.test(t || '');

// ---- salary (₹ LPA / lakh / crore / monthly stipend, plus $ £ €) ----
export const FX = { '$': 85, '£': 105, '€': 92, '₹': 1 }; // approximate INR per unit, for comparing and display only
export const toInr = (v, cur) => v * (FX[cur] || 1);
const MULT = { k: 1e3, m: 1e6, l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, lpa: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };
const mult = u => MULT[(u || '').toLowerCase()] || 1;
// regex fragments built from literals so the escapes stay intact
const CUR = /(\$|£|€|₹|INR|Rs\.?)/.source, NUM = /(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)/.source, UNIT = /(k|m|l|lakhs?|lacs?|lpa|cr|crores?)/.source;
const SAL = new RegExp(`${CUR}\\s?${NUM}\\s*${UNIT}?\\s*(?:-|–|—|to)\\s*(?:${CUR}\\s?)?${NUM}\\s*${UNIT}?(?:\\s*(?:\\/|per\\s)?\\s*(hr|hour|yr|year|annum|month|mo)\\b)?`, 'i');
const LPA = /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(lpa|lakhs?(?:\s*per\s*annum)?|lacs?)/i;
const sym = c => (/^(inr|rs)/i.test(c) ? '₹' : c);

// Returns annualised {min,max,currency,period}; period is how the employer quoted it (year | month | hour).
export function parseSalary(s = '') {
  let cur, a, b, per = '';
  const m = s.match(SAL);
  if (m) {
    cur = sym(m[1]); a = +m[2].replace(/,/g, ''); b = +m[5].replace(/,/g, ''); per = (m[7] || '').toLowerCase();
    const mb = mult(m[6]); let ma = mult(m[3]);
    if (!m[3] && mb > 1 && a < 1000) ma = mb;      // "$120-160k", "₹6-10 LPA"
    a *= ma; b *= mb;
  } else {
    const l = s.match(LPA);
    if (!l) return null;
    cur = '₹'; a = +l[1] * 1e5; b = +l[2] * 1e5;
  }
  const f = /hr|hour/.test(per) ? 2080 : /^(month|mo)$/.test(per) ? 12 : 1;
  a *= f; b *= f;
  if (a > b) [a, b] = [b, a];
  if (a < 8000 || toInr(b, cur) > 5e8) return null;
  return { min: Math.round(a), max: Math.round(b), currency: cur, period: f === 12 ? 'month' : f === 2080 ? 'hour' : 'year' };
}

// ---- skills ----
const SKILLS = ['python', 'java', 'javascript|js', 'typescript|ts', 'golang', 'rust', 'c++', 'c#', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'sql', 'react', 'next.js', 'vue', 'angular', 'node.js|nodejs', 'django', 'flask', 'fastapi', 'spring', 'rails', 'graphql', 'grpc', 'docker', 'kubernetes|k8s', 'terraform', 'aws', 'gcp', 'azure', 'linux', 'git', 'ci/cd', 'kafka', 'spark', 'hadoop', 'airflow', 'dbt', 'snowflake', 'bigquery', 'postgresql|postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'pytorch', 'tensorflow', 'scikit-learn|sklearn', 'pandas', 'numpy', 'machine learning|ml', 'deep learning', 'nlp', 'llm|llms', 'computer vision', 'reinforcement learning', 'data analysis', 'data engineering', 'statistics', 'tableau', 'power bi', 'excel', 'figma', 'ux research', 'product management', 'agile', 'scrum', 'jira', 'seo', 'a/b testing', 'android', 'ios', 'react native', 'flutter', 'embedded', 'verilog', 'matlab', 'solidity', 'cybersecurity', 'devops', 'microservices', 'system design', 'distributed systems', 'rag', 'langchain', 'prompt engineering', 'mlops', 'rest apis?', 'html', 'css', 'tailwind', 'salesforce', 'sap', 'looker', 'etl'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const SK = SKILLS.map(s => { const alts = s.split('|'); return [alts[0].replace('?', ''), new RegExp(`(?<![\\w])(?:${alts.map(a => esc(a).replace('\\?', '?')).join('|')})(?![\\w])`, 'i')]; });
const GO = /\bGo\b(?=\s*(?:,|\/|\)|and\b|or\b|programming|lang))/, RLANG = /\bR\b(?=\s*(?:,|\/|\)|and\b|programming))/;
export function extractSkills(text = '') {
  const out = SK.filter(([, re]) => re.test(text)).map(([n]) => n);
  if (GO.test(text) && !out.includes('golang')) out.push('golang');
  if (RLANG.test(text)) out.push('r');
  return out;
}

const cleanTitle = t => (t || '').replace(/\s+/g, ' ').replace(/^job application for\s+/i, '').trim();
const ago = t => { const n = typeof t === 'number' ? t : Date.parse(t); return Number.isFinite(n) && n > 0 && n < Date.now() + 864e5 ? n : null; };

// Build the canonical job object from whatever a source gave us.
export function buildJob(r) {
  const title = cleanTitle(r.title), desc = (r.desc || '').replace(/\n{3,}/g, '\n\n').trim();
  const loc = (r.location || '').replace(/\s+/g, ' ').trim();
  const company = (r.company || '').trim() || 'Unknown company';
  const years = extractYears(desc);
  const [seniority, seniorityConf] = detectSeniority(title, years);
  const sal = r.salaryRange ? { min: r.salaryRange.min, max: r.salaryRange.max, currency: { USD: '$', INR: '₹', GBP: '£', EUR: '€' }[r.salaryRange.currency] || '$', period: 'year' }
    : parseSalary(r.comp || '') || parseSalary(desc);
  return {
    id: fingerprint(company, title, loc), company, title, location: loc, url: r.url,
    workMode: detectWorkMode(title, loc, r.workplace, desc),
    employmentType: detectType(title, r.employmentType),
    seniority, seniorityConf, years, family: roleFamily(title),
    visa: detectVisa(desc), optCpt: detectOptCpt(desc),
    salary: sal, skills: extractSkills(`${title}\n${desc}`),
    desc: desc.slice(0, 7000), hasDesc: desc.length > 250,
    postedAt: ago(r.postedAt), ats: r.ats || null, department: r.department || null,
    sources: [{ name: r.source || r.ats || 'web', url: r.url }], pv: PARSE_VERSION,
  };
}

// Aggregator page titles carry the company and place: "Timble is hiring Frontend Developer job in Delhi" /
// "Front End Internship in Delhi at EkoSight". Returns whatever could be read, or null.
export function parseListingTitle(t = '') {
  t = t.replace(/\s+/g, ' ').trim();
  let m = t.match(/^(.+?) is hiring (?:via .+? )?(.+?)(?: jobs?| internship)?(?: in (.+?))?(?: \||\.| - |$)/i);
  if (m && m[1].length < 70) return { company: /^(confidential|leading )/i.test(m[1]) ? null : m[1].trim(), title: m[2].trim(), location: m[3]?.trim() || null }; // anonymous employers stay unnamed
  m = t.match(/^(.+?) in (.+?) at (.+?)(?: \||$)/i);
  if (m) return { title: m[1].trim(), location: m[2].trim(), company: m[3].trim() };
  return null;
}
