import { emailAllowed, startSession, uidFor } from '@/lib/auth';
import { saveCredential, useLink } from '@/lib/credentials';
import { store } from '@/lib/store';
import { handler, json, readJson } from '@/lib/http';

// Step 2 of creating an account: the emailed link is confirmed (by a button press on /verify, so mail scanners that open links
// cannot use it up). Only now does the account exist, and the person is signed in.
export const POST = handler(async (req) => {
  const b = await readJson(req);
  const p = await useLink('verify', b.token);
  if (!p) return json({ error: 'This link is invalid or has expired. Create your account again to get a new one.' }, 400);
  if (!emailAllowed(p.email)) return json({ error: 'This address no longer has access.' }, 403);
  const uid = uidFor(p.email);
  await saveCredential(uid, { email: p.email, name: p.name, hash: p.hash, created: Date.now(), fails: 0, lockedUntil: 0 });
  await store.upsertUser({ uid, email: p.email, name: p.name, picture: '' });
  return json({ ok: true }, 200, { 'Set-Cookie': startSession({ email: p.email, name: p.name }) });
}, { public: true, limit: ['verify-link', 20, 10 * 60_000] });
