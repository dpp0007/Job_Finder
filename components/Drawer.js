'use client';
import { safeHref } from '@/lib/client';
import { useEffect, useState } from 'react';
import Description from './Description';
import FitPanel from './FitPanel';
import { useScout } from './ScoutProvider';
import { api, hostOf, money } from '@/lib/client';

const PARTS = { title: 'Role', location: 'Location', seniority: 'Level', keywords: 'Keywords', visa: 'Visa', fresh: 'Freshness', resume: 'Skills', terms: 'Resume wording', exp: 'Experience', family: 'Field', salary: 'Pay' };

export default function Drawer({ job: first, onClose, onClosed }) {
  const { resume, prefs, patchResults } = useScout();
  const [j, setJob] = useState(first);
  const [ver, setVer] = useState('');
  const [reading, setReading] = useState(!first.hasDesc);   // the search indexed this listing without its text: read the page now
  useEffect(() => {
    if (first.hasDesc) return;
    let live = true;
    api('/jobs/read', 'POST', { jobId: first.id, prefs }).then(r => {
      if (!live) return;
      setJob(p => ({ ...p, ...r.job, stage: p.stage })); patchResults(list => list.map(x => x.id === first.id ? { ...x, ...r.job, stage: x.stage } : x));
    }).catch(() => {}).finally(() => live && setReading(false));
    return () => { live = false; };
  }, [first.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const verify = async () => {
    setVer('checking live…');
    try {
      const r = await api('/verify', 'POST', { jobId: j.id });
      setVer(r.status === 'closed' ? '❌ closed' : '✅ still open');
      if (r.status === 'closed') onClosed(j.id);
    } catch (e) { setVer(e.message); }
  };
  const signals = [`Level: ${j.seniority}${j.years != null ? ` (${j.years}+ yrs)` : ''}`, `Mode: ${j.workMode}`, `Visa: ${j.visa}`, j.salary && 'Pay: ' + money(j.salary), j.department && 'Team: ' + j.department].filter(Boolean);

  return (
    <>
    <div className="scrim" onClick={onClose} />
    <div className="drawer">
      <div className="row"><span className="grow" /><button className="ghost" onClick={onClose}>Close ✕</button></div>
      <h2>{j.title}</h2>
      <div className="muted">{j.company}{j.location ? ' · ' + j.location : ''}</div>
      <div className="row wrap" style={{ margin: '12px 0' }}>
        <a className="btn" href={safeHref(j.url)} target="_blank" rel="noopener noreferrer">Apply ↗</a>
        <button className="ghost" onClick={verify}>Check still open</button><span className="muted">{ver}</span>
      </div>
      <div>{signals.map(s => <span key={s} className="badge">{s}</span>)}{resume && j.fit != null && <span className="badge good">Resume fit {j.fit}%</span>}</div>
      {j.summary && <div className="aibox"><span className="mono">✦ AI summary</span><p>{j.summary}</p>{j.deadline && <p className="sm muted">Apply by {j.deadline}</p>}</div>}

      <h5>Job description</h5>
      {reading ? <div className="descv" aria-busy="true"><div className="row"><span className="spin dark" /><b>Reading the full posting…</b></div>{[95, 80, 88, 60].map(w => <span className="shim" key={w} style={{ width: w + '%', height: 14, marginTop: 14 }} />)}</div> : <Description text={j.desc} title={j.title} url={j.url} summary={j.summary} />}

      <h5>Your fit and interview prep</h5>
      <FitPanel job={j} waiting={reading} />

      <details className="how">
        <summary>How this job was scored ({j.score}/100)</summary>
        <div className="parts">{Object.entries(j.parts).map(([k, v]) => (
          <div className="bar1" key={k}><span>{PARTS[k] || k}</span><i style={{ '--w': `${v * 100}%` }} /><span>{Math.round(v * 100)}</span></div>
        ))}</div>
        <div className="why" style={{ marginTop: 8 }}>{j.reasons.join(' · ')}</div>
        {j.skills.length > 0 && <><div className="sub-h">Skills in the posting</div>{j.skills.map(s => <span key={s} className={'sk' + (j.matched.includes(s) ? ' hit' : '')}>{s}</span>)}</>}
        {j.missing.length > 0 && <><div className="sub-h">Not on your resume</div>{j.missing.map(s => <span key={s} className="badge warn">{s}</span>)}</>}
        <div className="sub-h">Found on</div>{j.sources.map(s => <div key={s.url}><a href={safeHref(s.url)} target="_blank" rel="noopener noreferrer">{s.name} — {hostOf(s.url)}</a></div>)}
      </details>
    </div>
    </>
  );
}
