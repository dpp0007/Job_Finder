import { forgetUser } from '@/lib/service';
import { endSession } from '@/lib/auth';
import { handler, json } from '@/lib/http';

// "Delete my data": erases the signed-in user's resume, preferences, tracker, alerts, watchlist and notifications, then signs them out.
export const DELETE = handler(async (_req, { user }) => {
  await forgetUser(user.uid);
  return json({ ok: true }, 200, { 'Set-Cookie': endSession() });
}, { limit: ['account', 5, 60 * 60_000] });
