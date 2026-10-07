# Deploying Scout to production (Hostinger)

This guide takes you from a fresh Hostinger account to a locked-down, HTTPS, login-protected Scout.
Hostinger sells two kinds of plans that can run it. **Use a VPS if you can**: you control the firewall and the process. The managed Node.js plan also works.

| | **A. Hostinger VPS** (recommended) | **B. Hostinger Node.js web app** (Business / Cloud plans) |
|---|---|---|
| You manage | The server (Ubuntu), Nginx, firewall | Nothing but the app and its settings |
| HTTPS | Free certificate with Certbot | Provided by Hostinger |
| Scheduled alerts | Run inside Scout | Run inside Scout while the app is running |
| Storage | Firestore (or SQLite on the VPS disk) | **Firestore** (the app folder may be replaced on every deploy) |

Both need **Node.js 22.13 or newer**, a **domain name**, and the credentials listed below.

---

## 1. Credentials you need

Collect these first. Everything marked **required** must be set or Scout refuses to start sign-in.

| Setting | Required | Where it comes from |
|---|---|---|
| `APP_URL` | **yes** | Your public address, `https://jobs.yourdomain.com` (no trailing slash) |
| `AUTH_SECRET` | **yes** | Generate: `openssl rand -base64 48` (32+ characters). Treat it like a password. |
| `ADMIN_EMAILS` | **yes** | Your own email address |
| `ALLOWED_EMAILS` and/or `ALLOWED_EMAIL_DOMAINS` | **yes** | Who may sign in. With both empty only admins can. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **yes, Google or GitHub** | Section 2 |
| `RESEND_API_KEY`, `MAIL_FROM` | **yes** for email + password sign-up | https://resend.com : *API Keys → Create*, then *Domains → Add* and add the DNS records they show (in Hostinger's DNS zone) until it says **Verified**. `MAIL_FROM` must be an address on that domain, e.g. `Scout <no-reply@yourdomain.com>`. Without it, email sign-up and password reset are off. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | optional | Section 3 |
| `TINYFISH_API_KEY` | **yes** | https://docs.tinyfish.ai/authentication |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **yes** (Firestore) | Section 4 |
| `TRUST_PROXY=true` | **yes** behind Nginx/Hostinger | Lets rate limits tell visitors apart |
| `GEMINI_API_KEY` | optional | https://aistudio.google.com/apikey (needs credits) |
| `CRON_SECRET` | optional | Only if you call `/api/cron/tick` from an outside scheduler. 24+ random characters. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | optional | Admin-only push alerts |
| `USER_DAILY_SEARCHES` / `_READS` / `_ANALYSES` | optional | Per-person daily limits (defaults 20 / 300 / 60) |

The full annotated list is in [`.env.example`](../.env.example).

## 2. Google sign-in (OAuth)

1. Open https://console.cloud.google.com/apis/credentials (use the same project as Firestore).
2. **OAuth consent screen** → User type **External** → app name *Scout*, your support email → scopes: `openid`, `email`, `profile` → save. While the app is in *Testing*, add every person who should sign in under **Test users**; to remove that limit choose **Publish app** (basic scopes need no Google review).
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorized JavaScript origins: leave empty (Scout uses a server-side redirect).
   - **Authorized redirect URIs: `https://jobs.yourdomain.com/api/auth/callback/google`** (exactly, with `https`).
4. Copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## 2b. Email and password accounts

People can also create an account with an email and password. Scout sends them a one-time confirmation link, so **an account only exists once the owner of that mailbox clicks it**. Passwords are stored as salted scrypt hashes; five wrong tries lock the account for 15 minutes; "Forgot password" sends a 30-minute one-time link.

