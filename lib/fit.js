// "How do I fit this job?" for one posting and one resume: pros, cons and what to prepare.
// Built only from the posting's own text and the resume's facts, so it works without a language model; the model (llm.js) writes a richer version of the same shape.
import { levelOf } from './profile.js';

const FIELD = { ml: 'machine learning', de: 'data engineering', ds: 'data and analytics', mobile: 'mobile development', devops: 'DevOps and infrastructure', security: 'security', qa: 'quality and testing', design: 'design', pm: 'product management', sales: 'sales and customer success', swe: 'software engineering', marketing: 'marketing', hr: 'people and recruiting', finance: 'finance', ops: 'operations' };
const LV = ['intern', 'entry', 'mid', 'senior', 'lead'];
const list = (a, n = 5) => a.slice(0, n).join(', ') + (a.length > n ? ` and ${a.length - n} more` : '');
const yrs = n => `${+Number(n).toFixed(1)} year${n === 1 ? '' : 's'}`;
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

export const VERDICTS = { strong: 'Strong fit', good: 'Good fit', stretch: 'Stretch', long: 'Long shot', unknown: 'Limited detail' };
export const verdictOf = fit => (fit == null ? 'unknown' : fit >= 70 ? 'strong' : fit >= 50 ? 'good' : fit >= 30 ? 'stretch' : 'long');

