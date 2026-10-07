import { forUser } from '@/lib/store';
import { assertPrefs, isNumId } from '@/lib/validate';
import { handler, json, readJson } from '@/lib/http';

const MAX_ALERTS = 20;
const refuse = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

export const GET = handler(async (_req, { user }) => json(await forUser(user.uid).listSearches()));
export const POST = handler(async (req, { user }) => {
  const me = forUser(user.uid), b = await readJson(req);
  const prefs = assertPrefs(b.prefs);
  if (await me.hasSearchWithPrefs(prefs)) return json({ ok: true, duplicate: true });
  if ((await me.countSearches()) >= MAX_ALERTS) throw refuse(`You can keep ${MAX_ALERTS} alerts. Delete one first.`);
  await me.addSearch({ name: String(b.name || '').replace(/[<>]/g, '').slice(0, 80), prefs });
  return json({ ok: true });
}, { limit: ['alert', 30, 60 * 60_000] });
export const PATCH = handler(async (req, { user }) => {
  const b = await readJson(req);
  if (!isNumId(b.id)) throw refuse('Unknown alert.');
  const hours = b.interval_h == null ? null : Math.min(168, Math.max(1, Math.round(Number(b.interval_h)) || 12));
  await forUser(user.uid).patchSearch(Number(b.id), { auto: b.auto == null ? null : b.auto ? 1 : 0, interval_h: hours, new_count: b.new_count === 0 ? 0 : null });
  return json({ ok: true });
});
export const DELETE = handler(async (req, { user }) => {
  const { id } = await readJson(req);
  if (!isNumId(id)) throw refuse('Unknown alert.');
  await forUser(user.uid).deleteSearch(Number(id));
  return json({ ok: true });
});
