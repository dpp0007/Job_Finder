// All data access goes through `store`. One async interface, two backends:
//   • SQLite    (default; local file, zero setup)
//   • Firestore (Google Cloud; used automatically when GOOGLE_SERVICE_ACCOUNT_JSON is set, for hosts like Vercel)
// Force one with STORE=sqlite|firestore. Backends are loaded lazily so the unused one costs nothing.
import { env } from './env.js';

function choose() {
  const forced = env('STORE');
  if (forced === 'sqlite' || forced === 'firestore') return forced;
  return env('GOOGLE_SERVICE_ACCOUNT_JSON') || process.env.FIRESTORE_EMULATOR_HOST ? 'firestore' : 'sqlite';
}

async function init() {
  if (choose() === 'firestore') return (await import('./store/firestore.js')).createFirestoreStore();
  return (await import('./store/sqlite.js')).createSqliteStore();
}

// One backend per process, shared by every Next route bundle. A failed start is not remembered, so the next call retries.
export function backend() {
  const G = globalThis;
  if (!G.__scoutStore) {
    const p = init();
    G.__scoutStore = p;
    p.catch(() => { if (G.__scoutStore === p) G.__scoutStore = null; });
  }
  return G.__scoutStore;
}

// Shared data: the job index and search cache are the same for everyone (public postings, no personal data).
const SHARED = [
  'info', 'getKV', 'setKV',
  'upsertJobs', 'getJob', 'loadJobs', 'knownUrls', 'saveJob', 'markJunk', 'setJobStatus', 'jobVerifiedAt',
  'upsertUser', 'getUser', 'listUsers', 'deleteUserData', 'dueSearches', 'openTrackedJobIds',
];
// Personal data: only reachable through forUser(uid), so a route cannot read someone else's tracker, resume, alerts or notifications.
const PERSONAL = [
  'trackerMap', 'trackerList', 'trackerSet', 'trackerRemove',
  'listSearches', 'hasSearchWithPrefs', 'countSearches', 'addSearch', 'patchSearch', 'deleteSearch', 'finishSearchRun', 'alertsNewTotal',
  'listCompanies', 'getCompany', 'addCompany', 'deleteCompany', 'updateCompany',
  'addNotification', 'listNotifications', 'notificationsUnread', 'markNotificationsRead',
];
export const store = Object.fromEntries(SHARED.map(m => [m, async (...args) => (await backend())[m](...args)]));

const UID = /^u_[a-f0-9]{24}$/;
export function forUser(uid) {
  if (!UID.test(uid || '')) throw Object.assign(new Error('Not signed in'), { status: 401 });
  const me = Object.fromEntries(PERSONAL.map(m => [m, async (...args) => (await backend())[m](uid, ...args)]));
  me.getKV = async (k, d = null) => (await backend()).getUserKV(uid, k, d);
  me.setKV = async (k, v) => (await backend()).setUserKV(uid, k, v);
  me.uid = uid;
  return me;
}

// Is storage reachable? Checked at most once a minute; the status endpoint reports the result.
export function health() {
  const G = globalThis;
  if (!G.__scoutHealth || Date.now() - G.__scoutHealth.at > 60_000) {
    G.__scoutHealth = { at: Date.now(), p: store.getKV('__health').then(() => ({ ok: true }), error => ({ ok: false, error })) };
  }
  return G.__scoutHealth.p;
}
