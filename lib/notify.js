// Notifications: one function creates them, whether an alert run or the demo button fires it.
// Delivery: in-app (always, stored in the database) + desktop (the browser shows them) + optional Telegram push.
import { store } from './store.js';
import { env } from './env.js';

export const compact = j => ({ id: j.id, title: j.title, company: j.company, location: j.location, url: j.url, score: j.score });

export async function createNotification({ title, body, searchId = null, jobs = [], demo = false }) {
  const id = await store.addNotification({ title, body, searchId, jobs, demo });
  pushExternal({ title, body, jobs }).catch(e => console.error('external notification failed:', e.message));
  return id;
}

// Optional: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID and every alert is also pushed to your phone.
async function pushExternal({ title, body, jobs }) {
  const token = env('TELEGRAM_BOT_TOKEN'), chat = env('TELEGRAM_CHAT_ID');
  if (!token || !chat) return;
  const text = [title, body, '', ...jobs.slice(0, 5).map(j => `• ${j.title} — ${j.company}\n${j.url}`)].join('\n');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
  if (!r.ok) throw new Error(`Telegram ${r.status}`);
}

export const channels = () => ({ telegram: !!(env('TELEGRAM_BOT_TOKEN') && env('TELEGRAM_CHAT_ID')) });

export const listNotifications = () => store.listNotifications();
export const markRead = arg => store.markNotificationsRead(arg);
