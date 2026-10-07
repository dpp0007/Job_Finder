import { forUser } from '@/lib/store';
import { resolveCompany } from '@/lib/service';
import { checkCompany, isNumId } from '@/lib/validate';
import { handler, json, readJson } from '@/lib/http';

const MAX_COMPANIES = 40;
const refuse = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

export const GET = handler(async (_req, { user }) => json(await forUser(user.uid).listCompanies()));
export const POST = handler(async (req, { user }) => {
  const me = forUser(user.uid);
  const ok = checkCompany((await readJson(req)).input);
  if (!ok.ok) throw refuse(ok.error || 'Enter a company name or a careers link.');
  if ((await me.listCompanies()).length >= MAX_COMPANIES) throw refuse(`Your watchlist is full (${MAX_COMPANIES} companies). Remove one first.`);
  const c = await resolveCompany(ok.value);
  return json({ ...c, id: await me.addCompany(c) });
}, { limit: ['company', 20, 60 * 60_000] });
export const DELETE = handler(async (req, { user }) => {
  const { id } = await readJson(req);
  if (!isNumId(id)) throw refuse('Unknown company.');
  await forUser(user.uid).deleteCompany(Number(id));
  return json({ ok: true });
});
