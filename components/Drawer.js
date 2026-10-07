'use client';
import { useEffect, useState } from 'react';
import Description from './Description';
import { api, hostOf, money } from '@/lib/client';

const PARTS = { title: 'Role', location: 'Location', seniority: 'Level', keywords: 'Keywords', visa: 'Visa', fresh: 'Freshness', resume: 'Skills', salary: 'Pay' };

export default function Drawer({ job: j, onClose, onClosed }) {
  const [ver, setVer] = useState('');
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
        <a className="btn" href={j.url} target="_blank" rel="noopener noreferrer">Apply ↗</a>
        <button className="ghost" onClick={verify}>Check still open</button><span className="muted">{ver}</span>
      </div>
      {j.summary && <div className="aibox"><span className="mono">✦ AI summary</span><p>{j.summary}</p>{j.deadline && <p className="sm muted">Apply by {j.deadline}</p>}</div>}
      {(j.skillsRequired?.length > 0 || j.skillsNice?.length > 0) && <>
        <h5>Skills the employer asks for</h5>
        {j.skillsRequired?.map(x => <span key={x} className={'sk' + (j.matched.includes(x) ? ' hit' : '')}>{x}</span>)}
        {j.skillsNice?.length > 0 && <div className="sm muted" style={{ margin: '10px 0 6px' }}>Nice to have</div>}
        {j.skillsNice?.map(x => <span key={x} className={'sk' + (j.matched.includes(x) ? ' hit' : '')} style={{ opacity: .7 }}>{x}</span>)}
      </>}
      <h5>Why it scored {j.score}</h5>
      <div className="parts">{Object.entries(j.parts).map(([k, v]) => (
        <div className="bar1" key={k}><span>{PARTS[k]}</span><i style={{ '--w': `${v * 100}%` }} /><span>{Math.round(v * 100)}</span></div>
      ))}</div>
      <div className="why" style={{ marginTop: 8 }}>{j.reasons.join(' · ')}</div>
      {j.skills.length > 0 && <><h5>Skills in posting</h5>{j.skills.map(s => <span key={s} className={'sk' + (j.matched.includes(s) ? ' hit' : '')}>{s}</span>)}</>}
      {j.missing.length > 0 && <><h5>Gaps vs your resume</h5>{j.missing.map(s => <span key={s} className="badge warn">{s}</span>)}</>}
      <h5>Signals</h5><div>{signals.map(s => <span key={s} className="badge">{s}</span>)}</div>
      <h5>Found on</h5>{j.sources.map(s => <div key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name} — {hostOf(s.url)}</a></div>)}
      <h5>Job description</h5><Description text={j.desc} title={j.title} url={j.url} />
    </div>
    </>
  );
}