// job: a ranked job (matched, missing, fit, skills…); resume: stored profile; sections: from parseDescription().sections
export function basicFit(job, resume, sections = {}) {
  const have = new Set(resume.skills || []);
  const req = job.skillsRequired?.length ? job.skillsRequired : job.skills || [];
  const reqHave = req.filter(s => have.has(s)), reqMiss = req.filter(s => !have.has(s));
  const nice = (job.skillsNice || []).filter(s => !have.has(s));
  const extra = (job.matched || []).filter(s => !(job.skills || []).includes(s));
  const ry = resume.years ?? null, level = resume.level || levelOf(ry);
  const pros = [], cons = [];

  if (reqHave.length) pros.push({ point: `You already have ${reqHave.length} of the ${req.length} skills listed`, detail: `${list(reqHave)}. Put these at the top of your resume and give each one a concrete result.` });
  if (job.years != null && ry != null && ry >= job.years) pros.push({ point: `Your experience meets what is asked`, detail: `The posting wants ${job.years}+ years; your resume shows about ${yrs(ry)}.` });
  else if (job.years == null && level && job.seniorityConf !== 'default' && level === job.seniority) pros.push({ point: 'Your level matches the role', detail: `This is a ${job.seniority}-level role and your resume reads ${level}-level.` });
  if (job.employmentType === 'intern' && ry != null && ry <= 1.5) pros.push({ point: 'Right stage for an internship', detail: 'Your resume shows little or no full-time experience, which is who internships are for.' });
  if (resume.families?.includes(job.family)) pros.push({ point: 'Same field as your background', detail: `Your resume is mostly ${FIELD[job.family] || 'in this field'}, which is what this role is.` });
  if (extra.length) pros.push({ point: 'Extra skills the posting mentions', detail: `${list(extra, 4)} appear in both your resume and the posting.` });

  if (reqMiss.length) cons.push({ point: `${reqMiss.length} listed skill${reqMiss.length > 1 ? 's' : ''} missing from your resume`, detail: `${list(reqMiss)}. If you have used them, add where and how. If not, build one small project with ${reqMiss[0]} before you apply.` });
  if (job.years != null && ry != null && ry < job.years) cons.push({ point: 'Less experience than asked', detail: `The posting wants ${job.years}+ years; your resume shows about ${yrs(ry)}. Show depth instead: ownership, scale and measurable results.` });
  else if (job.years == null && level && job.seniorityConf !== 'default' && LV.indexOf(job.seniority) - LV.indexOf(level) >= 2) cons.push({ point: 'The role is more senior than your resume', detail: `It is a ${job.seniority}-level role; your resume reads ${level}-level. Expect a stretch and lead with your strongest work.` });
  if (job.years != null && ry != null && ry >= job.years + 4 && job.years <= 3) cons.push({ point: 'You may look over-qualified', detail: `The role asks for ${job.years}+ years and you have about ${yrs(ry)}. Say why this role interests you and what you want to learn.` });
  if (job.employmentType === 'intern' && ry != null && ry >= 3) cons.push({ point: 'This is an internship', detail: `With about ${yrs(ry)} of experience, check that the pay and the scope suit you.` });
  if (resume.families?.length && job.family !== 'other' && !resume.families.includes(job.family)) cons.push({ point: 'Different field from your resume', detail: `Your resume is mostly ${FIELD[resume.families[0]] || resume.families[0]}; this role is ${FIELD[job.family] || job.family}. Explain what carries over.` });
  if (nice.length) cons.push({ point: 'Nice-to-haves you don’t show', detail: `${list(nice, 4)} are listed as a plus, not required.` });

  const tips = pros.length + cons.length;
  const skillLine = req.length ? `You cover ${reqHave.length} of the ${req.length} skills listed` : 'The posting lists no specific skills';
  const gap = cons[0] && reqMiss.length ? ` The main gap: ${list(reqMiss, 3)}.` : '';
  const summary = tips ? `${skillLine}${job.years != null && ry != null ? (ry >= job.years ? ' and meet the experience asked' : ', but have less experience than asked') : ''}.${gap}` : 'There is not enough detail in this posting to compare it with your resume.';

  // ---- preparation, taken from what this posting actually asks ----
  const focus = [
    ...reqMiss.slice(0, 4).map(topic => ({ topic, detail: 'Required, and not on your resume. Learn the basics and be ready to explain how your closest experience carries over.' })),
    ...reqHave.slice(0, 3).map(topic => ({ topic, detail: 'You have this. Prepare one example: what you built, your part in it and the result, with numbers if you can.' })),
  ];
  const questions = [];
  for (const r of (sections.resp || []).slice(0, 3)) questions.push({ q: `How would you approach this: “${cut(r.replace(/[.;:]$/, ''), 120)}”?`, tip: 'Pick the closest project you have done, say what you did and why, and name one trade-off.' });
  if (reqHave[0]) questions.push({ q: `Tell us about the hardest problem you solved using ${reqHave[0]}.`, tip: 'Cover the problem, your approach, what went wrong and the result.' });
  if (reqMiss[0]) questions.push({ q: `This role uses ${reqMiss[0]}. How quickly could you become productive with it?`, tip: 'Be honest. Show how you learned similar tools before and what you would build first.' });
  questions.push({ q: `Why ${job.company}, and why this role?`, tip: sections.about ? `Use what they say about themselves: “${cut(sections.about, 110)}”` : 'Name one thing about the product or team that you can speak about specifically.' });

  const plan = [`Read the posting twice. For each requirement, find the line on your resume that proves it, and mark the ones you can’t find.`];
  if (reqMiss.length) plan.push(`Close the biggest gap first: spend a few hours building one small thing with ${list(reqMiss.slice(0, 2), 2)} so you can discuss it from experience.`);
  if (sections.resp?.[0]) plan.push(`Prepare two short stories (situation, action, result) from your own work that match: “${cut(sections.resp[0], 110)}”.`);
  if (sections.about) plan.push(`Learn the company: ${job.company}. ${cut(sections.about, 150)}`);
  plan.push('Prepare two questions to ask them, such as how the team works and what success looks like in the first three months.');

  return {
    source: 'basic', verdict: verdictOf(job.fit), fit: job.fit ?? null, summary,
    pros: pros.slice(0, 5), cons: cons.slice(0, 5), prep: { focus, questions: questions.slice(0, 6), plan: plan.slice(0, 5) },
  };
}
