import { diagnose } from '@/lib/diagnose';
import { handler, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admins only (ADMIN_EMAILS). Shows pass/fail for each service and which build is deployed, never a secret.
// The result is cached for a minute so this endpoint cannot be used to spam your quotas.
export const GET = handler(async () => {
  const G = globalThis;
  if (G.__scoutDiag && Date.now() - G.__scoutDiag.at < 60_000) return json(G.__scoutDiag.v);
  const checks = await diagnose();
  const v = {
    ok: checks.every(c => c.ok !== false),
    summary: checks.every(c => c.ok !== false) ? 'Everything required is working.' : 'Something needs fixing: see the checks marked ok:false.',
    deployed: { commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null, region: process.env.VERCEL_REGION || null, host: process.env.VERCEL ? 'vercel' : 'other', node: process.version },
    checks,
  };
  G.__scoutDiag = { at: Date.now(), v };
  return json(v);
}, { admin: true });
