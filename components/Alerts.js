'use client';
import { useCallback, useEffect, useState } from 'react';
import { useScout } from './ScoutProvider';
import Select from './Select';
import { api, ago } from '@/lib/client';

export default function Alerts() {
  const { prefs, setPrefs, setResults, refreshStatus, notify, setTab, sendDemo, enableDesktop, perm, status } = useScout();
  const goDiscover = () => setTab('discover');
  const [list, setList] = useState(null);
  const load = useCallback(async () => { try { setList(await api('/searches')); } catch (e) { notify(e.message, 'error'); setList([]); } }, [notify]);
  useEffect(() => { load(); }, [load]);
  if (!list) return null;

  const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { notify(e.message, 'error'); } };
  const patch = guard(async (s, body) => { await api('/searches', 'PATCH', { id: s.id, ...body }); load(); });
  const view = guard(async s => {
    setPrefs(p => ({ ...p, ...s.prefs }));
    await api('/searches', 'PATCH', { id: s.id, new_count: 0 }); refreshStatus();
    setResults(await api('/rank', 'POST', { prefs: s.prefs, resume: '' }), s.last_run - s.interval_h * 36e5);
    goDiscover();
  });
  const create = guard(async () => {
    if (!prefs?.roles.length && !prefs?.keywords.length) return goDiscover();
    const r = await api('/searches', 'POST', { name: [prefs.roles[0], prefs.locations[0]].filter(Boolean).join(' · ') || 'My search', prefs });
    notify(r.duplicate ? 'You already have this alert' : 'Alert created'); load(); refreshStatus();
  });
  const canCreate = prefs && (prefs.roles.length || prefs.keywords.length);

  return (
    <>
      <h2 className="pg">Alerts</h2>
      <p className="lead">Save a search once and Scout keeps checking for you. When something new matches, you get a notification, so you never have to re-run it by hand.</p>
      <div className="how">
        <div><span className="mono">1 · Save</span><p>Set up a search and press “Save as alert”. Pick how often it runs: every 3 to 24 hours.</p></div>
        <div><span className="mono">2 · Check</span><p>While Scout is running, it re-reads your sources on schedule and keeps only openings it hasn’t shown you before.</p></div>
        <div><span className="mono">3 · Notify</span><p>New matches land in the bell at the top, as a desktop notification, and on Telegram if you’ve connected it.</p></div>
      </div>
      <div className="row wrap" style={{ margin: '0 0 36px' }}>
        <button className="primary" onClick={sendDemo}>Send a demo alert</button>
        {perm !== 'granted' && <button className="ghost" onClick={enableDesktop}>Turn on desktop notifications</button>}
        {perm === 'granted' && <span className="sm ok-t">✓ Desktop notifications on</span>}
        <span className="muted sm">The demo uses the same path a real alert does, with the best openings already in your index.</span>
      </div>
      {list.length ? list.map(s => (
        <div className="alert" key={s.id}>
          <div className="grow">
            <b>{s.name}</b> {s.new_count > 0 && <span className="new">{s.new_count} NEW</span>}
            <div className="muted">{[s.prefs.roles.join(', '), s.prefs.locations.join(', '), s.prefs.seniority.join('/'), s.prefs.visa === 'need' && 'visa'].filter(Boolean).join(' · ')} — last run {ago(s.last_run)}</div>
          </div>
          <Select variant="small" value={s.interval_h} onChange={v => patch(s, { interval_h: v })} label="Run every" options={[3, 6, 12, 24].map(h => [h, `Every ${h} hours`])} />
          <label className="row"><input type="checkbox" checked={!!s.auto} onChange={e => patch(s, { auto: +e.target.checked })} /> auto</label>
          <button className="ghost" onClick={() => view(s)}>View matches</button>
          <button className="link" onClick={guard(async () => { await api('/searches', 'DELETE', { id: s.id }); load(); refreshStatus(); })}>Delete</button>
        </div>
      )) : (
        <div className="empty left" style={{ paddingTop: 0 }}>
          <h3>No alerts yet</h3>
          <p>{canCreate ? 'Turn your current search into an alert and Scout will keep checking for new openings.' : 'Set up a search first, then turn it into an alert that keeps watching for you.'}</p>
          <button className="primary" onClick={create}>{canCreate ? `Create alert for “${[prefs.roles[0], prefs.locations[0]].filter(Boolean).join(' · ') || prefs.keywords[0]}”` : 'Set up a search'}</button>
        </div>
      )}
    </>
  );
}
