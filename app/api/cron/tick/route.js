import { tick } from '@/lib/service';
import { env } from '@/lib/env';
import { handler, json } from '@/lib/http';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Runs the due alerts once. Serverless hosts cannot keep a background timer, so an external scheduler (Google Cloud Scheduler,
// Vercel Cron, cron-job.org) calls this URL. It stays disabled unless CRON_SECRET is set: a run spends TinyFish and Gemini credits.
const run = handler(async req => {
  const secret = env('CRON_SECRET');
  if (!secret) return json({ error: 'Scheduled alerts are off. Set CRON_SECRET to enable /api/cron/tick.' }, 503);
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);
  return json({ ok: true, ...(await tick()) });
});
export const GET = run;
export const POST = run;
