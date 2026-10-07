// Reads configuration. A value in .env wins over a system variable of the same name (a stale system variable must not
// shadow the key you just pasted). On hosts without a .env file (Vercel) it falls back to process.env.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// A service-account key pasted into .env as pretty-printed, multi-line JSON: a plain .env parser keeps only the first line ("{").
// Re-join the lines up to the closing brace so pasting the downloaded key file as-is just works.
function joinMultilineJson(text, vars) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([{[])\s*$/);
    if (!m) continue;
    const close = m[2] === '{' ? '}' : ']';
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== close) j++;
    if (j < lines.length) vars[m[1]] = lines.slice(i, j + 1).join('\n').replace(/^[^=]*=\s*/, '');
  }
  return vars;
}

let cache = { at: 0, vars: {} };
const fileVars = () => {
  if (Date.now() - cache.at > 5000) {
    try { const text = readFileSync('.env', 'utf8'); cache = { at: Date.now(), vars: joinMultilineJson(text, parseEnv(text)) }; } catch { cache = { at: Date.now(), vars: {} }; }
  }
  return cache.vars;
};

export const env = name => fileVars()[name]?.trim() || process.env[name]?.trim() || undefined;
