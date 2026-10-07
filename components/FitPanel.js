'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useScout } from './ScoutProvider';
import ResumeBox from './ResumeBox';
import { api } from '@/lib/client';

const VERDICT = { strong: 'Strong fit', good: 'Good fit', stretch: 'Stretch', long: 'Long shot', unknown: 'Limited detail' };

function Pending() {
  return (
    <div className="fitp" aria-busy="true">
      <div className="row"><span className="spin dark" /><b>Reading this posting against your resume…</b></div>
      {[90, 70, 80].map(w => <span className="shim" key={w} style={{ width: w + '%', height: 14, marginTop: 14 }} />)}
    </div>
  );
}

// Pros and cons of this job for the uploaded resume, then how to prepare for the interview.
export default function FitPanel({ job, waiting }) {
  const { resume, prefs } = useScout();
  const [st, setSt] = useState({ loading: !!resume, data: null, error: '' });
  const token = useRef(0), prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const load = useCallback(async () => {
    const mine = ++token.current;
    setSt({ loading: true, data: null, error: '' });
    try { const data = await api('/analyze', 'POST', { jobId: job.id, prefs: prefsRef.current }); if (mine === token.current) setSt({ loading: false, data, error: '' }); }
    catch (e) { if (mine === token.current) setSt({ loading: false, data: null, error: e.message }); }
  }, [job.id]);
  useEffect(() => { if (resume && !waiting) load(); else { token.current++; setSt({ loading: !!resume, data: null, error: '' }); } return () => { token.current++; }; }, [resume?.at, load, waiting]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!resume) return (
    <section className="fitp ask">
      <h3>How do you fit this job?</h3>
      <p>Upload your resume to see the strengths and gaps for this role, and what to prepare for the interview. Matches across all jobs use it too.</p>
      <ResumeBox compact />
    </section>
  );
  if (st.loading) return <Pending />;
  if (st.error) return <section className="fitp"><p className="fmsg" role="alert">{st.error}</p><button className="ghost" onClick={load}>Try again</button></section>;
  const d = st.data;
  if (!d) return null;

  return (
    <section className="fitp">
      <div className="fit-head">
        <span className={'verdict ' + d.verdict}>{VERDICT[d.verdict]}</span>
        {d.fit != null && <span className="fitnum"><b>{d.fit}%</b> resume fit</span>}
        <span className="grow" />
        <span className="src">{d.source === 'ai' ? '✦ Written by AI from your resume and this posting' : 'Built from this posting and your resume'}</span>
      </div>
      {d.summary && <p className="fit-sum">{d.summary}</p>}

      <div className="pc">
        <div>
          <h4>What works for you</h4>
          {d.pros.length ? <ul>{d.pros.map((p, i) => <li key={i}><b>{p.point}</b>{p.detail && <span>{p.detail}</span>}</li>)}</ul> : <p className="muted sm">Nothing stands out yet. This posting lists few details to compare.</p>}
        </div>
        <div>
          <h4>Gaps to address</h4>
          {d.cons.length ? <ul className="cons">{d.cons.map((p, i) => <li key={i}><b>{p.point}</b>{p.detail && <span>{p.detail}</span>}</li>)}</ul> : <p className="muted sm">No clear gaps found against what the posting lists.</p>}
        </div>
      </div>

      <h4 className="prep-h">Prepare for the interview</h4>
      {d.prep.focus.length > 0 && (
        <div className="focus">
          <h5>Topics to revise</h5>
          {d.prep.focus.map((f, i) => <div className="frow" key={i}><span className="sk">{f.topic}</span><span>{f.detail}</span></div>)}
        </div>
      )}
      {d.prep.questions.length > 0 && (
        <div className="qs">
          <h5>Questions to practise</h5>
          {d.prep.questions.map((q, i) => <details key={i}><summary>{q.q}</summary><p>{q.tip}</p></details>)}
        </div>
      )}
      {d.prep.plan.length > 0 && (
        <div className="plan">
          <h5>Your prep plan</h5>
          <ol>{d.prep.plan.map((x, i) => <li key={i}>{x}</li>)}</ol>
        </div>
      )}
      {d.aiNote && <p className="muted sm" style={{ marginTop: 14 }}>{d.aiNote}</p>}
    </section>
  );
}
