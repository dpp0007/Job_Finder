import { forUser } from '@/lib/store';
import { needKey, useQuota } from '@/lib/service';
import { discover } from '@/lib/discover';
import { DEFAULT_PREFS, cleanPrefs } from '@/lib/rank';
import { isNumId } from '@/lib/validate';
import { handler, json, ndjson, readJson } from '@/lib/http';

export const maxDuration = 300;

export const POST = handler(async (req, { user }) => {
  const b = await readJson(req);
  if (needKey()) { const e = new Error('nokey'); e.code = 'nokey'; e.status = 503; throw e; }
  if (!isNumId(b.id)) return json({ error: 'Unknown company' }, 400);
  const me = forUser(user.uid);
  const c = await me.getCompany(Number(b.id));            // only this user's own watchlist can be scanned
  if (!c) return json({ error: 'Unknown company' }, 404);
  await useQuota(user.uid, 'search');
  const prefs = cleanPrefs(b.prefs);
  return ndjson(async emit => {
    const { stats, issues } = await discover({ ...DEFAULT_PREFS, ...prefs, portals: [] }, { watch: [c], emit, onlyWatch: true });
    const ok = stats.found > 0;
    const note = ok ? `Read ${stats.boardJobs || stats.fetched} listings, kept ${stats.found} openings${issues.length ? ` (${issues.length} problem${issues.length > 1 ? 's' : ''})` : ''}`
      : issues[0] || 'No openings found. The page may have none, or it blocks automated readers.';
    await me.updateCompany(c.id, { last_scan: Date.now(), job_count: stats.found, note: (ok ? '' : '!') + note });
    emit({ type: 'done', stats, issues, ok, note });
  });
}, { limit: ['scan', 15, 60 * 60_000] });
