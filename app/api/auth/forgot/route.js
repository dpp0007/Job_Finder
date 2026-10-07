import { createHash } from 'node:crypto';
import { appUrl, emailAllowed } from '@/lib/auth';
import { createLink } from '@/lib/credentials';
import { sendLink } from '@/lib/mail';
import { checkEmail } from '@/lib/password';
import { rateLimit } from '@/lib/ratelimit';
import { handler, json, readJson } from '@/lib/http';

// "Forgot password": always the same answer, so it cannot be used to find out who has an account.
// This also lets someone who signed in with Google choose a password for the same address.
export const POST = handler(async (req) => {
  const email = checkEmail((await readJson(req)).email);
  const reply = extra => json({ ok: true, message: 'If this address has access, a reset link is on its way. It works once and expires in 30 minutes.', ...extra });
  if (!email.ok) return reply();
  const key = 'forgot-email:' + createHash('sha256').update(email.value).digest('hex');
  if (!rateLimit(key, 3, 60 * 60_000).ok || !emailAllowed(email.value)) return reply();
  try {
    const token = await createLink('reset', { email: email.value }, 30 * 60_000);
    const sent = await sendLink({ to: email.value, kind: 'reset', link: `${appUrl()}/reset?token=${token}` });
    return reply(sent.devLink ? { devLink: sent.devLink } : {});
  } catch (e) { console.error('reset email failed:', e.message); return reply(); }   // a mail problem must not reveal that the address is allowed
}, { public: true, limit: ['forgot', 8, 60 * 60_000] });
