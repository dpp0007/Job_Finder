import { setKV } from '@/lib/db';
import { profile } from '@/lib/service';
import { DEFAULT_PREFS } from '@/lib/rank';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => json(profile()));
export const PUT = handler(async req => {
  const b = await req.json();
  setKV('profile', { prefs: { ...DEFAULT_PREFS, ...b.prefs }, resume: b.resume || '' });
  return json({ ok: true });
});
