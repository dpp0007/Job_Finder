import { ranked, runSearch, needKey, useQuota } from '@/lib/service';
import { assertPrefs } from '@/lib/validate';
import { handler, json, ndjson, readJson } from '@/lib/http';

export const maxDuration = 300;

export const POST = handler(async (req, { user }) => {
  const b = await readJson(req);
  if (needKey()) { const e = new Error('nokey'); e.code = 'nokey'; e.status = 503; throw e; }
  const prefs = assertPrefs(b.prefs);    // out-of-context input is refused here, with a reason
  await useQuota(user.uid, 'search');
  return ndjson(async emit => {
    // every committed batch becomes a ranked snapshot, throttled so the UI isn't flooded; snapshots are queued so none arrives after "done"
    let last = 0, chain = Promise.resolve();
    const snapshot = () => {
      if (Date.now() - last < 1500) return;
      last = Date.now();
      chain = chain.then(async () => emit({ type: 'results', ...(await ranked(user.uid, prefs)) })).catch(() => {});
    };
    const out = await runSearch(user.uid, prefs, e => { emit(e); if (e.type === 'batch') snapshot(); });
    await chain;
    emit({ type: 'done', stats: out.stats, ...(await ranked(user.uid, prefs)) });
  });
}, { limit: ['search', 8, 10 * 60_000] });
