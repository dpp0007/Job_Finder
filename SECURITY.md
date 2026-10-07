# Security

Scout holds personal data (a resume, job preferences, notes) and spends money (TinyFish and Gemini credits). This page says what protects both, what does not, and how to report a problem.

## What is protected, and how

| Risk | Control | Where |
|---|---|---|
| A stranger uses the app or reads data | Every API route requires a signed session; pages redirect to `/login`. The check is in each route (`handler()`), so a bypass of the page guard still exposes nothing. | `lib/http.js`, `lib/auth.js`, `proxy.js` |
| Anyone with a Google account signs up | **Allow-list** (`ALLOWED_EMAILS`, `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`), re-checked on every request. Empty list = nobody gets in. | `emailAllowed()` |
| Password theft or reuse | **Email and password:** salted **scrypt** hashes (N=32768), 10+ characters, common and guessable passwords refused. **Google/GitHub:** OAuth 2.0 code flow with PKCE and a random `state`; only verified emails are accepted. | `lib/credentials.js`, `lib/password.js`, `app/api/auth/*` |
| Registering someone else's address | An account is created only after the **emailed one-time link** is confirmed (on a button press, so link scanners can't use it up). Links are stored as hashes, work once, and expire (24 h / 30 min). | `lib/credentials.js` |
| Password guessing, account probing | Per-address and per-account limits, **15-minute lockout after 5 wrong tries**, one generic error message, equal timing for unknown and known accounts, identical replies from sign-up and "forgot password" whether or not an address is allowed. | `app/api/auth/*` |
| Session theft or forgery | Session = AES-256-GCM sealed cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix, 7 days). Tampering fails authentication. | `seal()`, `startSession()` |
| One user reads another's data | Personal data is reachable only through `forUser(uid)`: SQLite queries always filter by `uid`; Firestore paths are `users/{uid}/…`. Ids from the browser are never trusted. Covered by tests on both backends. | `lib/store.js`, `test-store.js` |
| Cross-site request forgery | Every state-changing request must carry this site's `Origin` (or same-origin fetch metadata). | `assertSameOrigin()` |
| Cross-site scripting | Strict **Content-Security-Policy with a per-request nonce** (`strict-dynamic`), no inline script, `object-src 'none'`, `frame-ancestors 'none'`. React escapes all output. Links from scraped pages are only used if they are `http(s)`. | `proxy.js`, `safeHref()` |
| Clickjacking, sniffing, downgrade | `X-Frame-Options`, `X-Content-Type-Options`, HSTS (2 years, preload), `Referrer-Policy`, `Permissions-Policy`, COOP/CORP. `X-Powered-By` removed. | `next.config.mjs` |
| Open redirect after sign-in | `next` must be a same-site path. | `safeNext()` |
| Brute force and abuse | Per-address and per-user rate limits on every route, stricter on sign-in, search, uploads and AI calls. **Daily per-person quotas** protect your TinyFish/Gemini credits. | `lib/ratelimit.js`, `useQuota()` |
| Malicious uploads | Type decided by file **content**, not name; 4 MB cap; PDFs ≤ 8 pages with a read timeout; DOCX decompression capped (zip-bomb); anything that is not a resume is refused. | `lib/resume.js` |
| Injection through input | Every field is validated in the browser and on the server (`lib/validate.js`): length, characters, links/code/prompt-injection phrases, ids, enums, number ranges. Database access is parameterised. JSON bodies are capped at 64 KB. | `lib/validate.js`, `readJson()` |
| Prompt injection against the AI | Resume and posting text are marked as untrusted data in the prompts; the model's output is parsed into a fixed JSON shape, every field length-limited, and rendered as plain text. | `lib/llm.js` |
| Information leaks in errors | Unexpected errors are logged on the server and replaced with a generic message. | `publicMessage()` |
| Weak or missing secrets | `AUTH_SECRET` (32+ chars), `APP_URL` (https) are required in production or sign-in refuses to work. `CRON_SECRET` is compared in constant time and needs 24+ chars. | `lib/auth.js` |
| Open admin tools | `/api/diagnose`, usage totals and storage details are admin-only. Telegram receives only admins' alerts. | `handler({ admin: true })` |
| Direct database access | Firestore rules deny every client request (`firestore.rules`); only the server's service account can read or write. | `firestore.rules` |
| Vulnerable dependencies | `npm audit` reports 0 known vulnerabilities; the app has only five runtime dependencies. | `package.json` |

## Known limits (be aware)

- **Sessions are stateless.** Signing out clears the cookie, and removing someone from the allow-list blocks them at once, but a copied cookie of an *allowed* user stays valid for up to 7 days. To end every session immediately, change `AUTH_SECRET`.
- **Rate limits are in memory** and per process. Run **one** instance (the default) and keep the Nginx limits from `docs/DEPLOY.md` as a second layer.
- **Third parties see some data.** TinyFish receives search queries and job URLs. If `GEMINI_API_KEY` is set, Google Gemini receives resume text and posting text for analysis. Say so in your privacy notice. Without a Gemini key, neither leaves your server.
- **Scraped content is untrusted.** It is validated and escaped, but Scout cannot vouch for what a third-party posting says. Users should confirm details on the employer's site.
- **Stored data is not encrypted by Scout itself.** Firestore encrypts at rest; on a VPS using SQLite, rely on disk encryption and file permissions (`chmod 600 .env`, restrict `data/`).
- **No second factor.** Password accounts have one factor; Google/GitHub accounts are as strong as the provider's 2-step verification (ask users to enable it).
- **A password reset does not end sessions that already exist** (they are stateless, up to 7 days). Change `AUTH_SECRET` to end them all.
- **Email sign-up depends on your mailbox.** Anyone who controls an allowed mailbox controls that Scout account; protect those mailboxes.

## Before you go live

- [ ] `npm test` passes (includes `test-auth.js`, the security suite) and `npm audit` is clean.
- [ ] `npm run check` shows no ✗.
- [ ] `APP_URL` is `https://…`, `AUTH_SECRET` is random, `.env` is `chmod 600` and **not** in git (`git ls-files | grep .env` prints only `.env.example`).
- [ ] The allow-list contains only people you intend. `ALLOW_ANY_SIGNIN` is **not** set.
- [ ] Firestore rules are published; the service-account key is stored only on the server.
- [ ] HTTPS grade A on SSL Labs; security headers grade A on securityheaders.com.
- [ ] You signed in with an allowed and a non-allowed account and saw the right result; a second user cannot see the first's resume.

## Reporting a vulnerability

Please do not open a public issue. Email the address listed on the repository profile with steps to reproduce. You will get an acknowledgement within a few days; fixes for confirmed problems are released as soon as they are tested.
