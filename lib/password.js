// Password rules, shared by the browser (live strength meter) and the server (the real check). Pure functions.
// Follows current NIST guidance: length matters most, no forced symbol rules, and known-bad passwords are refused.

export const MIN_LENGTH = 10, MAX_LENGTH = 128;

// The most common passwords and keyboard walks. Anything containing one of the longer entries is refused too.
const COMMON = `password passw0rd p@ssw0rd p@ssword password1 password12 password123 password1234 12345678 123456789 1234567890 12345678910 qwertyuiop
qwerty123 qwerty1234 qwertyuiop123 asdfghjkl zxcvbnm1 1q2w3e4r 1q2w3e4r5t 1qaz2wsx iloveyou iloveyou1 letmein123 welcome123 welcome1234 admin1234 administrator
changeme123 abc123456 abcd1234 abcdefghij trustno1 monkey1234 dragon1234 football123 baseball123 superman123 sunshine123 princess123 master1234 shadow1234
login12345 passcode123 whatever123 freedom123 computer123 internet123 starwars123 pokemon123 hello12345 india12345 india@123 bharat123 welcome@123 admin@123
password@123 test@12345 user@12345 scout12345 scoutscout jobsearch123`.split(/\s+/);
const SEQ = '01234567890 abcdefghijklmnopqrstuvwxyz qwertyuiopasdfghjklzxcvbnm';

const has = (s, re) => re.test(s);

// → { ok, error, score } where score is 0 (refused) to 4 (strong), for the meter.
export function checkPassword(pw, email = '') {
  const p = String(pw ?? '');
  if (p.length < MIN_LENGTH) return { ok: false, score: Math.min(1, p.length ? 1 : 0), error: `Use at least ${MIN_LENGTH} characters. A few random words work well.` };
  if (p.length > MAX_LENGTH) return { ok: false, score: 0, error: `Use at most ${MAX_LENGTH} characters.` };
  const low = p.toLowerCase(), local = String(email).split('@')[0].toLowerCase();
  if (/^(.)\1+$/.test(p)) return { ok: false, score: 0, error: 'That is one character repeated. Choose something harder to guess.' };
  if (COMMON.some(c => (c.length >= 8 ? low.includes(c) : low === c))) return { ok: false, score: 0, error: 'That password is on lists attackers try first. Choose another.' };
  const letters = low.replace(/[^a-z0-9]/g, '');
  if (letters.length >= 8 && SEQ.split(' ').some(s => s.includes(letters.slice(0, 8)) || [...s].reverse().join('').includes(letters.slice(0, 8)))) return { ok: false, score: 0, error: 'That is a keyboard or alphabet sequence. Choose something less predictable.' };
  if (local.length >= 4 && low.includes(local)) return { ok: false, score: 0, error: 'Don’t put your email address in your password.' };
  const classes = [has(p, /[a-z]/), has(p, /[A-Z]/), has(p, /\d/), has(p, /[^A-Za-z0-9]/)].filter(Boolean).length;
  const unique = new Set(p).size;
  const score = p.length >= 16 && unique >= 9 ? 4 : p.length >= 13 && classes >= 2 ? 3 : p.length >= 10 && unique >= 6 ? (classes >= 3 ? 3 : 2) : 1;
  return { ok: true, score, error: '' };
}

export const STRENGTH = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

// Email and display name, checked the same way everywhere.
export function checkEmail(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  if (e.length > 254 || !/^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e)) return { ok: false, error: 'Enter a valid email address.' };
  return { ok: true, value: e };
}
export function checkName(raw) {
  const n = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 60 || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(n)) return { ok: false, error: 'Enter your name (letters only, 2 to 60 characters).' };
  return { ok: true, value: n };
}
