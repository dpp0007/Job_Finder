// Setup check: `npm run check` (add `-- --ai` to also test Gemini; that one call costs a fraction of a cent).
// Verifies each key and the database with real calls and says exactly what to fix. Reads your .env like the app does.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..')); // so .env is found wherever you run it from
const { env } = await import('../lib/env.js');
const { diagnose } = await import('../lib/diagnose.js');

console.log('\nScout setup check\n');
console.log('Settings found: ' + ['TINYFISH_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'CRON_SECRET', 'GEMINI_API_KEY'].map(n => `${n}=${env(n) ? 'set' : 'missing'}`).join('  ') + '\n');

const rows = await diagnose({ ai: process.argv.includes('--ai') });
for (const r of rows) {
  console.log(`${r.ok === true ? '  ✓' : r.ok === false ? '  ✗' : r.ok === 'warn' ? '  !' : '  –'} ${r.name} — ${r.detail}`);
  if (r.fix && r.ok !== true) console.log(`      fix: ${r.fix}`);
}
const failed = rows.filter(r => r.ok === false).length;
console.log(failed ? `\n${failed} problem${failed > 1 ? 's' : ''} to fix (see ✗ above).\n` : '\nAll good. Start the app with `npm run dev` and press Search live.\n');
process.exit(failed ? 1 : 0);
