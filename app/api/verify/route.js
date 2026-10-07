import { verify } from '@/lib/service';
import { handler, json } from '@/lib/http';

export const POST = handler(async req => json({ status: await verify((await req.json()).jobId) }));
