import { forUser } from '@/lib/store';
import { isJobId, STAGES } from '@/lib/validate';
import { handler, json, readJson } from '@/lib/http';

const refuse = message => Object.assign(new Error(message), { status: 400, expose: true });

export const GET = handler(async (_req, { user }) => json(await forUser(user.uid).trackerList()));

export const POST = handler(async (req, { user }) => {
  const b = await readJson(req), me = forUser(user.uid);
  if (!isJobId(b.jobId)) throw refuse('Unknown job.');
  if (!b.stage) await me.trackerRemove(b.jobId);
  else {
    if (!STAGES.includes(b.stage)) throw refuse('Unknown stage.');
    if (b.note != null && (typeof b.note !== 'string' || b.note.length > 2000)) throw refuse('Notes can be up to 2,000 characters.');
    await me.trackerSet(b.jobId, b.stage, b.note);   // note omitted: keep the existing note
  }
  return json({ ok: true });
});
