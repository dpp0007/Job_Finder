import { verify } from '@/lib/service';
import { isJobId } from '@/lib/validate';
import { handler, json, readJson } from '@/lib/http';

export const POST = handler(async req => {
  const { jobId } = await readJson(req);
  if (!isJobId(jobId)) return json({ error: 'Unknown job.' }, 400);
  return json({ status: await verify(jobId) });
}, { limit: ['verify', 30, 10 * 60_000] });
