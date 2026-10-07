import { createHash } from 'node:crypto';
import { emailAllowed, safeNext, startSession } from '@/lib/auth';
import { checkLogin, burnTime } from '@/lib/credentials';
import { checkEmail } from '@/lib/password';
import { rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { handler, json, readJson } from '@/lib/http';

const WRONG = 'Wrong email or password, or the account is temporarily locked.';

export const POST = handler(async (req) => {
  const b = await readJson(req);
  const email = checkEmail(b.email), password = typeof b.password === 'string' ? b.password : '';
  if (!email.ok || !password || password.length > 128) { await burnTime('x'); return json({ error: WRONG }, 401); }
  const key = 'login-email:' + createHash('sha256').update(email.value).digest('hex');
  if (!rateLimit(key, 8, 15 * 60_000).ok) return json({ error: 'Too many attempts for this account. Wait a few minutes and try again.' }, 429, { 'Retry-After': '900' });

  const r = await checkLogin(email.value, password);          // password first, allow-list second: both paths take the same time
  if (!r.ok || !emailAllowed(email.value)) { console.warn('password sign-in refused:', r.ok ? 'not allowed' : r.reason); return json({ error: WRONG }, 401); }
  await store.upsertUser({ uid: r.user.uid, email: r.user.email, name: r.user.name || '', picture: '' });
  return json({ ok: true, next: safeNext(b.next) }, 200, { 'Set-Cookie': startSession({ email: r.user.email, name: r.user.name }) });
}, { public: true, limit: ['login', 15, 10 * 60_000] });
