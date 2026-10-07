// Reads a resume's text: is it really a resume, and what does it say about the person (skills, experience, field)?
// Pure functions, no I/O. The file side (PDF, DOCX) lives in resume.js.
import { extractSkills, roleFamily, tokens } from './parse.js';

// Words that say little about a person or a job: they are ignored when comparing a resume with a posting.
const COMMON = new Set(`about above across after also always among and any are around based been before being between both build building can company
could day days does done each etc every first from get give good great has have help high how including into just keep like looking make many may more most must need
new not now off once only open other our out over own part per people please plus very want was way well were what when where which while who will with within without work
working would year years you your their them they this that these those there than then such some all one two three using use used team teams role roles job jobs position
candidate candidates strong ability experience experienced knowledge skills skill requirements responsibilities qualifications preferred required equal opportunity
employer apply application applications join us we's our's offer benefits salary location remote hybrid onsite full time part`.split(/\s+/));

export const termsOf = (text, max = 1200) => {
  const seen = new Set();
  for (const t of tokens(text)) if (t.length >= 4 && !COMMON.has(t) && !/^\d/.test(t)) { seen.add(t); if (seen.size >= max) break; }
  return [...seen];
};
export const isCommonWord = w => COMMON.has(w);

const HEADS = {
  exp: /^(professional |work |relevant |industry |internship |training )?(experience|employment( history)?|work history|internships?|career (history|summary))( & .*| and .*)?$/i,
  edu: /^(education|academics?|academic (background|qualifications?|profile)|qualifications?|educational (background|qualifications?))( & .*| and .*)?$/i,
  skills: /^((technical|key|core|it|professional) )?(skills?|competenc(y|ies)|expertise|technologies|tools( & technologies| and technologies)?|tech stack)( & .*| and .*)?$/i,
  proj: /^(academic |personal |key )?projects?( & .*| and .*)?$/i,
  summary: /^(professional |career )?(summary|profile|objective|about me|overview)$/i,
  other: /^(certifications?|licen[sc]es?|achievements?|awards?( & honou?rs)?|publications?|languages?|interests|hobbies|positions? of responsibility|extra[- ]?curriculars?|volunteer(ing)?|references?|declaration|courses|activities|leadership)( & .*| and .*)?$/i,
};
const headOf = line => {
  const s = line.replace(/[:\-–—_*#|]+$/g, '').replace(/^[#*\s]+/, '').trim();
  if (s.length < 3 || s.length > 40) return null;
  for (const [k, re] of Object.entries(HEADS)) if (re.test(s)) return k;
  return null;
};

const JD_WORDS = /\b(we are looking for|we(?:'| a)re hiring|responsibilities include|about the role|about us|job description|apply now|equal opportunity employer|what you(?:'|’)ll do|who we are|you will be|the ideal candidate|why join us)\b/gi;
const DEGREE = /\b(b\.?\s?tech|b\.?\s?e\.?|bachelor'?s?|b\.?\s?sc|b\.?\s?com|b\.?\s?a\.?|bca|bba|mca|m\.?\s?tech|m\.?\s?sc|master'?s?|mba|ph\.?\s?d|diploma|degree|university|college|institute|school|cgpa|gpa|percentage|12th|10th|hsc|ssc|b\.?des|m\.?des)\b/i;
const RANGE_AFTER = /\b((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|now|ongoing|till date|today)\b/gi;

// Splits the resume into its sections by headings. Text before the first heading is the "top" (name, contact, headline).
export function sectionsOf(text) {
  const lines = text.split('\n'), out = [{ kind: 'top', lines: [] }];
  for (const l of lines) {
    const k = l.trim() ? headOf(l.trim()) : null;
    if (k) out.push({ kind: k, lines: [], title: l.trim() });
    else out[out.length - 1].lines.push(l);
  }
  return out;
}

// { ok, words, reason }: a resume has sections, contact details, dates and bullets; a job post or an essay does not.
export function checkResumeText(text) {
  const words = (text.match(/\S+/g) || []).length;
  if (words < 60) return { ok: false, words, reason: `This file has only ${words} words, too little to be a resume. A resume lists your experience, education and skills.` };
  if (words > 3500) return { ok: false, words, reason: `This looks like a long document (${words.toLocaleString('en-IN')} words), not a resume. Upload a resume of one to three pages.` };
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters / text.replace(/\s/g, '').length < 0.55) return { ok: false, words, reason: 'Most of this file is numbers or symbols, so it doesn’t look like a resume.' };
  const secs = sectionsOf(text);
  const kinds = new Set(secs.map(s => s.kind).filter(k => k !== 'top'));
  const sectionCount = [...kinds].filter(k => k !== 'other').length + (kinds.has('other') ? 0.5 : 0);
  const contact = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text) || /(\+?\d[\d\s\-()]{8,}\d)/.test(text) || /linkedin\.com|github\.com/i.test(text);
  const dates = (text.match(RANGE_AFTER) || []).length + (text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}\b/gi) || []).length;
  const degree = DEGREE.test(text);
  const bullets = (text.match(/^\s*[•\-–*▪●◦·➢➤✓]\s*\S/gm) || []).length + (text.match(/^\s*[A-Z][a-z]+(?:ed|ing)\b/gm) || []).length;
  const score = (sectionCount >= 2 ? 2 : sectionCount >= 1 ? 1 : 0) + (contact ? 1 : 0) + (dates >= 1 ? 1 : 0) + (degree ? 1 : 0) + (bullets >= 3 ? 1 : 0);
  const jd = (text.match(JD_WORDS) || []).length;
  if (jd >= 3 && sectionCount < 2) return { ok: false, words, reason: 'This looks like a job description, not a resume. Upload your own resume to see how you fit.' };
  if (score < 3 || (!sectionCount && !dates)) return { ok: false, words, reason: 'This doesn’t look like a resume. We couldn’t find sections such as Experience, Education or Skills, or any work dates.' };
  return { ok: true, words, score };
}

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DT = String.raw`(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+|(\d{1,2})[/.]\s*)?((?:19|20)\d{2})`;
const SPAN = new RegExp(`${DT}\\s*(?:-|–|—|to)\\s*(?:${DT}|(present|current|now|ongoing|till date|today))`, 'gi');
const monthIdx = (name, num) => name ? MON[name.toLowerCase().slice(0, 3)] : num && +num >= 1 && +num <= 12 ? +num - 1 : null;

