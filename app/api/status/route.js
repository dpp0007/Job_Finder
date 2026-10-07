import * as tf from '@/lib/tinyfish';
import { PORTALS } from '@/lib/discover';
import { handler, json, friendly } from '@/lib/http';
import { channels } from '@/lib/notify';
import { llmEnabled, llmKeyPresent, llmState, llmUsage } from '@/lib/llm';
import { store, forUser, health } from '@/lib/store';

// Keys never leave the server: the browser only learns whether one is configured. Usage totals and storage details are shown to admins only.
export const GET = handler(async (_req, { user }) => {
  const me = forUser(user.uid);
  const [h, info, alerts, unread] = await Promise.all([health(), store.info().catch(() => null), me.alertsNewTotal().catch(() => 0), me.notificationsUnread().catch(() => 0)]);
  return json({
    user: { email: user.email, name: user.name, picture: user.picture, admin: user.admin },
    configured: !!tf.cfg.key(),
    usage: user.admin ? tf.usage : null,
    portals: PORTALS.map(({ id, label }) => ({ id, label })),
    alerts, unread, channels: user.admin ? channels() : {},
    ai: { enabled: llmEnabled(), keyPresent: llmKeyPresent(), problem: user.admin ? llmState.error?.message || null : (llmState.error ? 'temporarily unavailable' : null), usage: user.admin ? llmUsage : { ok: 0 } },
    // ephemeral: data does not survive a restart (SQLite on a serverless host). error: the database could not be reached.
    storage: { kind: user.admin ? info?.kind || null : null, ephemeral: !!info?.ephemeral, error: h.ok ? null : (user.admin ? friendly(h.error) : 'Storage is unavailable right now.') },
    background: globalThis.__bg || 0, // slow tasks (e.g. an Agent on a hard site) still finishing after a search returned
  });
});
