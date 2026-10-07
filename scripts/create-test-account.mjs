// Creates (or resets) a local test account so you can sign in with email + password while developing: npm run test-account
// Reads TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD from .env.local. Refuses to touch anything but the local SQLite file.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));     // so .env and .env.local are found wherever you run it
if (process.env.NODE_ENV === 'production') { console.error('Refusing to run in production.'); process.exit(1); }
const { env } = await import('../lib/env.js');
const { checkEmail, checkPassword } = await import('../lib/password.js');

const email = checkEmail(env('TEST_ACCOUNT_EMAIL') || 'tester@example.com'), password = env('TEST_ACCOUNT_PASSWORD');
if (!email.ok || !password) { console.error('Set TEST_ACCOUNT_EMAIL and TEST_ACCOUNT_PASSWORD in .env.local first.'); process.exit(1); }
if (env('STORE') !== 'sqlite') { console.error('Refusing: STORE is not "sqlite", so this would write the test account into your real database.\nPut STORE=sqlite in .env.local and run again.'); process.exit(1); }
const pw = checkPassword(password, email.value);
if (!pw.ok) { console.error('That test password is not accepted by the password rules: ' + pw.error); process.exit(1); }

const { uidFor } = await import('../lib/auth.js');
const { hashPassword, saveCredential } = await import('../lib/credentials.js');
const { store } = await import('../lib/store.js');
const uid = uidFor(email.value);
await saveCredential(uid, { email: email.value, name: 'Test Account', hash: await hashPassword(password), created: Date.now(), fails: 0, lockedUntil: 0 });
await store.upsertUser({ uid, email: email.value, name: 'Test Account', picture: '' });
console.log(`Test account ready in ${(await store.info()).file}\n  email:    ${email.value}\n  password: see TEST_ACCOUNT_PASSWORD in .env.local\nStart the app with "npm run dev" and sign in at http://localhost:3000/login`);
process.exit(0);
