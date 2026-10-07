import { NextResponse } from 'next/server';
import { PROVIDERS, OAUTH_COOKIE, appUrl, b64url, challenge, clientIp, emailAllowed, safeNext, seal, setCookie, startSession, uidFor } from '@/lib/auth';
import { store } from '@/lib/store';
import { env } from '@/lib/env';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

// Step 1 of sign-in: send the browser to Google or GitHub. A random `state` and a PKCE verifier are sealed into a short-lived
// cookie so only the browser that started the sign-in can finish it.
export async function GET(req, { params }) {
  const { provider } = await params;
  const back = (code) => NextResponse.redirect(`${appUrl()}/login?error=${code}`, 303);
  try {
    if (!rateLimit('auth:' + clientIp(req), 20, 10 * 60_000).ok) return back('rate');
    if (provider === 'dev') {   // local development only: signs in DEV_LOGIN_EMAIL without a provider. Unavailable in production builds.
      const email = env('DEV_LOGIN_EMAIL');
      if (process.env.NODE_ENV === 'production' || !email || !emailAllowed(email)) return back('provider');
      await store.upsertUser({ uid: uidFor(email), email: email.toLowerCase(), name: 'Local developer', picture: '' });
      const res = NextResponse.redirect(`${appUrl()}${safeNext(new URL(req.url).searchParams.get('next'))}`, 303);
      res.headers.append('Set-Cookie', startSession({ email, name: 'Local developer' }));
      return res;
    }
    const P = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : null;
    if (!P || !P.id() || !P.secret()) return back('provider');
    const url = new URL(req.url), next = safeNext(url.searchParams.get('next'));
    const state = b64url(24), verifier = b64url(48);
    const q = new URLSearchParams({
      client_id: P.id(), redirect_uri: `${appUrl()}/api/auth/callback/${provider}`, response_type: 'code', scope: P.scope,
      state, code_challenge: challenge(verifier), code_challenge_method: 'S256',
      ...(provider === 'google' ? { prompt: 'select_account' } : {}),
    });
    const res = NextResponse.redirect(`${P.auth}?${q}`, 303);
    res.headers.append('Set-Cookie', setCookie(OAUTH_COOKIE, seal({ state, verifier, provider, next }, 'oauth', 10 * 60_000), { maxAge: 600, path: '/api/auth' }));
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) {
    console.error('sign-in start failed:', e.message);
    return NextResponse.redirect(new URL('/login?error=config', req.url), 303);
  }
}
