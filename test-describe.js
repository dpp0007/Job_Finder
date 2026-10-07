// Offline check of the description parser against real scraped samples: node test-describe.js
import assert from 'node:assert/strict';
import { parseDescription } from './lib/describe.js';

const INTERNSHALA = "# UI/UX Designer (WFH)\n\nActively hiring\n\nUI/UX Designer\n\nWork from home\n\nStart Date\n\nStarts Immediately\n\nCTC (ANNUAL)\n\n₹ 2,00,000 \n\n₹ 2,00,000 /year\n\nExperience\n\n1 year(s)\n\n1 year(s)\n\nApply By\n\n30 Oct' 26\n\nPosted 3 weeks ago\n\nJob\n\n742 applicants\n\n## About the job\n\nAbout the job  \nWe are looking for a creative and detail-oriented UI/UX designer with strong hands-on skills in Figma and Canva. The role involves designing intuitive, user-friendly interfaces for web and mobile products.  \n  \nResponsibilities include:  \n1. Design wireframes, user flows, and high-fidelity UI screens  \n2. Create visually appealing designs using Figma & Canva  \n3. Collaborate with product, marketing, and development teams  \n4. Ensure consistency in design systems and branding\n\n### Skill(s) required\n\nCanva\nFigma\nUI & UX Design\n\nEarn certifications in these skills\n\nLearn Figma\n\nLearn UI & UX Design\n\nWho can apply\n\nOnly those candidates can apply who:\n\n1. have minimum 1 years of experience\n\n### Other requirements\n\n1. Proficiency in Figma and Canva\n\n2. Basic understanding of UI/UX principles and usability\n\n### Salary\n\nProbation:\n\nDuration:\n\nSalary during probation:\n\nAfter probation:\n\nAnnual CTC: ₹ 2,00,000 /year\n\n### Number of openings\n\n2\n\n## About Toposel\n\nMumbai\n\nWebsite\n\nWe are an online digital marketing company.";

const LEVER = "## Senior Engineer, Sensor Integration (R5128)\n\nUnited States / Dallas, Texas\n\nFull Time Employee /\n\nOn-site\n\napply for this job\n\nShield AI is a venture-backed defense-tech company with the **mission** of protecting service members.\n\n### What you'll do:\n\n*Sensor Selection, Integration & Characterization*\n\n* Support sensor integration activities from specification through production\n* Develop and execute sensor characterization and calibration procedures\n\n### Required qualifications:\n\n- BS in engineering\n- 5+ years of experience";

const CUTSHORT = "UI UX Intern\n\nat Ungrammary\n\nUI UX Intern\n\nUngrammary\n\nCompany\n\nHome\n\nUI UX Intern at Ungrammary · Remote only · 0 - 2 years · ₹1L - ₹2L / yr · Bootstrapped · Remote only · Posted 5 Aug 2026\n\n# UI UX Intern\n\n## at Ungrammary\n\nPosted by Pronamika Goswami\n\n0 - 2 yrs\n\n₹1L - ₹2L / yr\n\nRemote only\n\nSkills\n\nFigma\n\nAdobe Photoshop\n\nWireframing\n\nLooking for an internship where you'll work on real products?\n\nAt Ungrammary, you'll contribute to live product design projects from day one.\n\n✨ What you'll do\n\n• Design user flows, wireframes, and high-fidelity UI\n\n• Learn and apply design systems\n\n🔍 We're looking for\n\n• Strong visual design and UX fundamentals\n\n• Proficiency in Figma";

const text = b => b.t === 'h' ? b.text : b.t === 'p' ? b.lines.join(' ') : b.t === 'list' ? b.items.join(' | ') : b.items.join(', ');
const all = r => r.blocks.map(text).join('\n');

// ---- Internshala ----
let r = parseDescription(INTERNSHALA, 'UI/UX Designer Work From Home Job');
const f = Object.fromEntries(r.facts.map(x => [x.label, x.value]));
assert.equal(f.Starts, 'Starts Immediately');
assert.equal(f.Pay, '₹ 2,00,000 /year', 'doubled value collapses to the fuller one');
assert.equal(f.Experience, '1 year(s)');
assert.equal(f['Apply by'], "30 Oct' 26");
assert.equal(f.Posted, '3 weeks ago'); assert.equal(f.Applicants, '742'); assert.equal(f.Openings, '2'); assert.equal(f.Type, 'Job');
assert.equal(r.facts.filter(x => x.label === 'Pay').length, 1, 'no duplicate Pay fact');
assert.ok(!/Actively hiring|Learn Figma|Earn certifications|Probation|Start Date|CTC \(ANNUAL\)/.test(all(r)), 'boilerplate and fact labels are gone from the body');
assert.equal(r.blocks[0].t, 'h'); assert.equal(r.blocks[0].text, 'About the job', 'repeated title and "Work from home" stripped');
const chips = r.blocks.find(b => b.t === 'chips');
assert.deepEqual(chips.items, ['Canva', 'Figma', 'UI & UX Design'], 'skills become chips');
const resp = r.blocks.findIndex(b => b.t === 'h' && b.text === 'Responsibilities include');
assert.ok(resp > 0 && r.blocks[resp + 1].t === 'list' && r.blocks[resp + 1].ordered && r.blocks[resp + 1].items.length === 4, 'numbered responsibilities form one list');
assert.ok(!r.blocks.some(b => b.t === 'h' && b.text === 'Salary'), 'empty Salary section removed');
assert.equal(r.blocks.filter(b => b.t === 'p' && b.lines.join('') === 'About the job').length, 0, 'repeated heading text removed');

// ---- Lever ----
r = parseDescription(LEVER, 'Senior Engineer, Sensor Integration (R5128)');
assert.ok(!/apply for this job/i.test(all(r)));
assert.ok(r.blocks.some(b => b.t === 'h' && b.text === "What you'll do"), 'trailing colon dropped from headings');
assert.ok(r.blocks.some(b => b.t === 'h' && b.text.startsWith('Sensor Selection')), 'italic line becomes a subheading');
assert.equal(r.blocks.find(b => b.t === 'list' && b.items[0].startsWith('Support')).items.length, 2);
assert.equal(r.blocks.find(b => b.t === 'list' && b.items[0].startsWith('BS')).items.length, 2, 'dash bullets');
assert.ok(r.blocks.some(b => b.t === 'p' && /\*\*mission\*\*/.test(b.lines.join(' '))), 'inline bold kept for the renderer');

// ---- Cutshort ----
r = parseDescription(CUTSHORT, 'UI UX Intern');
assert.deepEqual(r.blocks.find(b => b.t === 'chips').items, ['Figma', 'Adobe Photoshop', 'Wireframing']);
assert.ok(r.blocks.some(b => b.t === 'h' && b.text === "✨ What you'll do"), 'emoji headings');
assert.ok(!/Ungrammary · Remote only/.test(all(r)), 'metadata strip dropped');
assert.equal(r.facts.find(x => x.label === 'Posted'), undefined, 'a name after "Posted by" is not a date');

// ---- robustness ----
assert.deepEqual(parseDescription('', 'x'), { facts: [], blocks: [], trimmed: false });
assert.ok(parseDescription('Just a single plain sentence about the job.', 'x').blocks[0].t === 'p');
assert.equal(parseDescription('a'.repeat(7000), 'x').trimmed, true);
console.log('describe ok —', parseDescription(INTERNSHALA, 'x').blocks.length, 'blocks,', parseDescription(INTERNSHALA, 'x').facts.length, 'facts from the Internshala sample');
