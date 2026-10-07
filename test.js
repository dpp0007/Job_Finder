// Offline self-check for feature extraction, ranking and dedupe: node test.js
import assert from 'node:assert/strict';
import { buildJob, detectSeniority, detectVisa, parseSalary, detectWorkMode } from './lib/parse.js';
import { rankJobs, dedupe } from './lib/rank.js';

assert.deepEqual(detectSeniority('Senior Data Scientist'), ['senior', 'title']);
assert.deepEqual(detectSeniority('Software Engineering Intern'), ['intern', 'title']);
assert.equal(detectSeniority('Product Manager')[0], 'mid');
assert.equal(detectSeniority('Engineering Manager')[0], 'lead');
assert.equal(detectSeniority('Software Engineer', 0)[0], 'entry');
assert.equal(detectVisa('We do not offer visa sponsorship.'), 'no');
assert.equal(detectVisa('Visa sponsorship is available for this role.'), 'yes');
assert.equal(detectVisa('You must be legally authorized to work in the United States.'), 'auth');
assert.deepEqual(parseSalary('Pay range: $120,000 - $160,000 per year'), { min: 120000, max: 160000, currency: '$', period: 'year' });
assert.equal(parseSalary('$60 - $80 / hour').min, 124800);
assert.equal(parseSalary('$120-160k').max, 160000);
assert.equal(detectWorkMode('Data Scientist', 'Remote - US'), 'remote');

const mk = (o) => buildJob({ company: 'Acme', url: 'https://x.test/' + Math.random(), desc: 'Python SQL machine learning. ' + (o.desc || ''), ...o });
const jobs = [
  mk({ title: 'Data Scientist', location: 'Bengaluru, India', ats: 'greenhouse', desc: 'Visa sponsorship is available.', postedAt: Date.now() - 864e5 }),
  mk({ title: 'Data Scientist', location: 'Bengaluru, India', ats: null, source: 'builtin' }),            // same job, other portal
  mk({ title: 'Senior Data Scientist', location: 'Remote', ats: 'lever' }),
  mk({ title: 'Staff Software Engineer', location: 'Berlin', ats: 'lever' }),
  mk({ title: 'Data Scientist Intern', location: 'Bengaluru', ats: 'ashby', desc: 'We do not sponsor visas.' }),
];
assert.equal(dedupe(jobs).length, 4, 'cross-portal duplicate merged');
const merged = dedupe(jobs).find(j => j.title === 'Data Scientist' && j.sources.length === 2);
assert.equal(merged.ats, 'greenhouse', 'ATS source wins as apply link');

const r = rankJobs(jobs, { roles: ['Data Scientist'], locations: ['India'], seniority: ['entry', 'mid'], visa: 'need' }, 'python sql');
assert.equal(r.results[0].title, 'Data Scientist');
assert.ok(r.dropped.role >= 1, 'filters report why they dropped jobs');
assert.ok(!r.results.some(j => j.visa === 'no'), 'visa=no filtered when sponsorship needed');
console.log('ok —', r.results.length, 'ranked,', JSON.stringify(r.dropped));

// near misses: right role, one soft filter off -> shown instead of a dead end
const nm = rankJobs(jobs, { roles: ['Data Scientist'], locations: ['India'], seniority: ['senior'] });
assert.ok(nm.near.every(j => j.missed), 'near misses carry the filter they missed');
console.log('near ok —', nm.results.length, 'exact,', nm.near.length, 'near');

// whole-word title matching: 'UI/UX' must not match 'Linux'
import { titleRelevance } from './lib/rank.js';
assert.ok(titleRelevance('Embedded Linux Software Engineer', ['UI/UX']) < 0.5);
assert.ok(titleRelevance('UI/UX Design Intern', ['UI/UX']) >= 0.9);
assert.ok(titleRelevance('Product Designer', ['UI/UX']) >= 0.5);
console.log('title matching ok');

