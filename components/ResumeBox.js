'use client';
import { useRef, useState } from 'react';
import { useScout } from './ScoutProvider';

const level = { entry: 'Fresher / entry', mid: 'Mid-level', senior: 'Senior', lead: 'Lead' };
const kb = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// Upload, replace or remove the resume. The server reads it and refuses anything that is not a real resume.
export default function ResumeBox({ compact }) {
  const { resume, resumeBusy, resumeError, uploadResume, removeResume } = useScout();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const pick = () => input.current?.click();
  const onFile = f => { if (f) uploadResume(f); if (input.current) input.current.value = ''; };

  return (
    <div className={'rbox' + (compact ? ' compact' : '')}>
      <input ref={input} type="file" hidden accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={e => onFile(e.target.files?.[0])} />
      {resume ? (
        <div className="rhave">
          <div className="rfile"><span className="rdoc" aria-hidden>CV</span>
            <div className="grow">
              <b className="clip">{resume.name}</b>
              <div className="muted sm">{resume.skills.length} skills found{resume.years != null ? ` · about ${resume.years} yr${resume.years === 1 ? '' : 's'} experience` : ''}{resume.level ? ` · ${level[resume.level]}` : ''} · {kb(resume.size)}</div>
            </div>
          </div>
          {resume.skills.length > 0 && <div className="rskills">{resume.skills.slice(0, 10).map(s => <span className="sk hit" key={s}>{s}</span>)}{resume.skills.length > 10 && <span className="muted sm"> +{resume.skills.length - 10} more</span>}</div>}
          <div className="row wrap"><button className="ghost" disabled={resumeBusy} onClick={pick}>{resumeBusy ? 'Reading…' : 'Replace'}</button><button className="link" disabled={resumeBusy} onClick={removeResume}>Remove</button>
            <span className="muted sm">Matches and the % fit use this resume.</span></div>
        </div>
      ) : (
        <div className={'dz' + (over ? ' over' : '') + (resumeError ? ' bad' : '')} role="button" tabIndex={0} aria-label="Upload your resume"
          onClick={pick} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick())}
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0]); }}>
          {resumeBusy ? <><span className="spin dark" /><span>Reading your resume…</span></> : <>
            <span className="rdoc" aria-hidden>CV</span>
            <span className="grow"><b>Upload your resume</b><span className="muted sm"> to rank jobs by fit and see what to prepare</span></span>
            <span className="ghost">Choose file</span>
          </>}
        </div>
      )}
      <div className="muted sm rhint">PDF, DOCX or TXT · up to 4 MB · stays on your Scout server, used only to compare with jobs</div>
      {resumeError && <div className="fmsg" role="alert">{resumeError}</div>}
    </div>
  );
}
