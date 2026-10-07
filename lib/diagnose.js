// Setup diagnosis: real calls against each service, with plain-language fixes.
// Used by `npm run check` (terminal) and GET /api/diagnose (your deployed app). Never returns a secret value.
import { env } from './env.js';
import { friendly } from './http.js';

const HOSTED = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
const WHERE = HOSTED ? "your host's environment variables (Vercel: Project → Settings → Environment Variables, with the **Production** box ticked), then redeploy because changes only apply to new deployments" : 'your .env file';

export async function diagnose({ ai = false } = {}) {
  const rows = [];
  const add = (ok, name, detail, fix) => rows.push({ ok, name, detail, ...(fix ? { fix } : {}) });

  // ---- TinyFish ----
  const tfKey = env('TINYFISH_API_KEY');
  if (!tfKey) add(false, 'TinyFish key', 'TINYFISH_API_KEY is not set', `Add TINYFISH_API_KEY to ${WHERE}.`);
  else {
    try {
      const r = await fetch('https://api.search.tinyfish.ai?query=job', { headers: { 'X-API-Key': tfKey }, signal: AbortSignal.timeout(20000) });
      if (r.status === 200) add(true, 'TinyFish key', 'Search answered');
      else if (r.status === 401) add(false, 'TinyFish key', 'TinyFish rejected the key', `The key is wrong, expired, or was pasted with quotes or spaces. Re-copy it into ${WHERE}.`);
      else if (r.status === 402) add(false, 'TinyFish key', 'TinyFish credits are used up', 'Top up your TinyFish wallet.');
      else if (r.status === 429) add(false, 'TinyFish key', 'TinyFish rate limit reached', 'Wait a minute and run the check again.');
      else add(false, 'TinyFish key', `TinyFish answered HTTP ${r.status}`);
    } catch (e) { add(false, 'TinyFish key', friendly(e), 'Check that this host can reach the internet.'); }
  }

  // ---- storage ----
  let kind = env('STORE') || (env('GOOGLE_SERVICE_ACCOUNT_JSON') ? 'firestore' : 'sqlite');
  try {
    const { store, health } = await import('./store.js');
    const info = await store.info();
    kind = info.kind;
    const h = await health();
    if (!h.ok) throw h.error;
    const probe = { at: Date.now(), note: 'written by the setup check' };
    await store.setKV('__check', probe);
    const back = await store.getKV('__check');
    if (back?.at !== probe.at) throw new Error('wrote a test value but read back something else');
    if (info.kind === 'firestore') add(true, `Storage: firestore (project ${info.project})`, 'connected; wrote and read back a test value');
    else if (info.ephemeral) add('warn', 'Storage: sqlite (temporary)', 'works, but data is lost when the server restarts', 'On Vercel, set GOOGLE_SERVICE_ACCOUNT_JSON to use Google Firestore for permanent data.');
    else add(true, 'Storage: sqlite', `working (${info.file})`);
  } catch (e) {
    add(false, `Storage: ${kind}`, friendly(e), kind === 'firestore' ? `Check GOOGLE_SERVICE_ACCOUNT_JSON in ${WHERE}. Paste the whole key file; the service account needs the "Cloud Datastore User" role and the Firestore database must exist (Native mode).` : undefined);
  }

  // ---- sign-in and security ----
  const list = n => (env(n) || '').split(/[,\s;]+/).filter(Boolean);
  const secret = env('AUTH_SECRET'), app = env('APP_URL');
  add(!!secret && secret.length >= 32, 'Sign-in secret', secret ? (secret.length >= 32 ? 'AUTH_SECRET is set' : 'AUTH_SECRET is shorter than 32 characters') : 'AUTH_SECRET is not set', `Set AUTH_SECRET to a random string of 32+ characters (run: openssl rand -base64 48) in ${WHERE}.`);
  add(!app ? false : /^https:\/\//.test(app) ? true : /^http:\/\/(localhost|127\.0\.0\.1)/.test(app) ? 'warn' : false, 'Site address', app ? (/^https:\/\//.test(app) ? `APP_URL is ${app}` : 'APP_URL does not start with https://') : 'APP_URL is not set', 'Set APP_URL to the public https address of this site, for example https://jobs.yourdomain.com.');
  const { configuredProviders } = await import('./auth.js');
  const provs = configuredProviders();
  add(provs.length > 0, 'OAuth providers', provs.length ? provs.map(p => p.label).join(', ') + ' configured' : 'no provider has a client id and secret', 'Create an OAuth client at Google (or GitHub) and set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or the GITHUB_ pair). See docs/DEPLOY.md.');
  const { mailConfigured } = await import('./mail.js');
  add(mailConfigured() ? (env('MAIL_FROM') && !/yourdomain|your-verified-domain/i.test(env('MAIL_FROM')) ? true : 'warn') : 'warn', 'Email (Resend)', mailConfigured() ? `sending as ${env('MAIL_FROM') || 'onboarding@resend.dev (test sender)'}` : 'RESEND_API_KEY is not set, so email sign-up and password reset are off', 'Create an API key at resend.com, verify your domain, then set RESEND_API_KEY and MAIL_FROM (an address on that verified domain). Google/GitHub sign-in works without it.');
  const open = env('ALLOW_ANY_SIGNIN') === 'true', allow = list('ALLOWED_EMAILS').length + list('ALLOWED_EMAIL_DOMAINS').length + list('ADMIN_EMAILS').length;
  add(open ? 'warn' : allow > 0, 'Who can sign in', open ? 'ANY Google/GitHub account can sign in (ALLOW_ANY_SIGNIN=true)' : allow ? `${allow} allowed address or domain entries` : 'nobody is allowed: ALLOWED_EMAILS, ALLOWED_EMAIL_DOMAINS and ADMIN_EMAILS are all empty', open ? 'Anyone can spend your TinyFish and Gemini credits. Prefer an allow-list.' : 'Add your email to ADMIN_EMAILS and others to ALLOWED_EMAILS.');
  add(list('ADMIN_EMAILS').length > 0, 'Admin', list('ADMIN_EMAILS').length ? 'ADMIN_EMAILS is set' : 'ADMIN_EMAILS is empty, so nobody can open the setup check', 'Set ADMIN_EMAILS to your own email address.');
  if (process.env.NODE_ENV === 'production' && env('TRUST_PROXY') !== 'true') add('warn', 'Reverse proxy', 'TRUST_PROXY is not true, so every visitor shares one address for rate limiting', 'If the app runs behind Nginx, Hostinger or Cloudflare, set TRUST_PROXY=true so each visitor is limited separately.');

  // ---- scheduled alerts ----
  if (env('CRON_SECRET') && env('CRON_SECRET').length >= 24) add(true, 'Scheduled alerts', 'CRON_SECRET is set, so /api/cron/tick can be called by a scheduler');
  else if (env('CRON_SECRET')) add(false, 'Scheduled alerts', 'CRON_SECRET is shorter than 24 characters, so the endpoint stays off', 'Use a long random value.');
  else add('skip', 'Scheduled alerts', 'CRON_SECRET is not set', HOSTED ? 'Only needed for scheduled alerts: add CRON_SECRET and point Cloud Scheduler at /api/cron/tick.' : undefined);

  // ---- Gemini (opt-in: a paid call) ----
  if (!ai) add('skip', 'Gemini', 'not tested (optional AI reading)');
  else if (!env('GEMINI_API_KEY')) add('skip', 'Gemini', 'GEMINI_API_KEY is not set (optional)');
  else {
    try {
      const { extractPosting } = await import('./llm.js');
      const x = await extractPosting({ title: 'UI/UX Design Intern', company: 'Acme', location: 'Delhi', url: 'https://example.com/job', desc: 'Design interfaces in Figma. Stipend ₹15,000 per month. Work from home. ' + 'Great team. '.repeat(20) });
      add(true, 'Gemini', `read a test posting (visa: ${x.visa})`);
    } catch (e) { add(false, 'Gemini', e.message, 'AI reading is optional. Everything else works without it.'); }
  }
  return rows;
}
