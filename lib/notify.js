// Notifications: one function creates them, whether an alert run or the demo button fires it.
// Delivery: in-app (always, stored in SQLite) + desktop (the browser polls and shows them) + optional Telegram push.
import { all, get, run } from './db.js';

export const compact = j => ({ id: j.id, title: j.title, company: j.company, location: j.location, url: j.url, score: j.score });

export function createNotification({ title, body, searchId = null, jobs = [], demo = false }) {
  const r = run('INSERT INTO notifications(created,title,body,search_id,jobs,demo) VALUES(?,?,?,?,?,?)', Date.now(), title, body, searchId, JSON.stringify(jobs), demo ? 1 : 0);
  pushExternal({ title, body, jobs }).catch(e => console.error('external notification failed:', e.message));
  return Number(r.lastInsertRowid);
}

// Optional: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env and every alert is also pushed to your phone.
async function pushExternal({ title, body, jobs }) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  const text = [title, body, '', ...jobs.slice(0, 5).map(j => `• ${j.title} — ${j.company}\n${j.url}`)].join('\n');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
  if (!r.ok) throw new Error(`Telegram ${r.status}`);
}

export const channels = () => ({ telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });

export function listNotifications() {
  const items = all('SELECT * FROM notifications ORDER BY id DESC LIMIT 30').map(n => ({ id: n.id, created: n.created, title: n.title, body: n.body, searchId: n.search_id, jobs: JSON.parse(n.jobs || '[]'), demo: !!n.demo, read: !!n.is_read }));
  return { items, unread: get('SELECT COUNT(*) n FROM notifications WHERE is_read=0').n };
}

export function markRead({ id, all: everything }) {
  if (everything) run('UPDATE notifications SET is_read=1'); else run('UPDATE notifications SET is_read=1 WHERE id=?', id);
}