// Months of work history: the union of the date ranges in the experience section, so overlapping jobs count once.
function experienceYears(text, now) {
  const secs = sectionsOf(text);
  let body = secs.filter(s => s.kind === 'exp').map(s => s.lines.join('\n')).join('\n');
  if (!body) body = secs.filter(s => !['edu', 'top', 'skills', 'proj'].includes(s.kind)).map(s => s.lines.join('\n')).join('\n'); // no heading found: skip education
  const nowIdx = now.getFullYear() * 12 + now.getMonth(), spans = [];
  for (const m of body.matchAll(SPAN)) {
    const a = +m[3] * 12 + (monthIdx(m[1], m[2]) ?? 0);
    const b = m[7] ? nowIdx : +m[6] * 12 + (monthIdx(m[4], m[5]) ?? 11);
    if (b >= a && b - a <= 12 * 40 && a <= nowIdx + 1) spans.push([a, Math.min(b, nowIdx)]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let months = 0, cur = null;
  for (const s of spans) { if (!cur || s[0] > cur[1]) { if (cur) months += cur[1] - cur[0] + 1; cur = [...s]; } else cur[1] = Math.max(cur[1], s[1]); }
  if (cur) months += cur[1] - cur[0] + 1;
  if (months) return Math.round(months / 12 * 10) / 10;
  const said = text.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b[^.\n]{0,40}?experience/i);   // "5+ years of experience"
  return said && +said[1] <= 40 ? +said[1] : 0;
}

// Skills written in the resume's own Skills section ("Languages: Python, Java"), beyond the built-in skill list.
function listedSkills(text) {
  const out = new Set();
  for (const s of sectionsOf(text)) {
    if (s.kind !== 'skills') continue;
    for (const line of s.lines) for (const item of line.replace(/^[^:]{2,30}:/, '').split(/[,;|•·●▪◦\/]|\s{2,}/)) {
      const v = item.replace(/[()]/g, '').replace(/^[\s\-–*]+|[\s.]+$/g, '').toLowerCase();
      if (v.length >= 2 && v.length <= 28 && v.split(/\s+/).length <= 3 && /^[a-z0-9+#.\s\-&]+$/.test(v) && !/^\d+$/.test(v) && !COMMON.has(v)) out.add(v);
    }
  }
  return [...out].slice(0, 50);
}

export const levelOf = years => (years == null ? null : years <= 1 ? 'entry' : years <= 4 ? 'mid' : years <= 7 ? 'senior' : 'lead');

// Everything the ranking and the fit analysis need from a resume. `text` is kept so a language model can read the original.
export function buildProfile(text, now = new Date()) {
  const secs = sectionsOf(text);
  const listed = listedSkills(text);
  const known = extractSkills(text);
  const years = experienceYears(text, now);
  const fam = {};
  const titleLines = [...secs.filter(s => s.kind === 'exp').flatMap(s => s.lines), ...secs[0].lines.slice(0, 6)]
    .map(l => l.trim()).filter(l => l && l.length < 90 && !/^[•\-–*▪●◦·]/.test(l));
  for (const l of titleLines) { const f = roleFamily(l); if (f !== 'other') fam[f] = (fam[f] || 0) + 1; }
  const families = Object.entries(fam).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  return {
    skills: [...new Set([...known, ...listed])].slice(0, 60), years, level: levelOf(years), families,
    terms: termsOf(text), words: (text.match(/\S+/g) || []).length,
    sections: [...new Set(secs.map(s => s.kind).filter(k => k !== 'top'))],
  };
}
