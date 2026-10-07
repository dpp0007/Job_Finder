// Starts the alert scheduler once, when a long-running Next server boots (Node runtime only).
// Serverless instances (Vercel, Lambda) are short-lived and freeze between requests, so a background timer can't work there.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || globalThis.__scoutTimer) return;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY) return;
  try {
    const { tick } = await import('./lib/service.js');
    globalThis.__scoutTimer = setInterval(() => tick().catch(e => console.error('tick failed:', e.message)), 10 * 60 * 1000);
  } catch (e) {
    console.error('alert scheduler not started:', e.message); // a scheduler problem must never take the whole server down
  }
}
