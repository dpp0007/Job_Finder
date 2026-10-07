'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useScout } from './ScoutProvider';
import { api, ago, cap, cleanTitle, hostOf, money, shortLoc, stream, SUGGESTED_COMPANIES } from '@/lib/client';

function Openings({ c }) {
  const [data, setData] = useState(null);
  useEffect(() => { api(`/companies/${c.id}/jobs`).then(setData).catch(() => setData({ total: 0, jobs: [] })); }, [c.id, c.last_scan]);
  if (!data) return <div className="muted sm">Loading…</div>;
  if (!data.jobs.length) return <div className="muted sm">No openings indexed for {c.name} yet. Press Scan now.</div>;
  return (
    <div className="openings">
      {data.jobs.map(j => (
        <a className="orow" key={j.id} href={j.url} target="_blank" rel="noopener noreferrer">
          <span className="clip"><b>{cleanTitle(j.title)}</b> <span className="muted">{j.location ? '· ' + shortLoc(j.location).split(';')[0] : ''}</span></span>
          <span className="muted sm">{j.salary ? money(j.salary) + ' · ' : ''}{j.postedAt ? ago(j.postedAt) : 'found ' + ago(j.firstSeen)} ↗</span>
        </a>
      ))}
      {data.total > data.jobs.length && <div className="muted sm" style={{ padding: '10px 0' }}>Showing {data.jobs.length} of {data.total}. Search in Discover to see the rest, ranked.</div>}
    </div>
  );
}

export default function Companies() {
  const { notify, prefs } = useScout();
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');       // 'add:<name>' | 'scan:<id>'
  const [prog, setProg] = useState({});       // company id -> live status text
  const [open, setOpen] = useState(null);     // company id whose openings are expanded
  const load = useCallback(async () => { try { setList(await api('/companies')); } catch (e) { notify(e.message, 'error'); setList([]); } }, [notify]);
  useEffect(() => { load(); }, [load]);

  const scan = useCallback(async c => {
    setBusy('scan:' + c.id); setProg(p => ({ ...p, [c.id]: 'Starting…' }));
    try {
      let done = null;
      await stream('/companies/scan', { id: c.id, prefs }, ev => {
        if (ev.type === 'stage') setProg(p => ({ ...p, [c.id]: ev.msg }));
        if (ev.type === 'error') throw new Error(ev.message);
        if (ev.type === 'done') done = ev;
      });
      if (done?.ok) { notify(`${c.name}: ${done.note}`); setOpen(c.id); }
      else notify(`${c.name}: ${done?.note || 'nothing found'}`, 'error');
    } catch (e) { notify(`${c.name}: ${e.message}`, 'error'); }
    setBusy(''); setProg(p => ({ ...p, [c.id]: '' })); load();
  }, [prefs, notify, load]);

  const add = async name => {
    const v = (name ?? text).trim();
    if (!v) return;
    setBusy('add:' + v);
    try {
      const c = await api('/companies', 'POST', { input: v });
      setText(''); notify(`${c.name} added. Reading its openings…`);
      await load(); setBusy('');
      scan(c);                                   // scan straight away: adding should show results, not an empty row
    } catch (e) { notify(e.message, 'error'); setBusy(''); }
  };
  const have = new Set((list || []).map(c => c.name.toLowerCase()));
  const adding = busy.startsWith('add');

  return (
    <>
      <h2 className="pg">Company watchlist</h2>
      <p className="lead">Add the companies you care about by name or careers link. Scout reads their openings straight away and re-checks them in every search. Known job boards are read directly; custom careers sites are tried with Fetch first, then a TinyFish Agent.</p>
      <div className="addbar">
        <input type="text" value={text} placeholder="Company name or careers link, e.g. Razorpay" onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} disabled={adding} />
        <button className="primary" disabled={!!busy || !text.trim()} onClick={() => add()}>{adding ? 'Finding…' : 'Add & scan'}</button>
      </div>
      {list?.length ? (
        <table className="tbl"><thead><tr><th>Company</th><th>Reader</th><th>Last scan</th><th /></tr></thead><tbody>
          {list.map(c => {
            const scanning = busy === 'scan:' + c.id, bad = c.note?.startsWith('!') || (c.last_scan && !c.job_count), msg = (c.note || '').replace(/^!/, '') || (bad ? 'No openings found on the last scan' : '');
            return (
              <Fragment key={c.id}>
                <tr>
                  <td><b>{c.name}</b><div className="sm"><a href={c.careers_url} target="_blank" rel="noopener noreferrer">{hostOf(c.careers_url)}</a></div></td>
                  <td><span className={'badge ' + (c.ats ? 'good' : 'warn')}>{c.ats ? cap(c.ats) + ' board' : 'Custom site'}</span></td>
                  <td>
                    {scanning ? <span className="sm"><span className="spin dark" /> {prog[c.id]}</span>
                      : !c.last_scan ? <span className="muted">Not scanned yet</span>
                        : <><span className={'sm ' + (bad ? 'warn-t' : 'ok-t')}>{bad ? '⚠ ' : '✓ '}{msg || `${c.job_count} openings`}</span><div className="muted sm">{ago(c.last_scan)}</div></>}
                  </td>
                  <td className="row end">
                    {c.job_count > 0 && !scanning && <button className="link" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide openings' : `View ${c.job_count} openings`}</button>}
                    <button className="ghost" disabled={!!busy} onClick={() => scan(c)}>{scanning ? 'Scanning…' : c.last_scan ? 'Rescan' : 'Scan now'}</button>
                    <button className="link" disabled={scanning} onClick={async () => { try { await api('/companies', 'DELETE', { id: c.id }); load(); } catch (e) { notify(e.message, 'error'); } }}>Remove</button>
                  </td>
                </tr>
                {open === c.id && <tr className="sub"><td colSpan={4}><Openings c={c} /></td></tr>}
              </Fragment>
            );
          })}
        </tbody></table>
      ) : list && <div className="empty left"><h3>Nobody on your watchlist yet</h3><p>Track the employers you’d actually want. Pick one below, or type your own above. Scout reads its openings the moment you add it.</p></div>}
      <div className="suggest">
        <span className="lbl">{list?.length ? 'Add more' : 'Popular in India'}</span>
        <div className="chips">{SUGGESTED_COMPANIES.filter(c => !have.has(c.toLowerCase())).map(c => (
          <span className="chip" key={c} onClick={() => !busy && add(c)}>{busy === 'add:' + c ? 'Adding…' : '+ ' + c}</span>
        ))}</div>
      </div>
    </>
  );
}
