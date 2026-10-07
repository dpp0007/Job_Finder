// Forgiving search terms: "Backend Devloper" and "Banglore" should still find Backend Developer jobs in Bangalore.
// Pure functions. Only words that are NOT known are snapped, and only to a close known word, so real terms are never changed.

// Words people type in role titles and city names (lowercase).
const WORDS = `software developer engineer engineering frontend backend fullstack full stack front back end web mobile android ios cloud devops
data scientist science analyst analytics machine learning intelligence artificial research researcher product manager management designer design
marketing sales business development quality assurance tester testing automation security network database administrator technical program project
growth brand social media content writer graphic operations finance accountant human resources recruiter support customer success consultant
associate intern internship trainee fresher junior senior lead principal staff architect specialist executive coordinator embedded systems platform
infrastructure reliability site solutions technology digital strategy planning logistics supply chain procurement legal compliance risk audit
teacher trainer mentor director head vice president officer assistant representative advisor engineer developer programmer
remote hybrid onsite india delhi noida gurgaon gurugram ghaziabad faridabad mumbai pune bangalore bengaluru hyderabad chennai kolkata ahmedabad
jaipur chandigarh mohali kochi cochin coimbatore indore lucknow nagpur bhubaneswar surat vadodara thane karnataka maharashtra telangana kerala
singapore london dubai berlin toronto sydney amsterdam paris`.split(/\s+/);

// Technology names are valid as typed: never touch them (and never snap onto them by accident).
const KEEP = new Set(`rust scala swift kotlin golang ruby php dart flutter django flask spring redis kafka spark azure nextjs nodejs react vue svelte
unity unreal java python javascript typescript angular node sql nosql graphql docker kubernetes terraform linux aws gcp figma sketch tableau excel
power bi looker dbt airflow snowflake mongodb postgres mysql haskell elixir erlang clojure perl matlab solidity cobol fortran swiftui jetpack
tensorflow pytorch pandas numpy hadoop flink`.split(/\s+/));
const VOCAB = [...new Set(WORDS)];
const KNOWN = new Set([...VOCAB, ...KEEP]);

// Optimal-string-alignment distance: insertions, deletions, substitutions and swapped neighbours ("develoepr").
function distance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

function snap(word) {
  const w = word.toLowerCase();
  if (w.length < 5 || KNOWN.has(w) || !/^[a-z]+$/.test(w)) return word;     // short words, known words and anything with digits/symbols stay
  const limit = w.length >= 8 ? 2 : 1;
  let best = null, bestD = limit + 1;
  for (const v of VOCAB) {
    if (v[0] !== w[0] || Math.abs(v.length - w.length) > limit) continue;     // same first letter: far fewer false snaps
    const dist = distance(w, v);
    if (dist < bestD) { best = v; bestD = dist; }
  }
  if (!best) return word;
  return word[0] === word[0].toUpperCase() ? best[0].toUpperCase() + best.slice(1) : best; // keep the capital letter
}

export const isKnownWord = w => KNOWN.has((w || '').toLowerCase());
export const correctTerm = text => (text || '').replace(/[A-Za-z]+/g, snap);

// Corrects each term in a list; returns the new list and what changed, for showing "Showing results for…".
export function correctTerms(list = []) {
  const terms = [], changes = [];
  for (const t of list) { const c = correctTerm(t); terms.push(c); if (c !== t) changes.push({ from: t, to: c }); }
  return { terms, changes };
}
