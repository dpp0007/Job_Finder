// Rules every storage backend must follow identically. Pure functions: no database access here.
import { mergeJob } from '../rank.js';
import { PARSE_VERSION } from '../parse.js';

// Rows left over from older parsers: category pages and headings that are not jobs.
const JUNK_TITLE = /^((current |all |open )?(job )?(openings?|positions?|roles?|jobs?|vacancies)|careers?|home|apply)\W*\d*$|^\d[\d,]*\+?\s|\bjob vacancies\b/i;
export const isJunkTitle = t => JUNK_TITLE.test((t || '').trim());

// Numeric, roughly time-ordered ids (newest = largest), safe as JS numbers: used for searches, companies, notifications.
export const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

// What an upsert does for one job, given what the store already holds for its id and for its URL.
// byId / byUrl: { id, data (object), first_seen } or null.  Returns { type: 'insert' | 'replace' | 'merge', id, data, first_seen, oldId? }.
export function planUpsert(job, byId, byUrl, now = Date.now()) {
  let row = byId;
  if (!row && byUrl) { // the same page stored under another fingerprint
    const prev = byUrl.data;
    if (prev.pv !== PARSE_VERSION && !prev.llm) { // parsed by an older parser: replace it, keep first_seen and anything the user tracked
      return { type: 'replace', oldId: byUrl.id, id: job.id, first_seen: byUrl.first_seen, data: { ...job, firstSeen: byUrl.first_seen } };
    }
    job = { ...job, id: byUrl.id }; row = byUrl; // a current parse of the same page: merge into the existing row
  }
  if (!row) return { type: 'insert', id: job.id, first_seen: now, data: { ...job, firstSeen: now } };
  const ex = { ...row.data, firstSeen: row.first_seen };
  // A job the model has already read keeps its extracted fields; a fresh scrape only adds new sources.
  const data = ex.llm
    ? { ...ex, sources: [...ex.sources, ...job.sources.filter(x => !ex.sources.some(e => e.url === x.url))] }
    : mergeJob(ex, job);
  return { type: 'merge', id: job.id, first_seen: row.first_seen, data };
}

// Canonical URLs already indexed with a full, current-parser description: repeat searches skip re-reading them.
export const isKnown = data => data.hasDesc && data.pv === PARSE_VERSION;
