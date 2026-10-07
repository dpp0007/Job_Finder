import { listNotifications, markRead } from '@/lib/notify';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => json(listNotifications()));

export const POST = handler(async req => {
  markRead(await req.json());
  return json(listNotifications());
});
