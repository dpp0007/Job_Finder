// Turns scraped posting text (markdown-ish, different on every site) into clean structure:
// a facts strip (start date, pay, experience…) plus headings, paragraphs, lists and skill chips. Pure: no React, no I/O.

const FACT_LABELS = [
  [/^start date$/i, 'Starts'], [/^(annual )?ctc( \(annual\))?$/i, 'Pay'], [/^stipend$/i, 'Stipend'], [/^salary$/i, 'Salary'],
  [/^experience$/i, 'Experience'], [/^apply by$/i, 'Apply by'], [/^duration$/i, 'Duration'], [/^(number of )?openings$/i, 'Openings'],
  [/^job type$/i, 'Type'], [/^location$/i, 'Location'],
  [/^(last date|closing date|deadline|application deadline)( to apply)?$/i, 'Apply by'], [/^no\.? of (positions?|vacancies)$/i, 'Openings'],
  [/^company$/i, 'Company'], [/^employment type$/i, 'Type'], [/^seniority level$/i, 'Level'], [/^work ?mode$/i, 'Mode'],
];
const labelOf = s => { for (const [re, name] of FACT_LABELS) if (re.test(s)) return name; return null; };
const BOILER = /^(show (more|less)|see (more|less)|read more|view (all|details)|click here|download( detailed notification)?|translate|bookmark|print|email( this job)?|copy link|apply with \w+|actively recruiting|be an early applicant|back to jobs|apply( now| here| for this job)?\s*[!»›>]*|actively hiring|share( this job)?|report( this job)?|sign in|log ?in|register|home|company|save job|view all jobs|similar jobs|earn certifications in these skills|posted by .*)$/i;
const TYPE_LINE = /^(job|internship|full[- ]time|part[- ]time|contract)$/i;
const BULLET = /^([*\-+•·▪◦●➢➤✓])\s+(.*)$/;
const NUMBERED = /^(\d{1,2})[.)]\s+(.*)$/;
const EMOJI_HEAD = /^[\p{Extended_Pictographic}][️‍]?\s*\S.{1,48}$/u;
// Plain-text section labels some sites print without any markup ("Who can apply", "Requirements")
const HEADISH = /^(who|what|how|why|about|requirements?|qualifications?|benefits|perks|eligibility|responsibilities|other|additional|key)\b/i;
const SKILLS_HEAD = /^skill\(?s?\)?( required)?:?$/i;

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();


