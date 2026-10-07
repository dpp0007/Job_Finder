'use client';
import { useState } from 'react';

export function TagInput({ value, onChange, placeholder }) {
  const [text, setText] = useState('');
  const add = () => { const v = text.replace(/,$/, '').trim(); if (v && !value.includes(v)) onChange([...value, v]); setText(''); };
  return (
    <div className="tags">
      {value.map((t, i) => <span className="tag" key={t}>{t}<b onClick={() => onChange(value.filter((_, j) => j !== i))}>×</b></span>)}
      <input type="text" value={text} placeholder={value.length ? '' : placeholder} onChange={e => setText(e.target.value)} onBlur={add}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }} />
    </div>
  );
}

export function ChipGroup({ value, onChange, options }) {
  const toggle = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  return <div className="chips">{options.map(([v, l]) => <span key={v} className={'chip' + (value.includes(v) ? ' on' : '')} onClick={() => toggle(v)}>{l}</span>)}</div>;
}

export function Seg({ value, onChange, options }) {
  return <div className="seg">{options.map(([v, l]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
