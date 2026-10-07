import { ranked, runSearch, needKey } from '@/lib/service';
import { DEFAULT_PREFS } from '@/lib/rank';
import { handler, ndjson } from '@/lib/http';

export const maxDuration = 300;

export const POST = handler(async req => {
  const b = await req.json();
  if (needKey()) { const e = new Error('nokey'); e.code = 'nokey'; e.status = 503; throw e; }
  const prefs = { ...DEFAULT_PREFS, ...b.prefs };
  return ndjson(async emit => {
    // every committed batch becomes a ranked snapshot, throttled so the UI isn't flooded
    let last = 0;
    const snapshot = (final = false) => {
      if (!final && Date.now() - last < 1500) return;
      last = Date.now();
      emit({ type: 'results', ...ranked(prefs, b.resume || '') });
    };
    const out = await runSearch(prefs, e => { emit(e); if (e.type === 'batch') snapshot(); });
    emit({ type: 'done', stats: out.stats, ...ranked(prefs, b.resume || '') });
  });
});
