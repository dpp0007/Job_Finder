import { all, run, getJob } from '@/lib/db';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => json(
  all("SELECT t.job_id, t.stage, t.note, t.updated, j.status FROM tracker t LEFT JOIN jobs j ON j.id = t.job_id WHERE t.stage != 'hidden' ORDER BY t.updated DESC")
    .map(t => ({ ...t, job: getJob(t.job_id) })).filter(t => t.job)));

export const POST = handler(async req => {
  const b = await req.json();
  if (!b.stage) run('DELETE FROM tracker WHERE job_id=?', b.jobId);
  else run('INSERT INTO tracker(job_id,stage,note,updated) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET stage=excluded.stage, note=COALESCE(?, note), updated=excluded.updated',
    b.jobId, b.stage, b.note ?? '', Date.now(), b.note ?? null);
  return json({ ok: true });
});