// Everything after these lines is page furniture (alerts, sign-up walls, "similar jobs"), never part of the posting.
const FOOTER = /^([*-]\s+)?(#{1,6}\s*)?(\*\*)?(career site cookie|these cookies|sign up for (job )?alerts|subscribe|karrierestufe|beschäftigungsverhältnis|tätigkeitsbereich|branchen|mit einer empfehlung|wen kennen sie|lassen sie sich benachrichtigen|apply for this (job|position|role)|create a job alert|get future opportunities|similar jobs?|more jobs?|other (open )?(jobs|positions|roles)|jobs? powered by|powered by \w+|looking for more such opportunities|candidate sign ?up|sign up to continue|sign up (to|for) (apply|see|view)|share this (job|opening)|you may also like|people also (viewed|searched)|recommended jobs|related jobs|activity on \w+|additional questions|show (more|all) jobs|see (more|all) jobs|jobs you may be interested in|\*? ?indicates a required field|privacy (policy|notice)|cookie (policy|settings|preferences)|terms (of use|& conditions|and conditions)|follow us|connect with us|©|copyright\b|all rights reserved|register now|already registered)/i;
// Single lines that carry no information about the job.
const NOISE = [/^[^|]{1,30}(\s\|\s[^|]{1,30}){2,}$/, /^(#[\w-]+\s*)+$/, /^#{1,6}$/, /^(https?:\/\/|www\.)\S+$/i, /^\\?\*$/, /^[-–—_=*~]{3,}$/, /^\[[^\]]+\]\([^)]+\)$/, /^(.*\]\([^)]+\).*){3,}$/,
  /^(we use cookies|this (site|website) uses cookies|accept (all )?cookies|manage (cookie|preferences)|by (continuing|signing up|clicking).{0,80}(terms|privacy|agree))/i,
  /\b(first|ersten) \d+ (applicants?|bewerber)|\bvor \d+ (tagen|stunden|wochen)\b|\bbe among the first \d+ applicants\b/i];
const TABLE_VALUE_NOISE = /^(click here|download|view|apply here|here|n\/a|-)$/i;

// Cleans raw page text into plain lines: markdown tables become "Label: value", footers and navigation are cut.
function prepass(raw) {
  const text = raw.replace(/\r/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                               // images
    .replace(/\\([_*\[\]()#+\-.!`~>|])/g, '$1')                         // markdown escapes (\_ etc.)
    .replace(/\*\*([^*\n]+)\*\*([a-z]+)/g, '**$1$2**');                  // **engine**er -> **engineer**
  const lines = [];
  for (const l of text.split('\n')) {
    const t = l.trim();
    if (!t.startsWith('|')) { lines.push(l); continue; }
    if (/^\|[\s:|-]+\|?$/.test(t)) continue;                             // table rule
    const cells = t.replace(/^\||\|$/g, '').split('|').map(c => c.replace(/\*\*/g, '').trim()).filter(Boolean);
    if (!cells.length || cells.some(c => TABLE_VALUE_NOISE.test(c))) continue;
    lines.push(cells.length === 2 ? (labelOf(cells[0]) ? `${cells[0]}: ${cells[1]}` : `- ${cells[0]}: ${cells[1]}`) : '- ' + cells.join(' — '));
  }
  let cut = lines.length, seen = 0;
  const all = lines.reduce((n, l) => n + l.trim().length, 0), enough = () => seen >= 200 && seen >= all * 0.25;   // furniture sits after the content, never before it
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (FOOTER.test(t)) { if (enough()) { cut = i; break; } lines[i] = ''; continue; }
    const b = t.match(/^[*-]\s+(.{3,100})$/);                           // a bullet repeated as a heading right after it starts the "similar jobs" list
    if (b && enough()) { let j = i + 1; while (j < lines.length && !lines[j].trim()) j++; const h = (lines[j] || '').trim().match(/^#{2,5}\s+(.+)$/); if (h && norm(h[1]) === norm(b[1])) { cut = i; break; } }
    seen += t.length;
  }
  return lines.slice(0, cut);
}

// Search-result pages (a list of many jobs) are not one posting.
const looksLikeListing = lines => lines.filter(l => /\b\d+\s*(?:to|-)\s*\d+\s*yrs/i.test(l)).length >= 4 || lines.filter(l => /Apply$/.test(l.trim())).length >= 5;

const KINDS = [
  ['req', /about you/i], ['role', /^about the (role|job|position|opportunity)|^the (role|opportunity)$|^job description$|^(role |position )?(overview|summary)$/i], ['nice', /preferred|nice to have|bonus|good to have|a plus\b/i],
  ['about', /^about\b|who we are|our (mission|story|values)|the company|company overview|what we do/i],
  ['perks', /benefit|perks|what we offer|compensation|salary|pay range|why join|what you.?ll get|what you can expect/i],
  ['resp', /responsib|what you.?ll (do|be doing)|what you will do|the job|duties|accountabilit|day.to.day|your (role|impact|mission)|job purpose|the role|key tasks|you will\b|key activities/i],
  ['req', /requirement|qualification|what you bring|who (you are|can apply)|you have|must have|ideal candidate|skills|eligibility|candidate profile|looking for|only those candidates|you.?ll thrive|strong fit|experience/i],
];
const kindOf = h => { for (const [k, re] of KINDS) if (re.test(h)) return k; return null; };
const plain = s => s.replace(/\*\*|__/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

// The sentences that matter for preparing: duties, requirements, nice-to-haves and what the company does.
function sectionItems(blocks) {
  const out = { resp: [], req: [], nice: [], about: '' };
  let kind = null;
  for (const b of blocks) {
    if (b.t === 'h') { kind = kindOf(b.text); continue; }
    if (!kind || kind === 'perks' || kind === 'role') continue;
    const items = b.t === 'list' ? b.items : b.t === 'p' ? b.lines : [];
    for (const it of items) { const v = plain(it); if (v.length < 12) continue; if (kind === 'about') { if (!out.about) out.about = v.slice(0, 280); } else if (out[kind].length < 12) out[kind].push(v.slice(0, 220)); }
  }
  return out;
}

export function parseDescription(raw = '', title = '') {
  const lines = prepass(raw);
  if (looksLikeListing(lines)) return { facts: [], blocks: [], sections: sectionItems([]), quality: 'none', listing: true, trimmed: false };

  // ---- 1. clean: drop boilerplate, collapse repeats, strip the "Learn X" upsell that follows a certifications line ----
  const clean = [];
  let afterCert = false;
  for (const l of lines) {
    const s = l.trim();
    if (/^earn certifications in these skills$/i.test(s)) { afterCert = true; continue; }
    if (afterCert && (!s || /^learn .{2,40}$/i.test(s))) continue;
    afterCert = false;
    if (s && (BOILER.test(s) || NOISE.some(re => re.test(s)))) continue;
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
    const lab = labelOf(s.replace(/^#{1,6}\s+/, '').replace(/:$/, ''));
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
  // leading noise: the title again, "Work from home", one-line metadata strips ("A · B · C · D", "Full Time /")
  while (final.length) {
    const b = final[0];
    const text = b.t === 'h' ? b.text : b.t === 'p' ? b.lines.join(' ') : '';
    const tn = norm(text), titleN = norm(title);
    const dupTitle = tn && titleN && (tn === titleN || titleN.startsWith(tn) || tn.startsWith(titleN));
    const meta = b.t === 'p' && ((text.match(/ · /g) || []).length >= 3 || /\s\/\s*$/.test(text) || ((text.match(/ \/ /g) || []).length >= 2 && b.lines.every(l => l.length < 90)));
    const short = b.t === 'p' && text.length < 46 && final.length > 1;
    if (dupTitle || meta || short || (b.t === 'h' && b.level === 1)) final.shift(); else break;
  }

  // ---- 5. consistency: one heading style, no run-on headings, a size cap ----
  const tidy = [];
  let total = 0, lastHead = '';
  const seenText = new Set();
  for (const b0 of final) {
    let b = b0;
    if (b.t === 'h') {
      let text = b.text.replace(/\*\*|__/g, '').trim();
      if (text.length > 70) b = { t: 'p', lines: [text] };                                   // a sentence that was marked up as a heading
      else {
        if (/[A-Z]{3}/.test(text) && text === text.toUpperCase()) text = text[0] + text.slice(1).toLowerCase();   // ABOUT THE JOB -> About the job
        if (norm(text) === lastHead) continue;                                              // the same heading twice in a row
        lastHead = norm(text);
        b = { ...b, text };
      }
    } else {
      lastHead = '';
      const key = norm(b.t === 'p' ? b.lines.join(' ') : b.t === 'list' ? b.items.join(' ') : '');
      if (key.length > 60) { if (seenText.has(key)) continue; seenText.add(key); }       // some pages print a section twice
    }
    if (total > 9000) break;
    total += size(b);
    tidy.push(b);
  }
  for (let i = tidy.length - 1; i >= 0; i--) if (tidy[i].t === 'h' && (i === tidy.length - 1 || (tidy[i + 1].t === 'h' && tidy[i + 1].level <= tidy[i].level))) tidy.splice(i, 1);   // headings left with nothing under them
  const chars = tidy.reduce((n, b) => n + size(b), 0);
  return { facts, blocks: tidy, sections: sectionItems(tidy), quality: !tidy.length ? 'none' : chars < 220 ? 'thin' : 'good', trimmed: raw.length >= 6900 };
}

function size(b) { return b.t === 'p' ? b.lines.join('').length : b.t === 'list' || b.t === 'chips' ? b.items.join('').length : (b.text || '').length; }

// The cleaned posting as plain text (for a language model): headings, paragraphs and bullets, nothing else.
export function descriptionText(blocks) {
  return blocks.map(b => b.t === 'h' ? `\n${b.text}` : b.t === 'p' ? b.lines.join(' ') : b.t === 'list' ? b.items.map(i => '- ' + i).join('\n') : b.items.join(', ')).join('\n').replace(/\*\*|__/g, '').trim();
}

// Same order for every posting: the role, duties and requirements first; company background, benefits and legal text tucked behind one toggle.
const LEGAL = /hybrid work|work(ing)? (model|policy)|approach to|equal (opportunity|employment)|diversity|inclusion|privacy|scam|fraud|accommodation|interview process|how we hire|hiring process|background check|e-?verify|disclaimer|data protection|gdpr/i;
export function groupBlocks(blocks) {
  let cur = 'intro';
  const tagged = blocks.map(b => { if (b.t === 'h') { const k = kindOf(b.text) || (LEGAL.test(b.text) ? 'legal' : null); if (k) cur = k; } return [b, cur]; });
  const core = tagged.filter(([, k]) => k === 'resp' || k === 'req' || k === 'nice').reduce((n, [b]) => n + size(b), 0);
  if (core < 200) return { primary: blocks, secondary: [] };               // no recognisable sections: show everything in order
  const intro = tagged.filter(([, k]) => k === 'intro').reduce((n, [b]) => n + size(b), 0);
  const keep = k => k === 'role' || k === 'resp' || k === 'req' || k === 'nice' || (k === 'intro' && intro <= 350);
  return { primary: tagged.filter(([, k]) => keep(k)).map(([b]) => b), secondary: tagged.filter(([, k]) => !keep(k)).map(([b]) => b) };
}