// Indian pay formats and city aliases
import { parseSalary as ps } from './lib/parse.js';
import { locMatch } from './lib/rank.js';
assert.deepEqual(ps('CTC ₹6-10 LPA'), { min: 600000, max: 1000000, currency: '₹', period: 'year' });
assert.equal(ps('Stipend ₹25,000 - ₹40,000 per month').period, 'month');
assert.equal(ps('INR 12,00,000 - 18,00,000').max, 1800000);
assert.ok(locMatch('Bangalore, Karnataka', ['Bengaluru']) && locMatch('Gurugram', ['Delhi']), 'Indian city aliases');
console.log('india ok');

assert.equal(detectSeniority('Software Engineer 2')[0], 'mid');
assert.equal(detectSeniority('Software Engineer 1')[0], 'entry');
assert.equal(detectSeniority('Software Engineer 3')[0], 'senior');
console.log('level numbers ok');

// ---- filters must actually filter ----
import { dropReasons, titleRelevance as tr } from './lib/rank.js';
const mkj = o => buildJob({ company: 'Co', url: 'https://x.test/' + Math.random(), desc: 'We build things with React and Python. ' + 'x '.repeat(150), ...o });
const prefs = { roles: ['Frontend Developer'], locations: ['Delhi'], workMode: 'remote', types: ['intern'], keywords: ['react', 'figma'], keywordMode: 'any', minSalary: 500000 };

// role: same field passes, different field does not
assert.ok(tr('Front End Software Engineer', ['Frontend Developer']) >= 0.9);
assert.ok(tr('Frontend Intern', ['Frontend Developer']) >= 0.8);
for (const t of ['Embedded Software Engineer Co-op', 'Flight Software Engineer', 'Senior Backend Engineer']) assert.ok(tr(t, ['Frontend Developer']) < 0.5, t);

// remote must be stated, and "Remote - US" is not Delhi
assert.ok(dropReasons(mkj({ title: 'Frontend Intern', location: 'Cambridge, MA' }), prefs).includes('location'), 'unstated work mode is not remote');
assert.ok(dropReasons(mkj({ title: 'Frontend Intern', location: 'Remote - US' }), prefs).includes('location'), 'foreign remote rejected');
assert.ok(!dropReasons(mkj({ title: 'Frontend Intern', location: 'Remote - India' }), prefs).includes('location'), 'remote India accepted');
assert.ok(!dropReasons(mkj({ title: 'Frontend Intern', location: 'Remote' }), prefs).includes('location'), 'global remote accepted');

// keywords filter unless set to boost; pay filter only when asked
const noKw = mkj({ title: 'Frontend Intern', location: 'Remote - India', desc: 'Make coffee and answer phones. ' + 'x '.repeat(150) });
assert.ok(dropReasons(noKw, prefs).includes('keywords'));
assert.ok(!dropReasons(noKw, { ...prefs, keywordMode: 'boost' }).includes('keywords'));
const noPay = mkj({ title: 'Frontend Intern', location: 'Remote - India' });
assert.ok(!dropReasons(noPay, prefs).includes('pay'), 'unlisted pay passes by default');
assert.ok(dropReasons(noPay, { ...prefs, payOnly: true }).includes('pay'), 'payOnly hides unlisted pay');
console.log('filters ok');

// aggregator titles, internship stipends vs pay floor
import { parseListingTitle } from './lib/parse.js';
assert.deepEqual(parseListingTitle('Timble Technologies is hiring Frontend Developer job in Delhi'), { company: 'Timble Technologies', title: 'Frontend Developer', location: 'Delhi' });
assert.deepEqual(parseListingTitle('Front End Development Internship in Delhi at EkoSight Technologies'), { title: 'Front End Development Internship', location: 'Delhi', company: 'EkoSight Technologies' });
assert.equal(parseListingTitle('Software Engineer'), null);
const stip = mkj({ title: 'Frontend Intern', location: 'Remote - India', desc: 'Stipend ₹15,000 - ₹20,000 per month. ' + 'x '.repeat(150) });
assert.ok(stip.salary && stip.employmentType === 'intern');
assert.ok(!dropReasons(stip, { ...prefs, workMode: 'any', keywordMode: 'boost' }).includes('salary'), 'pay floor ignores internship stipends');
console.log('listing titles ok');

assert.equal(mkj({ title: 'x role' }).pv, 2, 'jobs record the parser version');
console.log('parser version ok');
