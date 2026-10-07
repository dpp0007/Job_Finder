// Starts the alert scheduler once, when the Next server boots (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || globalThis.__scoutTimer) return;
  const { tick } = await import('./lib/service.js');
  globalThis.__scoutTimer = setInterval(() => tick().catch(e => console.error('tick failed:', e.message)), 10 * 60 * 1000);
}
