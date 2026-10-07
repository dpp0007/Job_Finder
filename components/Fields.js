'use client';
import { useState } from 'react';
import { checkTerm, LIMITS } from '@/lib/validate';

// kind: 'roles' | 'locations' | 'keywords' | 'must' | 'exclude'. Only job-related text is accepted; a bad entry shows why instead of being added.
export function TagInput({ value, onChange, placeholder, kind }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    const parts = text.split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
    if (!parts.length) { setText(''); return; }
    const next = [...value]; let bad = '';
    for (const part of parts) {
      const r = kind ? checkTerm(kind, part) : { ok: true, value: part };
      if (!r.ok) { bad = r.error; continue; }
      if (!next.some(x => x.toLowerCase() === r.value.toLowerCase())) next.push(r.value);
    }
    if (kind && next.length > LIMITS[kind]) { setError(`You can add up to ${LIMITS[kind]} here. Remove one first.`); return; }
    if (next.length !== value.length) onChange(next);
    setError(bad);
    setText(bad && next.length === value.length ? text : '');   // keep what was typed when nothing was accepted, so it can be fixed
  };
  return (
    <>
      <div className={'tags' + (error ? ' bad' : '')}>
        {value.map((t, i) => <span className="tag" key={t}>{t}<b onClick={() => onChange(value.filter((_, j) => j !== i))}>×</b></span>)}
        <input type="text" value={text} maxLength={80} placeholder={value.length ? '' : placeholder} aria-invalid={!!error}
          onChange={e => { setText(e.target.value); if (error) setError(''); }} onBlur={add}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
            else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }} />
      </div>
      {error && <div className="fmsg" role="alert">{error}</div>}
    </>
  );
}

export function ChipGroup({ value, onChange, options }) {
  const toggle = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  return <div className="chips">{options.map(([v, l]) => <span key={v} className={'chip' + (value.includes(v) ? ' on' : '')} onClick={() => toggle(v)}>{l}</span>)}</div>;
}

export function Seg({ value, onChange, options }) {
  return <div className="seg">{options.map(([v, l]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
