import { readPostings, useQuota, withFit } from '@/lib/service';
import { isJobId } from '@/lib/validate';
import { handler, json, readJson } from '@/lib/http';

// Opening a job (or showing the best results) whose text was never read: fetch the posting pages now and return the jobs, re-scored.
// Body: { jobId } for one job, or { jobIds: [...] } (up to 10) in the background.
export const POST = handler(async (req, { user }) => {
  const b = await readJson(req);
  const ids = (b.jobIds ? (Array.isArray(b.jobIds) ? b.jobIds : []) : [b.jobId]).filter(isJobId).slice(0, 10);
  if (!ids.length) return json({ error: 'Unknown job.' }, 400);
  await useQuota(user.uid, 'read', ids.length);
  const found = await readPostings(ids);
  if (!b.jobIds && !found.get(ids[0])) return json({ error: 'That job is no longer in your index. Run the search again.' }, 404);
  const jobs = [];
  for (const [, j] of found) { const { unreadable, ...job } = j; jobs.push({ ...(await withFit(user.uid, job, b.prefs)), read: !unreadable }); }
  return json(b.jobIds ? { jobs } : { job: jobs[0], read: jobs[0].read });
}, { limit: ['read', 40, 10 * 60_000] });
