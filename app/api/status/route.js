import { all } from '@/lib/db';
import * as tf from '@/lib/tinyfish';
import '@/lib/service';
import { PORTALS } from '@/lib/discover';
import { handler, json } from '@/lib/http';
import { channels, listNotifications } from '@/lib/notify';
import { llmEnabled, llmKeyPresent, llmState, llmUsage, llmCostUsd } from '@/lib/llm';

// The key itself never leaves the server: the client only learns whether one is configured.
export const GET = handler(async () => json({
  configured: !!tf.cfg.key(), usage: tf.usage,
  portals: PORTALS.map(({ id, label }) => ({ id, label })),
  alerts: all('SELECT SUM(new_count) n FROM searches')[0].n || 0,
  ai: { enabled: llmEnabled(), keyPresent: llmKeyPresent(), problem: llmState.error?.message || null, model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', usage: llmUsage, costUsd: llmCostUsd() },
  unread: listNotifications().unread, channels: channels(),
  background: globalThis.__bg || 0, // slow tasks (e.g. an Agent on a hard site) still finishing after a search returned
}));
