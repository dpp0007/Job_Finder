import { ranked, runSearch, needKey } from '@/lib/service';
import { DEFAULT_PREFS } from '@/lib/rank';
import { handler, ndjson } from '@/lib/http';

export const maxDuration = 300;

export const POST = handler(async req => {
  const b = await req.json();
  if (needKey()) { const e = new Error('nokey'); e.code = 'nokey'; e.status = 503; throw e; }
  const prefs = { ...DEFAULT_PREFS, ...b.prefs };
  return ndjson(async emit => {
    // every committed batch becomes a ranked snapshot, throttled so the UI isn't flooded; snapshots are queued so none arrives after "done"
    let last = 0, chain = Promise.resolve();
    const snapshot = () => {
      if (Date.now() - last < 1500) return;
      last = Date.now();
      chain = chain.then(async () => emit({ type: 'results', ...(await ranked(prefs, b.resume || '')) })).catch(() => {});
    };
    const out = await runSearch(prefs, e => { emit(e); if (e.type === 'batch') snapshot(); });
    await chain;
    emit({ type: 'done', stats: out.stats, ...(await ranked(prefs, b.resume || '')) });
  });
});
