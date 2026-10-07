'use client';
import { useMemo, useState } from 'react';
import { parseDescription } from '@/lib/describe';

// Inline markdown: **bold**, *italic*, [text](https://link). Built as React nodes, never raw HTML.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g).map((p, i) => {
    let m;
    if ((m = p.match(/^\*\*([^*]+)\*\*$/))) return <strong key={i}>{m[1]}</strong>;
    if ((m = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/))) return <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a>;
    if ((m = p.match(/^\[([^\]]+)\]\([^)]+\)$/))) return m[1];
    if ((m = p.match(/^\*([^*\s][^*]*)\*$/))) return <em key={i}>{m[1]}</em>;
    return p;
  });
}

const size = b => b.t === 'p' ? b.lines.join('').length : b.t === 'list' || b.t === 'chips' ? b.items.join('').length : (b.text || '').length;

// A posting rendered as a reader would want it: key facts first, then clean sections. Long text is clamped, not scrolled.
export default function Description({ text, title, url }) {
  const d = useMemo(() => parseDescription(text, title), [text, title]);
  const [open, setOpen] = useState(false);
  if (!d.blocks.length && !d.facts.length) return <p className="muted">We couldn’t read the full description. <a href={url} target="_blank" rel="noopener noreferrer">Open it on the employer’s site</a> for details.</p>;
  const long = d.blocks.reduce((n, b) => n + size(b), 0) > 1500;
  return (
    <div className="descv">
      {d.facts.length > 0 && (
        <dl className="facts">{d.facts.map(f => <div className="fact" key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
      )}
      <div className={'dbody' + (long && !open ? ' clamp' : '')}>
        {d.blocks.map((b, i) => {
          if (b.t === 'h') return b.level <= 2 ? <h4 className="dh" key={i}>{b.text}</h4> : <h4 className="dh sub" key={i}>{b.text}</h4>;
          if (b.t === 'chips') return <div className="dchips" key={i}>{b.items.map(x => <span className="sk" key={x}>{x}</span>)}</div>;
          if (b.t === 'list') { const L = b.ordered ? 'ol' : 'ul'; return <L key={i}>{b.items.map((x, j) => <li key={j}>{inline(x)}</li>)}</L>; }
          return <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && ' '}{inline(l)}</span>)}</p>;
        })}
      </div>
      {long && <button className="link" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Show full description'}</button>}
      {d.trimmed && <p className="sm muted" style={{ marginTop: 10 }}>This description is shortened. <a href={url} target="_blank" rel="noopener noreferrer">Read the rest on the employer’s page ↗</a></p>}
    </div>
  );
}
