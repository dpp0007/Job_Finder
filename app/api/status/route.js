import * as tf from '@/lib/tinyfish';
import { PORTALS } from '@/lib/discover';
import { handler, json, friendly } from '@/lib/http';
import { channels } from '@/lib/notify';
import { llmEnabled, llmKeyPresent, llmState, llmUsage, llmCostUsd } from '@/lib/llm';
import { store, health } from '@/lib/store';

// The key itself never leaves the server: the client only learns whether one is configured.
export const GET = handler(async () => {
  const [h, info, alerts, unread] = await Promise.all([health(), store.info().catch(() => null), store.alertsNewTotal().catch(() => 0), store.notificationsUnread().catch(() => 0)]);
  return json({
    configured: !!tf.cfg.key(), usage: tf.usage,
    portals: PORTALS.map(({ id, label }) => ({ id, label })),
    alerts, unread, channels: channels(),
    ai: { enabled: llmEnabled(), keyPresent: llmKeyPresent(), problem: llmState.error?.message || null, model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', usage: llmUsage, costUsd: llmCostUsd() },
    // ephemeral: data does not survive a restart (SQLite on a serverless host). error: the database could not be reached.
    storage: { kind: info?.kind || null, ephemeral: !!info?.ephemeral, error: h.ok ? null : friendly(h.error) },
    background: globalThis.__bg || 0, // slow tasks (e.g. an Agent on a hard site) still finishing after a search returned
  });
});
