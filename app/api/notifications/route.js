import { listNotifications, markRead } from '@/lib/notify';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => json(await listNotifications()));

export const POST = handler(async req => {
  await markRead(await req.json());
  return json(await listNotifications());
});
