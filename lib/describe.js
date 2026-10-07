// Turns scraped posting text (markdown-ish, different on every site) into clean structure:
// a facts strip (start date, pay, experience…) plus headings, paragraphs, lists and skill chips. Pure: no React, no I/O.

const FACT_LABELS = [
  [/^start date$/i, 'Starts'], [/^(annual )?ctc( \(annual\))?$/i, 'Pay'], [/^stipend$/i, 'Stipend'], [/^salary$/i, 'Salary'],
  [/^experience$/i, 'Experience'], [/^apply by$/i, 'Apply by'], [/^duration$/i, 'Duration'], [/^(number of )?openings$/i, 'Openings'],
  [/^job type$/i, 'Type'], [/^location$/i, 'Location'],
];
const labelOf = s => { for (const [re, name] of FACT_LABELS) if (re.test(s)) return name; return null; };
const BOILER = /^(back to jobs|apply( now| here| for this job)?|actively hiring|share( this job)?|report( this job)?|sign in|log ?in|register|home|company|save job|view all jobs|similar jobs|earn certifications in these skills|posted by .*)$/i;
const TYPE_LINE = /^(job|internship|full[- ]time|part[- ]time|contract)$/i;
const BULLET = /^([*\-•·▪◦●])\s+(.*)$/;
const NUMBERED = /^(\d{1,2})[.)]\s+(.*)$/;
const EMOJI_HEAD = /^[\p{Extended_Pictographic}][️‍]?\s*\S.{1,48}$/u;
// Plain-text section labels some sites print without any markup ("Who can apply", "Requirements")
const HEADISH = /^(who|what|how|why|about|requirements?|qualifications?|benefits|perks|eligibility|responsibilities|other|additional|key)\b/i;
const SKILLS_HEAD = /^skill\(?s?\)?( required)?:?$/i;

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function parseDescription(raw = '', title = '') {
  const text = raw.replace(/\r/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                               // images
    .replace(/\\([_*\[\]()#+\-.!`~>|])/g, '$1');                        // markdown escapes (\_ etc.)
  const lines = text.split('\n');

  // ---- 1. clean: drop boilerplate, collapse repeats, strip the "Learn X" upsell that follows a certifications line ----
  const clean = [];
  let afterCert = false;
  for (const l of lines) {
    const s = l.trim();
    if (/^earn certifications in these skills$/i.test(s)) { afterCert = true; continue; }
    if (afterCert && (!s || /^learn .{2,40}$/i.test(s))) continue;
    afterCert = false;
    if (s && BOILER.test(s)) continue;
    clean.push({ s, hb: l !== s && /\S {2,}$/.test(l) });
  }
  const dedup = [];
  let prev = null;
  for (const l of clean) { if (l.s && l.s === prev) continue; dedup.push(l); if (l.s) prev = l.s; }

  // ---- 2. facts: "Label" / "value" pairs and "Label: value" lines ----
  const facts = [], seen = new Set();
  const addFact = (label, value) => { value = (value || '').replace(/\s+/g, ' ').trim(); if (label && value && !seen.has(label)) { seen.add(label); facts.push({ label, value }); } };
  const body = [];
  for (let i = 0; i < dedup.length; i++) {
    const s = dedup[i].s;
    if (!s) { body.push(dedup[i]); continue; }
    const inline = s.match(/^([A-Za-z ()]{3,24}):\s+(\S.*)$/);
    if (inline && labelOf(inline[1].trim()) && !/^#/.test(s)) { addFact(labelOf(inline[1].trim()), inline[2]); continue; }
    const lab = labelOf(s.replace(/^#{1,6}\s+/, ''));
    if (lab) {
      let j = i + 1;
      while (j < dedup.length && !dedup[j].s) j++;
      if (j < dedup.length && !labelOf(dedup[j].s) && !/^#/.test(dedup[j].s) && !/:$/.test(dedup[j].s) && dedup[j].s.length < 80) {
        let value = dedup[j].s, k = j + 1;                                // the site often repeats the value, sometimes extended ("₹ 2,00,000" / "₹ 2,00,000 /year")
        for (;;) { let n = k; while (n < dedup.length && !dedup[n].s) n++; const nx = dedup[n]?.s; if (nx && (nx.startsWith(value) || value.startsWith(nx)) && nx.length < 80) { if (nx.length > value.length) value = nx; k = n + 1; } else break; }
        addFact(lab, value); i = k - 1; continue;
      }
    }
    let m;
    if ((m = s.match(/^posted (.+ ago|today|yesterday)$/i))) { addFact('Posted', m[1]); continue; }
    if ((m = s.match(/^([\d,]+)\+? applicants?$/i))) { addFact('Applicants', m[1]); continue; }
    if (TYPE_LINE.test(s) && facts.length) { addFact('Type', s); continue; }
    body.push(dedup[i]);
  }

  // ---- 3. blocks ----
  const blocks = [];
  let para = null, list = null;
  const flushPara = () => { if (para) { blocks.push({ t: 'p', lines: para }); para = null; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  const nextNonEmpty = i => { for (let j = i + 1; j < body.length; j++) if (body[j].s) return body[j].s; return ''; };
  const isItem = s => BULLET.test(s) || NUMBERED.test(s);
  const push = b => { flushPara(); flushList(); blocks.push(b); };

  for (let i = 0; i < body.length; i++) {
    const { s, hb } = body[i];
    if (!s) { flushPara(); continue; }                                   // a blank line ends a paragraph but not a list
    let m;
    if ((m = s.match(/^(#{1,6})\s+(.*)$/))) { push({ t: 'h', text: m[2].replace(/[*_]/g, '').replace(/:$/, '').trim(), level: m[1].length }); continue; }
    if ((m = s.match(/^(?:\*\*|__)(.+?)(?:\*\*|__):?$/)) && m[1].length < 80) { push({ t: 'h', text: m[1].trim(), level: 3 }); continue; }
    if ((m = s.match(/^\*([^*\s][^*]*)\*:?$/)) && m[1].length < 80) { push({ t: 'h', text: m[1].trim(), level: 4 }); continue; }
    if (SKILLS_HEAD.test(s)) { push({ t: 'h', text: s.replace(/:$/, ''), level: 3 }); continue; }
    if ((m = s.match(BULLET))) { flushPara(); if (!list || list.ordered) { flushList(); list = { t: 'list', ordered: false, items: [] }; } list.items.push(m[2]); continue; }
    if ((m = s.match(NUMBERED))) { flushPara(); if (!list || !list.ordered) { flushList(); list = { t: 'list', ordered: true, items: [] }; } list.items.push(m[2]); continue; }
    const next = nextNonEmpty(i);
    const leadsList = isItem(next);
    if (s.length < 40 && /:$/.test(s) && !leadsList && (!next || /:$/.test(next) || /^#/.test(next))) continue; // an empty label: nothing follows it
    if (s.length <= 60 && /:$/.test(s) && leadsList) { push({ t: 'h', text: s.replace(/:$/, ''), level: 3 }); continue; }
    if (EMOJI_HEAD.test(s) && !/[.!?]$/.test(s) && (leadsList || s.length < 40)) { push({ t: 'h', text: s, level: 3 }); continue; }
    flushList();
    if (!para) para = [];
    para.push(s);
    if (hb) flushPara();                                                  // a hard line break starts a fresh line, kept as its own paragraph
  }
  flushPara(); flushList();

  // ---- 4. tidy: skills become chips, empty/duplicate headings and repeated title go away ----
  for (let i = 0; i < blocks.length; i++) { // unmarked section labels become headings
    const b = blocks[i];
    if (b.t === 'p' && b.lines.length === 1 && b.lines[0].length < 46 && HEADISH.test(b.lines[0]) && !/[.!?:]$/.test(b.lines[0])) blocks[i] = { t: 'h', text: b.lines[0], level: 3 };
  }
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === 'h' && SKILLS_HEAD.test(b.text)) {                        // short lines after a Skills heading are a skill list, not prose
      const items = [];
      let j = i + 1;
      while (j < blocks.length && blocks[j].t === 'p' && blocks[j].lines.every(l => l.length < 42 && !/[.!?]$/.test(l))) { items.push(...blocks[j].lines); j++; }
      if (items.length) { out.push(b, { t: 'chips', items: [...new Set(items)] }); i = j - 1; continue; }
    }
    out.push(b);
  }
  const final = [];
  for (let i = 0; i < out.length; i++) {
    const b = out[i], nx = out[i + 1];
    if (b.t === 'h' && (!nx || nx.t === 'h' && nx.level <= b.level)) continue;                         // empty section
    if (b.t === 'p' && final.length && final[final.length - 1].t === 'h' && b.lines.length === 1 && norm(b.lines[0]) === norm(final[final.length - 1].text)) continue; // "About the job" repeated as text
    final.push(b);
  }
  // leading noise: the title again, "Work from home", one-line metadata strips ("A · B · C · D")
  while (final.length) {
    const b = final[0];
    const text = b.t === 'h' ? b.text : b.t === 'p' ? b.lines.join(' ') : '';
    const tn = norm(text), titleN = norm(title);
    const dupTitle = tn && titleN && (tn === titleN || titleN.startsWith(tn) || tn.startsWith(titleN));
    const meta = b.t === 'p' && (text.match(/ · /g) || []).length >= 3;
    const short = b.t === 'p' && text.length < 46 && final.length > 1;
    if (dupTitle || meta || short || (b.t === 'h' && b.level === 1)) final.shift(); else break;
  }
  return { facts, blocks: final, trimmed: raw.length >= 6900 };
}
