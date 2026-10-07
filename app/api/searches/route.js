import { all, get, run } from '@/lib/db';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => json(all('SELECT * FROM searches ORDER BY id DESC').map(s => ({ ...s, prefs: JSON.parse(s.prefs) }))));
export const POST = handler(async req => {
  const b = await req.json();
  if (get('SELECT id FROM searches WHERE prefs=?', JSON.stringify(b.prefs))) return json({ ok: true, duplicate: true });
  run('INSERT INTO searches(name,prefs,last_run) VALUES(?,?,?)', b.name, JSON.stringify(b.prefs), Date.now());
  return json({ ok: true });
});
export const PATCH = handler(async req => {
  const b = await req.json();
  run('UPDATE searches SET auto=COALESCE(?,auto), interval_h=COALESCE(?,interval_h), new_count=COALESCE(?,new_count) WHERE id=?', b.auto ?? null, b.interval_h ?? null, b.new_count ?? null, b.id);
  return json({ ok: true });
});
export const DELETE = handler(async req => { run('DELETE FROM searches WHERE id=?', (await req.json()).id); return json({ ok: true }); });
