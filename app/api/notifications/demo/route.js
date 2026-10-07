import { ranked } from '@/lib/service';
import { compact, createNotification } from '@/lib/notify';
import { handler, json } from '@/lib/http';

// Demo: fires the exact notification path a real alert uses, with the best real openings already in the index.
export const POST = handler(async req => {
  const b = await req.json();
  const r = await ranked(b.prefs, b.resume || '');
  const top = (r.results.length ? r.results : r.near).slice(0, 3);
  if (!top.length) {
    const e = new Error('Nothing in your index matches these filters yet. Run a live search first, then try the demo.');
    e.status = 400;
    throw e;
  }
  const label = [b.prefs.roles?.[0], b.prefs.locations?.[0]].filter(Boolean).join(' · ') || 'your search';
  const short = t => (t || '').split(/\s[|•]\s/)[0].trim();
  const id = await createNotification({
    title: `Demo · ${top.length} new match${top.length > 1 ? 'es' : ''} for ${label}`,
    body: top.map(j => `${short(j.title)} at ${j.company}`).join(' · '),
    jobs: top.map(compact), demo: true,
  });
  return json({ id });
});
