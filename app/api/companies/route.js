import { store } from '@/lib/store';
import { resolveCompany } from '@/lib/service';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => json(await store.listCompanies()));
export const POST = handler(async req => {
  const c = await resolveCompany((await req.json()).input.trim());
  return json({ ...c, id: await store.addCompany(c) });
});
export const DELETE = handler(async req => { await store.deleteCompany((await req.json()).id); return json({ ok: true }); });
