// Email-and-password accounts. Server only.
//  • Passwords are hashed with scrypt (memory-hard, per-user random salt) and never stored or logged in any other form.
//  • An account only comes into existence when the mailbox owner clicks the emailed link, so nobody can register someone else's
//    address (and pre-claim it before the real owner signs in with Google).
//  • One-time links are stored only as SHA-256 hashes and are deleted on first use.
//  • Repeated wrong passwords lock the account for a while; unknown addresses cost the same time as known ones.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { store } from './store.js';
import { uidFor } from './auth.js';

const scryptAsync = promisify(scrypt);
const N = 32768, R = 8, P = 1, KEYLEN = 64, MAXMEM = 96 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const dk = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${dk.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const dk = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), want.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM });
  return dk.length === want.length && timingSafeEqual(dk, want);
}

// Used when the address is unknown, so "no such account" takes as long as "wrong password".
let dummy = null;
export async function burnTime(password) { dummy ??= await hashPassword('not-a-real-password'); await verifyPassword(password, dummy); }

// ---------- accounts ----------
const credKey = uid => `cred:${uid}`;
export const getCredential = uid => store.getKV(credKey(uid), null);
export const saveCredential = (uid, c) => store.setKV(credKey(uid), c);
export const removeCredential = uid => store.setKV(credKey(uid), null);

const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;
// → { ok, user?, reason? }. `reason` is for the log only: the browser always gets one generic message.
export async function checkLogin(email, password) {
  const uid = uidFor(email), c = await getCredential(uid);
  if (!c?.hash) { await burnTime(password); return { ok: false, reason: 'unknown' }; }
  if (c.lockedUntil && c.lockedUntil > Date.now()) { await burnTime(password); return { ok: false, reason: 'locked' }; }
  if (!(await verifyPassword(password, c.hash))) {
    const fails = (c.fails || 0) + 1;
    await saveCredential(uid, { ...c, fails: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
    return { ok: false, reason: 'wrong' };
  }
  if (c.fails || c.lockedUntil) await saveCredential(uid, { ...c, fails: 0, lockedUntil: 0 });
  return { ok: true, user: { uid, email: c.email, name: c.name } };
}

// ---------- one-time links (email verification, password reset) ----------
const tokenKey = (kind, token) => `pend:${kind}:${createHash('sha256').update(token).digest('hex')}`;
export async function createLink(kind, payload, ttlMs) {
  const token = randomBytes(32).toString('base64url');
  await store.setKV(tokenKey(kind, token), { payload, exp: Date.now() + ttlMs });
  return token;
}
// Returns the payload once; the link is dead afterwards (unless consume is false: look without using it up).
export async function useLink(kind, token, { consume = true } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const k = tokenKey(kind, token), v = await store.getKV(k, null);
  if (!v || v.exp < Date.now()) return null;
  if (consume) await store.setKV(k, null);
  return v.payload;
}
