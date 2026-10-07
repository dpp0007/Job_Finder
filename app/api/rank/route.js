import { ranked } from '@/lib/service';
import { handler, json } from '@/lib/http';

export const POST = handler(async req => {
  const b = await req.json();
  return json(await ranked(b.prefs, b.resume || ''));
});
