import { ranked } from '@/lib/service';
import { handler, json, readJson } from '@/lib/http';

export const POST = handler(async (req, { user }) => json(await ranked(user.uid, (await readJson(req)).prefs)));
