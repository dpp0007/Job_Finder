import { createHash } from 'node:crypto';
import { appUrl, emailAllowed, uidFor } from '@/lib/auth';
import { createLink, getCredential, hashPassword } from '@/lib/credentials';
import { sendLink } from '@/lib/mail';
import { checkEmail, checkName, checkPassword } from '@/lib/password';
import { rateLimit } from '@/lib/ratelimit';
import { handler, json, readJson } from '@/lib/http';

const refuse = message => Object.assign(new Error(message), { status: 400, expose: true });
const DAY = 864e5;

// Step 1 of creating an account: check the details, then email a confirmation link. Nothing is created until the link is used.
// The answer is the same whether or not the address is allowed or already registered, so this cannot be used to probe who has access.
export const POST = handler(async (req) => {
  const b = await readJson(req);
  const name = checkName(b.name), email = checkEmail(b.email);
  if (!name.ok) throw refuse(name.error);
  if (!email.ok) throw refuse(email.error);
  const pw = checkPassword(b.password, email.value);
  if (!pw.ok) throw refuse(pw.error);

  const reply = extra => json({ ok: true, message: 'If this address has access, a confirmation link is on its way. It works once and expires in 24 hours.', ...extra });
  const hash = await hashPassword(b.password);   // always done, so timing does not reveal whether the address is allowed
  const key = 'signup-email:' + createHash('sha256').update(email.value).digest('hex');
  if (!rateLimit(key, 3, 60 * 60_000).ok) return reply();
  if (!emailAllowed(email.value) || await getCredential(uidFor(email.value))) return reply();

  const token = await createLink('verify', { email: email.value, name: name.value, hash }, DAY);
  const sent = await sendLink({ to: email.value, name: name.value, kind: 'verify', link: `${appUrl()}/verify?token=${token}` });
  return reply(sent.devLink ? { devLink: sent.devLink } : {});   // devLink exists only on a local machine without SMTP
}, { public: true, limit: ['signup', 8, 60 * 60_000] });
