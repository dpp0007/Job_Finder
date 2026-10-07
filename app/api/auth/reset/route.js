import { emailAllowed, startSession, uidFor } from '@/lib/auth';
import { getCredential, hashPassword, saveCredential, useLink } from '@/lib/credentials';
import { checkPassword } from '@/lib/password';
import { store } from '@/lib/store';
import { handler, json, readJson } from '@/lib/http';

// Sets a new password from an emailed link. A weak password is refused before the link is used up.
export const POST = handler(async (req) => {
  const b = await readJson(req);
  const peek = await useLink('reset', b.token, { consume: false });
  if (!peek) return json({ error: 'This link is invalid or has expired. Ask for a new one.' }, 400);
  const pw = checkPassword(b.password, peek.email);
  if (!pw.ok) return json({ error: pw.error }, 400);
  const p = await useLink('reset', b.token);
  if (!p) return json({ error: 'This link was just used. Ask for a new one if that wasn’t you.' }, 400);
  if (!emailAllowed(p.email)) return json({ error: 'This address no longer has access.' }, 403);
  const uid = uidFor(p.email), old = await getCredential(uid), user = await store.getUser(uid);
  const name = old?.name || user?.name || p.email.split('@')[0];
  await saveCredential(uid, { email: p.email, name, hash: await hashPassword(b.password), created: old?.created || Date.now(), fails: 0, lockedUntil: 0 });
  await store.upsertUser({ uid, email: p.email, name, picture: user?.picture || '' });
  return json({ ok: true }, 200, { 'Set-Cookie': startSession({ email: p.email, name }) });
}, { public: true, limit: ['reset', 10, 10 * 60_000] });