1. Create a [Resend](https://resend.com) API key, verify your domain there, and set `RESEND_API_KEY` and `MAIL_FROM`.
2. Sign-up still follows your allow-list: an address that is not listed receives nothing (and the page does not say so, so strangers cannot probe it).
3. Send yourself a test: open `/login`, choose **Create account**, and check that the email arrives and the link signs you in.

## 3. GitHub sign-in (optional)

1. https://github.com/settings/developers → **New OAuth App**.
2. Homepage URL: `https://jobs.yourdomain.com`. **Authorization callback URL: `https://jobs.yourdomain.com/api/auth/callback/github`**.
3. Generate a client secret and copy both values into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

Scout only accepts a GitHub account that has a **verified primary email**, and a Google account whose email is verified.

## 4. Firestore (permanent storage)

1. In the Google Cloud project: **Firestore → Create database → Native mode**.
2. **IAM → Service accounts → Create**, role **Cloud Datastore User**. **Keys → Add key → JSON**. Put the whole file, on one line, into `GOOGLE_SERVICE_ACCOUNT_JSON` (or base64 of it).
3. Lock the database so nothing but your server can touch it: paste [`firestore.rules`](../firestore.rules) into **Firestore → Rules → Publish**. (Scout's server bypasses rules with its service account; this blocks everyone else.)
4. Never commit or email that key file. If it leaks, delete the key in IAM and create a new one.

---

## 5A. Hostinger VPS (Ubuntu 22.04 / 24.04)

Run as a normal user with sudo, **not root**.

```bash
# 1. Updates, firewall, brute-force protection
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx ufw fail2ban unattended-upgrades git
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable

# 2. Node.js 22 and PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs
sudo npm i -g pm2

# 3. The app
git clone <your-repo-url> scout && cd scout
cp .env.example .env && chmod 600 .env && nano .env        # fill in section 1
npm ci && npm run build
npm run check                                              # every line should be ✓

# 4. Run it, and keep it running after reboots
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup  # run the command it prints
```

**Nginx** (`/etc/nginx/sites-available/scout`, then `sudo ln -s` it into `sites-enabled` and `sudo nginx -t && sudo systemctl reload nginx`):

```nginx
limit_req_zone $binary_remote_addr zone=scout_auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=scout_api:10m  rate=120r/m;

server {
    listen 80;
    server_name jobs.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name jobs.yourdomain.com;
    # certificates are filled in by:  sudo certbot --nginx -d jobs.yourdomain.com
    server_tokens off;
    client_max_body_size 5m;                  # resume uploads (Scout allows 4 MB)

    location /api/auth/ {                     # sign-in endpoints: strictest limit
        limit_req zone=scout_auth burst=10 nodelay;
        include /etc/nginx/scout-proxy.conf;
    }
    location /api/ {
        limit_req zone=scout_api burst=60 nodelay;
        include /etc/nginx/scout-proxy.conf;
    }
    location / { include /etc/nginx/scout-proxy.conf; }
}
```

`/etc/nginx/scout-proxy.conf`:

```nginx
proxy_pass http://127.0.0.1:3000;
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, never append what the visitor sent
proxy_set_header X-Forwarded-Proto $scheme;
proxy_buffering off;                             # live search results stream to the browser
proxy_read_timeout 330s;                         # a deep search can run for 5 minutes
```

Then `sudo apt -y install certbot python3-certbot-nginx && sudo certbot --nginx -d jobs.yourdomain.com` (renews itself).
Also harden SSH: key-only login (`PasswordAuthentication no`) and `PermitRootLogin no` in `/etc/ssh/sshd_config`.

## 5B. Hostinger Node.js web app (managed hosting)

1. hPanel → **Websites → Add website → Node.js Apps**; import your GitHub repository (or upload a ZIP **without** `.env` and `node_modules`).
2. Framework **Next.js**, Node version **22.x**. Build command `npm run build`, start command `npm start`.
3. **Environment variables**: add every value from section 1 there (not in a file). Set `TRUST_PROXY=true`.
4. Use **Firestore** (section 4). Do not rely on SQLite here: the app folder can be replaced on each deploy.
5. Connect your domain and enable the free SSL; turn on **Force HTTPS**.
6. Deploy, then continue with section 6.

---

## 6. Verify before you invite anyone

1. `npm run check` (VPS) or open `https://jobs.yourdomain.com/api/diagnose` while signed in as admin: every row ✓.
2. Open the site signed out → you land on the sign-in page. `https://jobs.yourdomain.com/api/status` returns `401`.
3. Sign in with an allowed address → works. Sign in with another Google account → "isn't on the access list".
4. Paste your address into https://securityheaders.com and https://www.ssllabs.com/ssltest/ : expect **A** or better.
5. In a private window, upload a PDF resume, run a search, open a job. In a second account, confirm none of the first account's data is visible.

## 7. Running it

- **Update:** `git pull && npm ci && npm run build && pm2 restart scout`.
- **Add or remove a person:** edit `ALLOWED_EMAILS`, restart. Removal takes effect on their very next request.
- **Sign everyone out / rotate:** change `AUTH_SECRET` and restart. Do this at once if you suspect it leaked.
- **A person asks to be forgotten:** they can use *Account menu → Delete my data* themselves.
- **Logs:** `pm2 logs scout`. Scout never logs emails, tokens, resumes or cookies.
- **Backups:** Firestore → *Import/Export* to a Cloud Storage bucket on a schedule. Job postings are public and rebuild themselves; the personal data is what to protect.
- **Costs:** TinyFish and Gemini are charged to *your* keys. Keep the per-person daily limits low and watch both dashboards.
