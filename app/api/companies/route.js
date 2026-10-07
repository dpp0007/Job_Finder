import { all, run } from '@/lib/db';
import { resolveCompany } from '@/lib/service';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => json(all('SELECT * FROM companies ORDER BY id DESC')));
export const POST = handler(async req => {
  const c = await resolveCompany((await req.json()).input.trim());
  const r = run('INSERT INTO companies(name,careers_url,ats,slug) VALUES(?,?,?,?)', c.name, c.careers_url, c.ats, c.slug);
  return json({ ...c, id: Number(r.lastInsertRowid) });
});
export const DELETE = handler(async req => { run('DELETE FROM companies WHERE id=?', (await req.json()).id); return json({ ok: true }); });
