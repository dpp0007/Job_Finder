'use client';
import { safeHref } from '@/lib/client';
import { useEffect, useRef } from 'react';
import { useScout } from './ScoutProvider';
import { ago, cleanTitle } from '@/lib/client';

const BellIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>;

// Notification center: what alerts found, plus the state of each delivery channel.
export default function Bell() {
  const { notifs, bellOpen, setBellOpen, markRead, perm, enableDesktop, sendDemo, setTab, status } = useScout();
  const ref = useRef(null);
  useEffect(() => {
    if (!bellOpen) return;
    const away = e => { if (ref.current && !ref.current.contains(e.target)) setBellOpen(false); };
    const esc = e => e.key === 'Escape' && setBellOpen(false);
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [bellOpen, setBellOpen]);

  const { items, unread } = notifs;
  const telegram = status?.channels?.telegram;
  return (
    <div className="bell" ref={ref}>
      <button className="iconbtn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={bellOpen} onClick={() => setBellOpen(o => !o)}>
        <BellIcon />{unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}
      </button>
      {bellOpen && (
        <div className="bellpanel" role="dialog" aria-label="Notifications">
          <div className="bp-head"><b>Notifications</b>{unread > 0 && <button className="link sm" onClick={() => markRead({ all: true })}>Mark all read</button>}</div>
          <div className="bp-list">
            {!items.length && (
              <div className="bp-empty">
                <p><b>No notifications yet.</b></p>
                <p className="muted sm">When a saved search finds new openings, you’ll be told here. Create an alert, or see what one looks like.</p>
                <div className="row wrap" style={{ justifyContent: 'center' }}>
                  <button className="primary" onClick={() => { setBellOpen(false); setTab('alerts'); }}>Create an alert</button>
                  <button className="ghost" onClick={sendDemo}>Send a demo alert</button>
                </div>
              </div>
            )}
            {items.map(n => (
              <div className={'nitem' + (n.read ? '' : ' unread')} key={n.id} onClick={() => !n.read && markRead({ id: n.id })}>
                <div className="ntitle">{n.demo && <span className="badge brand">Demo</span>}<b>{n.title}</b></div>
                <div className="muted sm">{ago(n.created)}</div>
                {n.jobs.slice(0, 3).map(j => (
                  <a key={j.id} className="njob" href={safeHref(j.url)} target="_blank" rel="noopener noreferrer"><span className="clip"><b>{cleanTitle(j.title)}</b> · {j.company}</span><span>↗</span></a>
                ))}
              </div>
            ))}
          </div>
          <div className="bp-foot">
            <div className="chan"><span>In-app</span><span className="ok-t">On</span></div>
            <div className="chan"><span>Desktop</span>{perm === 'granted' ? <span className="ok-t">On</span> : perm === 'denied' ? <span className="warn-t">Blocked in browser</span> : <button className="link sm" onClick={enableDesktop}>Turn on</button>}</div>
            <div className="chan"><span>Telegram</span>{telegram ? <span className="ok-t">Connected</span> : <span className="muted sm">Add TELEGRAM_BOT_TOKEN to .env</span>}</div>
          </div>
        </div>
      )}
    </div>
  );
}
