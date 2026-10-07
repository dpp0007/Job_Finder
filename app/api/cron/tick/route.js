import { tick } from '@/lib/service';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Runs every user's due alerts once. For hosts that cannot keep a background timer, an external scheduler (cron, Google Cloud
// Scheduler) calls this URL with "Authorization: Bearer <CRON_SECRET>". It stays disabled unless CRON_SECRET is set (min 24 chars):
// a run spends TinyFish and Gemini credits. Wrong guesses are rate-limited per address.
const run = handler(async req => {
  const secret = env('CRON_SECRET');
  if (!secret || secret.length < 24) return json({ error: 'Scheduled alerts are off. Set CRON_SECRET (24+ characters) to enable /api/cron/tick.' }, 503);
  if (!safeEqual(req.headers.get('authorization') || '', `Bearer ${secret}`)) return json({ error: 'Unauthorized' }, 401);
  return json({ ok: true, ...(await tick()) });
}, { public: true, limit: ['cron', 12, 10 * 60_000] });
export const GET = run;
export const POST = run;
