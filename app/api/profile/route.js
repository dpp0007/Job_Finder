import { forUser } from '@/lib/store';
import { profile, resumeMeta } from '@/lib/service';
import { sanitizePrefs } from '@/lib/validate';
import { DEFAULT_PREFS } from '@/lib/rank';
import { handler, json, readJson } from '@/lib/http';

export const GET = handler(async (_req, { user }) => {
  const p = await profile(user.uid);
  return json({ prefs: { ...DEFAULT_PREFS, ...p.prefs }, resume: resumeMeta(p.resume) });
});
export const PUT = handler(async (req, { user }) => {
  const b = await readJson(req);
  await forUser(user.uid).setKV('profile', { prefs: sanitizePrefs(b.prefs).prefs });   // the resume has its own record: see /api/resume
  return json({ ok: true });
});
