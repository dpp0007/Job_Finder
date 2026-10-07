import { store } from '@/lib/store';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => json(await store.trackerList()));

export const POST = handler(async req => {
  const b = await req.json();
  if (!b.stage) await store.trackerRemove(b.jobId);
  else await store.trackerSet(b.jobId, b.stage, b.note); // note omitted: keep the existing note
  return json({ ok: true });
});
