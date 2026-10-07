import { listNotifications, markRead } from '@/lib/notify';
import { isNumId } from '@/lib/validate';
import { handler, json, readJson } from '@/lib/http';

export const GET = handler(async (_req, { user }) => json(await listNotifications(user.uid)));

export const POST = handler(async (req, { user }) => {
  const b = await readJson(req);
  if (b.all !== true && !isNumId(b.id)) return json({ error: 'Unknown notification.' }, 400);
  await markRead(user.uid, b.all === true ? { all: true } : { id: Number(b.id) });
  return json(await listNotifications(user.uid));
});
