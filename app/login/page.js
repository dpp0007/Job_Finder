import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import AuthFrame from '@/components/AuthFrame';
import AuthScreen from '@/components/AuthScreen';
import { configuredProviders, currentUser, emailAllowed, safeNext } from '@/lib/auth';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in — Scout' };

// Plain messages only: the page never echoes anything taken from the address bar, except a code looked up in this table.
const ERRORS = {
  not_allowed: 'That account isn’t on the access list. Ask the owner of this Scout to add your email address.',
  denied: 'Sign-in was cancelled.',
  state: 'That sign-in link expired or was opened in another browser. Please start again.',
  failed: 'Sign-in didn’t work. Please try again.',
  unverified: 'Your email address isn’t verified with that provider. Verify it there, then try again.',
  provider: 'That sign-in method isn’t set up on this server.',
  config: 'Sign-in isn’t configured on this server yet. The owner needs to finish the setup.',
  rate: 'Too many attempts. Wait a few minutes and try again.',
};

export default async function Login({ searchParams }) {
  const q = await searchParams;
  const next = safeNext(typeof q.next === 'string' ? q.next : '/');
  const h = await headers();
  let signedIn = null, setupError = false, providers = [];
  try { signedIn = currentUser({ headers: h }); providers = configuredProviders(); } catch { setupError = true; }
  if (signedIn) redirect(next);
  const devEmail = process.env.NODE_ENV !== 'production' ? env('DEV_LOGIN_EMAIL') : '';   // local development only
  if (devEmail && emailAllowed(devEmail)) providers = [...providers, { id: 'dev', label: 'Local test account' }];
  const error = typeof q.error === 'string' && Object.hasOwn(ERRORS, q.error) ? ERRORS[q.error] : setupError ? ERRORS.config : '';
  return <AuthFrame><AuthScreen providers={providers} error={error} next={next} mode={q.mode === 'signup' ? 'signup' : 'signin'} /></AuthFrame>;
}
