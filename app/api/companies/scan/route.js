import { store } from '@/lib/store';
import { needKey } from '@/lib/service';
import { discover } from '@/lib/discover';
import { DEFAULT_PREFS } from '@/lib/rank';
import { handler, json, ndjson } from '@/lib/http';

export const maxDuration = 300;

export const POST = handler(async req => {
  const b = await req.json();
  if (needKey()) { const e = new Error('nokey'); e.code = 'nokey'; e.status = 503; throw e; }
  const c = await store.getCompany(b.id);
  if (!c) return json({ error: 'Unknown company' }, 404);
  return ndjson(async emit => {
    const { stats, issues } = await discover({ ...DEFAULT_PREFS, ...b.prefs, portals: [] }, { watch: [c], emit, onlyWatch: true });
    const ok = stats.found > 0;
    const note = ok ? `Read ${stats.boardJobs || stats.fetched} listings, kept ${stats.found} openings${issues.length ? ` (${issues.length} problem${issues.length > 1 ? 's' : ''})` : ''}`
      : issues[0] || 'No openings found. The page may have none, or it blocks automated readers.';
    await store.updateCompany(c.id, { last_scan: Date.now(), job_count: stats.found, note: (ok ? '' : '!') + note });
    emit({ type: 'done', stats, issues, ok, note });
  });
});
