// Runs before every page request (not API routes: each API route checks the session itself, so a bypass here can never expose data).
//  1. Signed-out visitors are sent to /login (the sign-in, email-confirmation and password-reset pages stay open); signed-in visitors skip /login.
//  2. Adds a per-request Content-Security-Policy with a nonce, so only scripts Next itself emitted can run (blocks injected scripts).
import { NextResponse } from 'next/server';
import { currentUser } from './lib/auth.js';

const DEV = process.env.NODE_ENV !== 'production';

function csp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",                         // React inline style attributes; styles cannot run code
    "img-src 'self' data: https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ...(DEV ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

const OPEN = new Set(['/login', '/verify', '/reset']);

export function proxy(req) {
  const { pathname, search } = req.nextUrl;
  let user = null;
  try { user = currentUser(req); } catch { /* misconfigured: treated as signed out; /login explains */ }
  if (pathname === '/login' && user) return NextResponse.redirect(new URL('/', req.url));
  if (!OPEN.has(pathname) && !user) {
    const to = new URL('/login', req.url);
    if (pathname !== '/') to.searchParams.set('next', pathname + search);
    return NextResponse.redirect(to);
  }
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const policy = csp(nonce);
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', policy);
  return res;
}

export const config = { matcher: ['/((?!api/|_next/static|_next/image|icon.svg|favicon.ico).*)'] };
