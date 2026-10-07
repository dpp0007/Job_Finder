// Sign-in, sessions and request guards. Server only.
//
// Design (kept small so it can be audited):
//  • Sign-in is OAuth 2.0 authorization-code flow with PKCE and a random `state` (Google and GitHub). Scout never sees or stores a password.
//  • A session is an AES-256-GCM sealed cookie: HttpOnly, Secure, SameSite=Lax, 7 days. It cannot be read or forged without AUTH_SECRET.
//  • Who may sign in is decided by YOU (ALLOWED_EMAILS / ALLOWED_EMAIL_DOMAINS), and re-checked on every request, so removing
//    someone locks them out at once. With no allow-list nobody can sign in (fail closed) unless ALLOW_ANY_SIGNIN=true.
//  • State-changing requests must come from this site (Origin check): cross-site request forgery is refused.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

const PROD = process.env.NODE_ENV === 'production';
const DAY = 864e5;
export const SESSION_DAYS = 7;

const fail = (message, status, code) => Object.assign(new Error(message), { status, code, expose: true });

// ---------- configuration ----------
const list = name => (env(name) || '').split(/[,\s;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
export const admins = () => list('ADMIN_EMAILS');
export const isAdmin = email => !!email && admins().includes(email.toLowerCase());

// The public address of the site, e.g. https://jobs.example.com. Used for OAuth redirects and the Origin check; never taken from request headers.
export function appUrl() {
  const raw = (env('APP_URL') || '').trim().replace(/\/+$/, '');
  if (!raw) {
    if (PROD) throw fail('Sign-in is not configured: set APP_URL to the public address of this site.', 503, 'config');
    return `http://localhost:${process.env.PORT || 3000}`;
  }
  let u; try { u = new URL(raw); } catch { throw fail('APP_URL is not a valid address.', 503, 'config'); }
  if (PROD && u.protocol !== 'https:') throw fail('APP_URL must start with https:// in production.', 503, 'config');
  return u.origin;
}
const secure = () => appUrl().startsWith('https:');

let devKey = null;
function key(purpose) {
  const secret = env('AUTH_SECRET');
  if (!secret || secret.length < 32) {
    if (PROD) throw fail('Sign-in is not configured: set AUTH_SECRET to a random string of at least 32 characters.', 503, 'config');
    devKey ??= randomBytes(32).toString('hex');   // development only: sessions end when the server restarts
  }
  return Buffer.from(hkdfSync('sha256', secret && secret.length >= 32 ? secret : devKey, 'scout', `scout:${purpose}:v1`, 32));
}

// ---------- sealed values (sessions, OAuth state) ----------
export function seal(obj, purpose, ttlMs) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(purpose), iv);
  c.setAAD(Buffer.from(purpose));
  const ct = Buffer.concat([c.update(JSON.stringify({ ...obj, exp: Date.now() + ttlMs }), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
export function unseal(value, purpose) {
  try {
    const b = Buffer.from(String(value), 'base64url');
    if (b.length < 29 || b.length > 4096) return null;
    const d = createDecipheriv('aes-256-gcm', key(purpose), b.subarray(0, 12));
    d.setAAD(Buffer.from(purpose)); d.setAuthTag(b.subarray(12, 28));
    const o = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    return o.exp > Date.now() ? o : null;
  } catch (e) { if (e.status) throw e; return null; }   // a tampered or expired value is simply "no session"
}

// ---------- cookies ----------
const SESSION = () => (secure() ? '__Host-scout_session' : 'scout_session');   // __Host-: only this exact host, only over HTTPS, whole site
export const OAUTH_COOKIE = 'scout_oauth';
export function readCookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return null;
}
export const setCookie = (name, value, { maxAge, path = '/' } = {}) =>
  `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax${secure() ? '; Secure' : ''}${maxAge != null ? `; Max-Age=${maxAge}` : ''}`;

// ---------- identity ----------
export const uidFor = email => 'u_' + createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 24);

export function emailAllowed(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) return false;
  if (isAdmin(e) || list('ALLOWED_EMAILS').includes(e)) return true;
  if (list('ALLOWED_EMAIL_DOMAINS').includes(e.split('@')[1])) return true;
  return env('ALLOW_ANY_SIGNIN') === 'true';
}

export function startSession(user) {
  const token = seal({ uid: uidFor(user.email), email: user.email.toLowerCase(), name: String(user.name || '').slice(0, 80), picture: safeAvatar(user.picture) }, 'session', SESSION_DAYS * DAY);
  return setCookie(SESSION(), token, { maxAge: SESSION_DAYS * 86400 });
}
export const endSession = () => setCookie(SESSION(), '', { maxAge: 0 });

// Only pictures from the sign-in providers' own image hosts are ever shown.
export const safeAvatar = u => (/^https:\/\/(lh3\.googleusercontent\.com|avatars\.githubusercontent\.com)\//.test(u || '') ? u : '');

// The signed-in user for a request, or null. Re-checks the allow-list every time.
export function currentUser(req) {
  const raw = readCookie(req, SESSION());
  const s = raw && unseal(raw, 'session');
  if (!s || !s.uid || !emailAllowed(s.email)) return null;
  return { uid: s.uid, email: s.email, name: s.name || '', picture: s.picture || '', admin: isAdmin(s.email) };
}
export function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw fail('Please sign in to continue.', 401, 'auth');
  return u;
}

// ---------- request guards ----------
// Where is this request really from? Only trust proxy headers when told the app sits behind one (TRUST_PROXY=true).
export function clientIp(req) {
  if (env('TRUST_PROXY') === 'true') {
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim().slice(0, 64);
    const xff = (req.headers.get('x-forwarded-for') || '').split(',').map(x => x.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1].slice(0, 64);   // the entry added by our own proxy, not one the client supplied
  }
  return 'direct';
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// The origins this site is legitimately served from: the configured address, its www / non-www twin, and the host the request
// was actually addressed to (the proxy's forwarded host when TRUST_PROXY is on). A page on another site can never send an Origin
// equal to any of these, so cross-site forgery stays blocked while the real site works however visitors reach it.
function ownOrigins(req) {
  const set = new Set();
  try {
    const u = new URL(appUrl());
    set.add(u.origin);
    set.add(`${u.protocol}//${u.hostname.startsWith('www.') ? u.hostname.slice(4) : 'www.' + u.hostname}${u.port ? ':' + u.port : ''}`);
  } catch { /* appUrl is validated where it is required */ }
  const trust = env('TRUST_PROXY') === 'true';
  const host = ((trust && req.headers.get('x-forwarded-host')) || req.headers.get('host') || '').split(',')[0].trim();
  if (/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) {
    const proto = trust ? (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim() || 'https' : new URL(req.url).protocol.replace(':', '');
    set.add(`${proto}://${host.toLowerCase()}`);
    if (PROD && trust) set.add(`https://${host.toLowerCase()}`);   // behind a TLS-terminating proxy the browser always used https
  }
  return set;
}

export function assertSameOrigin(req) {
  if (!UNSAFE.has(req.method)) return;
  const blocked = () => fail('Request blocked: it did not come from this site.', 403, 'origin');
  const origin = req.headers.get('origin');
  if (origin) { if (!ownOrigins(req).has(origin)) throw blocked(); return; }
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw blocked();
}

// A constant-time string comparison for secrets.
export function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest(), y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

// Only same-site paths: never an address on another host (open-redirect protection).
export const safeNext = n => (typeof n === 'string' && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(n) && n.length < 200 ? n : '/');

// ---------- OAuth providers ----------
// Development only: OAUTH_TEST_BASE points Google at a local fake so the whole flow can be tested offline. Compiled out of production builds.
const FAKE = process.env.NODE_ENV !== 'production' ? process.env.OAUTH_TEST_BASE : '';
export const PROVIDERS = {
  google: {
    label: 'Google', auth: FAKE ? FAKE + '/auth' : 'https://accounts.google.com/o/oauth2/v2/auth', token: FAKE ? FAKE + '/token' : 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile', id: () => env('GOOGLE_CLIENT_ID'), secret: () => env('GOOGLE_CLIENT_SECRET'),
    async profile(accessToken) {
      const p = await getJson(FAKE ? FAKE + '/userinfo' : 'https://openidconnect.googleapis.com/v1/userinfo', { Authorization: `Bearer ${accessToken}` });
      if (p.email_verified !== true) throw fail('Your Google email is not verified.', 403, 'unverified');
      return { email: p.email, name: p.name, picture: p.picture };
    },
  },
  github: {
    label: 'GitHub', auth: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email', id: () => env('GITHUB_CLIENT_ID'), secret: () => env('GITHUB_CLIENT_SECRET'),
    async profile(accessToken) {
      const h = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'scout-job-finder' };
      const [u, emails] = await Promise.all([getJson('https://api.github.com/user', h), getJson('https://api.github.com/user/emails', h)]);
      const primary = (Array.isArray(emails) ? emails : []).find(e => e.primary && e.verified);   // only a verified primary email counts
      if (!primary) throw fail('Your GitHub account has no verified primary email.', 403, 'unverified');
      return { email: primary.email, name: u.name || u.login, picture: u.avatar_url };
    },
  },
};
export const configuredProviders = () => Object.entries(PROVIDERS).filter(([, p]) => p.id() && p.secret()).map(([k, p]) => ({ id: k, label: p.label }));

async function getJson(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw fail(`The sign-in provider answered ${r.status}.`, 502, 'provider');
  return r.json();
}

export const b64url = n => randomBytes(n).toString('base64url');
export const challenge = verifier => createHash('sha256').update(verifier).digest('base64url');

export async function exchangeCode(provider, code, verifier) {
  const P = PROVIDERS[provider];
  const r = await fetch(P.token, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: P.id(), client_secret: P.secret(), code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `${appUrl()}/api/auth/callback/${provider}` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw fail('The sign-in provider refused the code.', 502, 'provider');
  return j.access_token;
}
