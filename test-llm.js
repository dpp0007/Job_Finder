// Offline check of the Gemini extraction path against a local stand-in server: node test-llm.js
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpdir } from 'node:os';

process.chdir(tmpdir()); // the llm module reads ./.env: run from a directory without one so the real key never leaks into the test

delete process.env.GEMINI_API_KEY;
const llm = await import('./lib/llm.js');
const { buildJob } = await import('./lib/parse.js');

// 1. no key -> disabled, returns null, never throws
assert.equal(llm.llmEnabled(), false);
assert.equal(await llm.extractPosting({ title: 'x', desc: 'y', url: 'https://a.test' }), null);

// 2. validator: bad enums/types are dropped, monthly pay is annualised, junk is flagged
const c = llm.clean({ is_job_posting: true, company: 'Acme', title: 'Designer', locations: ['Delhi', 5, ''], work_mode: 'mars', employment_type: 'internship',
  seniority: 'entry', years_experience_min: '2', salary: { min: 25000, max: 40000, currency: 'INR', period: 'month' }, visa: 'sponsors',
  skills_required: ['Figma', 'figma', ' Prototyping '], skills_nice: 'nope', summary: 'x'.repeat(500), apply_deadline: '2026-11-30T00:00:00Z' });
assert.equal(c.workMode, null); assert.equal(c.employmentType, 'intern'); assert.equal(c.visa, 'yes');
assert.deepEqual(c.locations, ['Delhi']); assert.deepEqual(c.skillsRequired, ['figma', 'prototyping']); assert.deepEqual(c.skillsNice, []);
assert.deepEqual(c.salary, { min: 300000, max: 480000, currency: '₹', period: 'month' }); assert.equal(c.summary.length, 220); assert.equal(c.deadline, '2026-11-30');
assert.equal(llm.clean({ is_job_posting: false }).isJob, false);
assert.equal(llm.clean({ salary: { min: 5, max: 9, currency: 'INR', period: 'year' } }).salary, null, 'implausible pay dropped');
assert.equal(llm.clean('garbage'), null);

// 3. stand-in Gemini server
let last; let mode = 'ok';
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    last = { url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(b) };
    if (mode === 'credits') { res.writeHead(402, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Your prepayment credits are depleted. Please go to AI Studio.' } })); }
    if (mode === 'auth') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } })); }
    const text = mode === 'badjson' ? 'not json at all'
      : '```json\n' + JSON.stringify({ is_job_posting: true, company: 'Razorpay', title: 'Product Designer', locations: ['Bengaluru'], work_mode: 'hybrid', employment_type: 'full_time', seniority: 'mid',
        years_experience_min: 3, salary: { min: 1800000, max: 2400000, currency: 'INR', period: 'year' }, visa: 'no_sponsorship', skills_required: ['Figma', 'Design systems'], skills_nice: ['Framer'],
        summary: 'Design payment products used by millions of businesses.', apply_deadline: null }) + '\n```';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 200 } }));
  });
});
await new Promise(r => server.listen(0, r));
process.env.GEMINI_BASE = `http://127.0.0.1:${server.address().port}`;
process.env.GEMINI_API_KEY = 'test-key';
assert.equal(llm.llmEnabled(), true);

const base = buildJob({ company: 'Unknownco', title: 'Product Designer', url: 'https://x.test/j/1', location: '', ats: null, desc: 'We are hiring a designer. ' + 'Great team. '.repeat(40) });
const x = await llm.extractPosting(base);

// request shape: right model path, auth header, JSON mode, and none of the deprecated sampling params
assert.equal(last.url, '/v1beta/models/gemini-3.5-flash-lite:generateContent'); assert.equal(last.key, 'test-key');
assert.equal(last.body.generationConfig.responseMimeType, 'application/json');
for (const k of ['temperature', 'topP', 'topK', 'thinkingConfig']) assert.equal(last.body.generationConfig[k], undefined, k + ' must not be sent');
assert.match(last.body.contents[0].parts[0].text, /Product Designer/);
assert.equal(x.visa, 'no'); assert.equal(x.company, 'Razorpay'); assert.deepEqual(x.salary, { min: 1800000, max: 2400000, currency: '₹', period: 'year' });
assert.match(last.body.systemInstruction.parts[0].text, /1800000/, 'prompt explains lakh/LPA units');
assert.equal(llm.llmUsage.inTokens, 1500);

// 4. merge rules
const titled = buildJob({ company: 'Razorpay', title: 'Senior Designer', url: 'https://x.test/j/2', location: 'Pune', desc: 'We sponsor visas for this role. ' + 'x '.repeat(200) });
assert.equal(titled.visa, 'yes');
const m1 = llm.applyLlm(titled, x);
assert.equal(m1.visa, 'no', 'model corrects the regex on visa');
assert.equal(m1.seniority, 'senior', 'title-based seniority is never overwritten');
assert.equal(m1.location, 'Pune', 'existing location kept');
const m2 = llm.applyLlm(base, x);
assert.equal(m2.company, 'Razorpay', 'placeholder company replaced'); assert.equal(m2.location, 'Bengaluru'); assert.equal(m2.workMode, 'hybrid');
assert.deepEqual(m2.salary, { min: 1800000, max: 2400000, currency: '₹', period: 'year' }, 'pay filled from the model when the regex found none');
assert.ok(m2.skills.includes('design systems') && m2.skills.includes('framer')); assert.equal(m2.seniorityConf, 'llm'); assert.ok(m2.llm.at);
assert.equal(llm.applyLlm(base, { ...x, isJob: false }).junk, true);

// 5. failures are typed, never crash a search
mode = 'auth';
await assert.rejects(llm.extractPosting(base), e => e.code === 'ai_auth');
assert.equal(llm.llmEnabled(), false, 'a rejected key pauses AI reading');
llm.llmState.until = 0;
mode = 'credits';
await assert.rejects(llm.extractPosting(base), e => e.code === 'ai_credits' && /AI Studio/.test(e.message));
assert.equal(llm.llmEnabled(), false, 'AI reading pauses after a fatal error');
assert.match(llm.llmState.error.message, /credits/);
llm.llmState.until = 0; // end the cooldown for the remaining checks
mode = 'badjson';
await assert.rejects(llm.extractPosting(base), e => e.code === 'ai_parse');
assert.ok(llm.llmUsage.failed >= 2);

server.close();
console.log('llm ok — cost so far $' + llm.llmCostUsd());
