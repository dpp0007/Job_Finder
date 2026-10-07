import { store } from '@/lib/store';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => json(await store.listSearches()));
export const POST = handler(async req => {
  const b = await req.json();
  if (await store.hasSearchWithPrefs(b.prefs)) return json({ ok: true, duplicate: true });
  await store.addSearch({ name: b.name, prefs: b.prefs });
  return json({ ok: true });
});
export const PATCH = handler(async req => {
  const b = await req.json();
  await store.patchSearch(b.id, { auto: b.auto, interval_h: b.interval_h, new_count: b.new_count });
  return json({ ok: true });
});
export const DELETE = handler(async req => { await store.deleteSearch((await req.json()).id); return json({ ok: true }); });
