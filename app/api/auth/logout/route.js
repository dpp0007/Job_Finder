import { endSession } from '@/lib/auth';
import { handler, json } from '@/lib/http';

// Ends the session. POST only, and the Origin check in handler() stops other sites from signing you out.
export const POST = handler(async () => json({ ok: true }, 200, { 'Set-Cookie': endSession() }), { public: true, limit: ['logout', 30, 10 * 60_000] });
