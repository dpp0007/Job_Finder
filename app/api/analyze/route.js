import { store, forUser } from '@/lib/store';
import { getResume, useQuota } from '@/lib/service';
import { cleanPrefs, resumeCtx, scoreJob } from '@/lib/rank';
import { parseDescription, descriptionText, groupBlocks } from '@/lib/describe';
import { basicFit, verdictOf } from '@/lib/fit';
import { analyzeFitLlm, llmEnabled, llmState } from '@/lib/llm';
import { isJobId } from '@/lib/validate';
import { handler, json, readJson } from '@/lib/http';

const refuse = (message, status) => Object.assign(new Error(message), { status, expose: true });
const WEEK = 7 * 864e5;

// Pros, cons and interview prep for one job against the signed-in user's resume. The language model writes it when it can;
// otherwise the same shape is built from the posting and resume directly, and the answer says which one you got.
export const POST = handler(async (req, { user }) => {
  const b = await readJson(req);
  const resume = await getResume(user.uid);
  if (!resume) throw refuse('Upload your resume first, then Scout can compare it with this job.', 400);
  if (!isJobId(b.jobId)) throw refuse('Unknown job.', 400);
  const job = await store.getJob(b.jobId);
  if (!job) throw refuse('That job is no longer in your index. Run the search again.', 404);
  const me = forUser(user.uid);

  const parsed = parseDescription(job.desc || '', job.title);
  const scored = { ...job, ...scoreJob(job, cleanPrefs(b.prefs), resumeCtx(resume)) };
  const base = basicFit(scored, resume, parsed.sections);

  const key = `fit2:${job.id}:${resume.at}`;
  const cached = await me.getKV(key, null);
  if (cached && Date.now() - cached.at < WEEK) return json({ ...cached.fit, fit: scored.fit, verdict: scored.fit != null ? verdictOf(scored.fit) : cached.fit.verdict, cached: true });

  if (!llmEnabled()) return json({ ...base, aiNote: llmState.error ? 'AI analysis is paused (' + llmState.error.message + ')' : 'AI analysis is off. Showing the analysis built from the posting and your resume.' });
  await useQuota(user.uid, 'analyze');
  try {
    const text = parsed.quality === 'none' ? (job.desc || '') : descriptionText(groupBlocks(parsed.blocks).primary);
    const facts = `Facts computed by Scout: the resume shows about ${resume.years ?? 'an unknown number of'} years of experience (${resume.level || 'level unknown'}); skills found on it: ${resume.skills.slice(0, 25).join(', ') || 'none'}; the posting asks for ${job.years != null ? job.years + '+ years' : 'no stated years'}${scored.fit != null ? `; resume fit score: ${scored.fit}/100` : ''}.`;
    const ai = await analyzeFitLlm(scored, resume.text, text, facts);
    const fit = { ...base, ...ai, verdict: scored.fit != null ? verdictOf(scored.fit) : ai.verdict || base.verdict, summary: ai.summary || base.summary, source: 'ai' };
    await me.setKV(key, { at: Date.now(), fit });
    return json({ ...fit, fit: scored.fit });
  } catch (e) {
    return json({ ...base, aiNote: e.message });
  }
}, { limit: ['analyze', 30, 10 * 60_000] });
