// Browser-side helpers: API calls, NDJSON streaming, formatters. Imported only by client components.
const OFFLINE = 'Can’t reach Scout’s server. Is it still running?';

export async function api(path, method = 'GET', body) {
  let r;
  try { r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error(OFFLINE); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export async function stream(path, body, onEvent) {
  let r;
  try { r = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error(OFFLINE); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`);
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onEvent(JSON.parse(l)); }
  }
}

export const LEVELS = [['intern', 'Intern'], ['entry', 'Fresher / Entry'], ['mid', 'Mid (2–5 yrs)'], ['senior', 'Senior (5+ yrs)'], ['lead', 'Lead / Manager+']];
export const TYPES = [['fulltime', 'Full-time'], ['intern', 'Internship'], ['contract', 'Contract'], ['parttime', 'Part-time']];
export const MODES = [['any', 'Any'], ['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'On-site']];
export const STAGES = [['saved', 'Saved'], ['applied', 'Applied'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Rejected']];
export const VISA = { yes: ['Sponsors visa', 'good'], no: ['No sponsorship', 'bad'], auth: ['Work auth required', 'warn'] };

export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
export const ago = t => { if (!t) return ''; const d = (Date.now() - t) / 864e5; return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? `${Math.floor(d)}d ago` : `${Math.floor(d / 30)}mo ago`; };
const FX = { '$': 85, '£': 105, '€': 92, '₹': 1 }; // approximate INR per unit
const inr = (v, c) => v * (FX[c] || 1);
const lakh = n => { const l = n / 1e5; return String(l < 10 ? +l.toFixed(1) : Math.round(l)); };
const crore = n => String(+(n / 1e7).toFixed(1));
// Indian pay format: yearly in LPA / crore, internship stipends per month. Foreign pay is converted and marked approximate.
export const money = s => {
  if (!s) return '';
  const lo = inr(s.min, s.currency), hi = inr(s.max, s.currency), approx = s.currency === '₹' ? '' : '≈ ';
  if (s.period === 'month') return `${approx}₹${Math.round(lo / 12000)}k–${Math.round(hi / 12000)}k/month`;
  if (hi >= 1e7) return `${approx}₹${crore(lo)}–${crore(hi)} Cr/yr`;
  return `${approx}₹${lakh(lo)}–${lakh(hi)} LPA`;
};
export const moneyMid = s => s ? inr((s.min + s.max) / 2, s.currency) : 0;
export const lpa = v => v >= 1e7 ? `₹${crore(v)} Cr/yr` : `₹${lakh(v)} LPA`;
export const num = n => Number(n || 0).toLocaleString('en-IN');
export const dateIN = t => t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const DROP_LABEL = { role: 'other roles', seniority: 'wrong level', location: 'other locations', age: 'older than your date limit', type: 'other job types', salary: 'below your pay floor', visa: 'no sponsorship', excluded: 'matched your exclusions', keywords: 'mention none of your keywords', pay: 'list no pay', 'must-have': 'missing a must-have' };
export const scoreColor = s => s >= 75 ? 'var(--good)' : s >= 50 ? 'var(--brand)' : 'var(--warn)';
export const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
export const shortLoc = l => { const p = (l || '').split(/;\s*/); return p.length > 2 ? `${p.slice(0, 2).join('; ')} +${p.length - 2} more` : l; };

export function exportCsv(list) {
  const rows = [['match_%', 'title', 'company', 'location', 'work_mode', 'level', 'type', 'visa', 'pay', 'posted', 'apply_url']];
  list.forEach(j => rows.push([j.score, j.title, j.company, j.location, j.workMode, j.seniority, j.employmentType, j.visa, money(j.salary), j.postedAt ? dateIN(j.postedAt) : '', j.url]));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'scout-jobs.csv';
  a.click();
}

export const EXAMPLES = [
  { label: 'Software engineer · Bengaluru', roles: ['Software Engineer'], locations: ['Bengaluru'] },
  { label: 'Data analyst · Hyderabad', roles: ['Data Analyst'], locations: ['Hyderabad'], seniority: ['entry'] },
  { label: 'Design internship · Delhi NCR', roles: ['Product Designer'], locations: ['Delhi'], seniority: ['intern'] },
  { label: 'Remote jobs in India', roles: ['Software Engineer'], locations: ['India'], workMode: 'remote' },
];

export const SUGGESTED_COMPANIES = ['Razorpay', 'Zerodha', 'CRED', 'Swiggy', 'Freshworks', 'Postman', 'Groww', 'Zoho'];

// What to loosen when a filter removes everything: label + the preference patch.
export const RELAX = {
  location: ['Any location', () => ({ locations: [], workMode: 'any' })],
  seniority: ['Any level', () => ({ seniority: [] })],
  type: ['Any job type', () => ({ types: [] })],
  visa: ['No visa requirement', () => ({ visa: 'any' })],
  age: ['Any posting date', () => ({ postedWithin: 0 })],
  salary: ['Ignore pay floor', () => ({ minSalary: 0 })],
  keywords: ['Treat keywords as a boost only', () => ({ keywordMode: 'boost' })],
  pay: ['Include jobs that don’t list pay', () => ({ payOnly: false })],
  excluded: ['Clear exclusions', () => ({ exclude: [] })],
  'must-have': ['Clear must-haves', () => ({ must: [] })],
};

// Many postings carry marketing text after a pipe: "UI/UX Intern | Entry Level | Fresher | Figma…". Show the role, keep the rest in the tooltip.
export const cleanTitle = t => { const c = (t || '').split(/\s[|•]\s/)[0].trim(); return c.length >= 4 ? c : t; };
