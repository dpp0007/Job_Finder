'use client';
import { safeHref } from '@/lib/client';
import { useCallback, useEffect, useState } from 'react';
import { useScout } from './ScoutProvider';
import Select from './Select';
import { api, ago, cleanTitle, exportCsv, money, shortLoc, STAGES } from '@/lib/client';

const LABEL = Object.fromEntries(STAGES);
const NEXT = { saved: ['applied', 'Mark applied'], applied: ['interview', 'Got an interview'], interview: ['offer', 'Got an offer'] };
const HINT = { saved: 'Press Save on any opening and it lands here', applied: 'Drag a card here once you apply', interview: 'Interviews you’ve lined up', offer: 'Offers you receive', rejected: 'Keep a record, then move on' };
const VERB = { saved: 'Saved', applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };

function Card({ i, onMove, onNote, onRemove, dragging, setDragging }) {
  const j = i.job;
  const [noteOpen, setNoteOpen] = useState(!!i.note);
  const closed = i.status === 'closed';
  const next = NEXT[i.stage];
  return (
    <div className={'kc' + (dragging === i.job_id ? ' drag' : '') + (closed ? ' closed' : '')} draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', i.job_id); e.dataTransfer.effectAllowed = 'move'; setDragging(i.job_id); }} onDragEnd={() => setDragging(null)}>
      <div className="kc-head">
        <b title={j.title}>{cleanTitle(j.title)}</b>
        <a className="kc-open" href={safeHref(j.url)} target="_blank" rel="noopener noreferrer" aria-label="Open the posting" title="Open the posting">↗</a>
      </div>
      <div className="kc-co">{j.company}{j.location ? ' · ' + shortLoc(j.location).split(';')[0] : ''}</div>
      {(closed || j.workMode !== 'unknown' || j.salary) && (
        <div className="kc-badges">
          {closed && <span className="badge bad">Listing closed</span>}
          {j.workMode !== 'unknown' && <span className="badge">{j.workMode[0].toUpperCase() + j.workMode.slice(1)}</span>}
          {j.salary && <span className="badge good">{money(j.salary)}</span>}
        </div>
      )}
      {noteOpen
        ? <textarea className="kc-note" rows={2} placeholder="Recruiter name, next step, deadline…" defaultValue={i.note} onBlur={e => e.target.value !== i.note && onNote(i, e.target.value)} />
        : <button className="kc-addnote" onClick={() => setNoteOpen(true)}>+ Add note</button>}
      <div className="kc-meta">{VERB[i.stage]} {ago(i.updated)}</div>
      <div className="kc-actions">
        {next ? <button className="step" onClick={() => onMove(i, next[0])}>{next[1]} →</button> : <span />}
        <Select variant="icon" display="⋯" value={i.stage} label={`Move ${cleanTitle(j.title)}`} align="right"
          onChange={v => (v === '__remove' ? onRemove(i) : onMove(i, v))} options={[...STAGES, ['__remove', 'Remove from tracker', 'danger']]} />
      </div>
    </div>
  );
}

export default function Tracker() {
  const { notify, setTab } = useScout();
  const [items, setItems] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const load = useCallback(async () => { try { setItems(await api('/tracker')); } catch (e) { notify(e.message, 'error'); setItems([]); } }, [notify]);
  useEffect(() => { load(); }, [load]);
  if (!items) return null;

  const move = async (i, stage) => {
    if (i.stage === stage) return;
    const prev = items;
    setItems(list => list.map(x => (x.job_id === i.job_id ? { ...x, stage, updated: Date.now() } : x))); // optimistic
    try { await api('/tracker', 'POST', { jobId: i.job_id, stage }); notify(`Moved to ${LABEL[stage]}`); }
    catch (e) { setItems(prev); notify(e.message, 'error'); }
  };
  const note = async (i, text) => { try { await api('/tracker', 'POST', { jobId: i.job_id, stage: i.stage, note: text }); setItems(l => l.map(x => (x.job_id === i.job_id ? { ...x, note: text } : x))); } catch (e) { notify(e.message, 'error'); } };
  const remove = async i => {
    try {
      await api('/tracker', 'POST', { jobId: i.job_id, stage: null });
      setItems(l => l.filter(x => x.job_id !== i.job_id));
      notify('Removed from tracker', 'ok', { label: 'Undo', fn: async () => { await api('/tracker', 'POST', { jobId: i.job_id, stage: i.stage, note: i.note }); load(); } });
    } catch (e) { notify(e.message, 'error'); }
  };
  const drop = (e, stage) => { e.preventDefault(); const it = items.find(x => x.job_id === e.dataTransfer.getData('text/plain')); setOver(null); setDragging(null); if (it) move(it, stage); };
  const counts = STAGES.map(([k, l]) => [l, items.filter(i => i.stage === k).length]).filter(x => x[1]);
  const closedN = items.filter(i => i.status === 'closed').length;

  return (
    <>
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <div className="grow"><h2 className="pg">Application tracker</h2>
          <p className="lead" style={{ marginBottom: 12 }}>Everything you save, in one place. Drag a card to a new column, or use the quick button on it. Saved and applied links are re-checked daily.</p>
          {items.length > 0 && <p className="mono" style={{ marginBottom: 24 }}>{counts.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(' · ')}{closedN ? ` · ${closedN} listing${closedN > 1 ? 's' : ''} closed` : ''}</p>}
        </div>
        <button className="ghost" style={{ marginBottom: 24 }} disabled={!items.length} onClick={() => exportCsv(items.map(i => ({ ...i.job, score: '' })))}>Export CSV</button>
      </div>
      {!items.length && (
        <div className="empty left" style={{ paddingTop: 0 }}>
          <h3>Nothing tracked yet</h3>
          <p>Press <b>Save</b> on any opening and it shows up here. From there you can move it from Saved to Applied, Interview and Offer, and keep notes on each one.</p>
          <button className="primary" onClick={() => setTab('discover')}>Find openings to save</button>
        </div>
      )}
      <div className="kan">{STAGES.map(([k, l]) => {
        const col = items.filter(i => i.stage === k);
        return (
          <div className={'col' + (over === k ? ' over' : '')} key={k} onDragOver={e => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(o => (o === k ? null : o))} onDrop={e => drop(e, k)}>
            <h4>{l}<span>{col.length}</span></h4>
            {!col.length && <div className="hint">{dragging ? 'Drop here' : HINT[k]}</div>}
            {col.map(i => <Card key={i.job_id} i={i} onMove={move} onNote={note} onRemove={remove} dragging={dragging} setDragging={setDragging} />)}
          </div>
        );
      })}</div>
    </>
  );
}
