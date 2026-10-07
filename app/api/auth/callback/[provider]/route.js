import { NextResponse } from 'next/server';
import { PROVIDERS, OAUTH_COOKIE, appUrl, clientIp, emailAllowed, exchangeCode, readCookie, safeEqual, safeNext, setCookie, startSession, unseal } from '@/lib/auth';
import { store } from '@/lib/store';
import { rateLimit } from '@/lib/ratelimit';
import { uidFor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Step 2 of sign-in: the provider sends the browser back with a one-time code. Check the state, swap the code for a token
// (server to server), read the verified email, apply the allow-list, then start a session.
export async function GET(req, { params }) {
  const { provider } = await params;
  const to = (path, ...cookies) => {
    const res = NextResponse.redirect(`${appUrl()}${path}`, 303);
    for (const c of cookies) res.headers.append('Set-Cookie', c);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };
  const clearOauth = setCookie(OAUTH_COOKIE, '', { maxAge: 0, path: '/api/auth' });
  try {
    if (!rateLimit('auth:' + clientIp(req), 20, 10 * 60_000).ok) return to('/login?error=rate', clearOauth);
    const P = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : null;
    const url = new URL(req.url);
    const saved = unseal(readCookie(req, OAUTH_COOKIE) || '', 'oauth');
    const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
    if (!P || !saved || saved.provider !== provider || !state || !safeEqual(state, saved.state)) return to('/login?error=state', clearOauth);
    if (url.searchParams.get('error') || !code || code.length > 2048) return to('/login?error=denied', clearOauth);

    const token = await exchangeCode(provider, code, saved.verifier);
    const profile = await P.profile(token);
    if (!emailAllowed(profile.email)) {
      console.warn('sign-in refused: address not on the allow-list');   // the address is not logged: it is personal data
      return to('/login?error=not_allowed', clearOauth);
    }
    await store.upsertUser({ uid: uidFor(profile.email), email: profile.email.toLowerCase(), name: String(profile.name || '').slice(0, 80), picture: profile.picture });
    return to(safeNext(saved.next), clearOauth, startSession(profile));
  } catch (e) {
    console.error('sign-in failed:', e.code || '', e.message);
    return to(e.code === 'unverified' ? '/login?error=unverified' : '/login?error=failed', clearOauth);
  }
}
