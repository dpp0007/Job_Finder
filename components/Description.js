'use client';
import { safeHref } from '@/lib/client';
import { useMemo, useState } from 'react';
import { groupBlocks, parseDescription } from '@/lib/describe';

// Inline markdown: **bold**, *italic*, [text](https://link). Built as React nodes, never raw HTML.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g).map((p, i) => {
    let m;
    if ((m = p.match(/^\*\*([^*]+)\*\*$/))) return <strong key={i}>{m[1]}</strong>;
    if ((m = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/))) return <a key={i} href={safeHref(m[2])} target="_blank" rel="noopener noreferrer">{m[1]}</a>;
    if ((m = p.match(/^\[([^\]]+)\]\([^)]+\)$/))) return m[1];
    if ((m = p.match(/^\*([^*\s][^*]*)\*$/))) return <em key={i}>{m[1]}</em>;
    return p;
  });
}

function Blocks({ blocks }) {
  return blocks.map((b, i) => {
    if (b.t === 'h') return b.level <= 2 ? <h4 className="dh" key={i}>{b.text}</h4> : <h4 className="dh sub" key={i}>{b.text}</h4>;
    if (b.t === 'chips') return <div className="dchips" key={i}>{b.items.map(x => <span className="sk" key={x}>{x}</span>)}</div>;
    if (b.t === 'list') { const L = b.ordered ? 'ol' : 'ul'; return <L key={i}>{b.items.map((x, j) => <li key={j}>{inline(x)}</li>)}</L>; }
    return <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && ' '}{inline(l)}</span>)}</p>;
  });
}

const size = b => b.t === 'p' ? b.lines.join('').length : b.t === 'list' || b.t === 'chips' ? b.items.join('').length : (b.text || '').length;

// A posting rendered as a reader would want it: key facts first, then clean sections. Long text is clamped, not scrolled.
export default function Description({ text, title, url, summary }) {
  const d = useMemo(() => parseDescription(text, title), [text, title]);
  const g = useMemo(() => groupBlocks(d.blocks), [d]);
  const [open, setOpen] = useState(false);
  if (d.quality === 'none' && !d.facts.length) return (
    <div className="descv">
      {summary && <p>{summary}</p>}
      <p className="muted">{d.listing ? 'This link is a list of jobs, not one posting.' : 'We couldn’t read a clean description for this opening.'} <a href={safeHref(url)} target="_blank" rel="noopener noreferrer">Open it on the employer’s site ↗</a> for the details.</p>
    </div>
  );
  const long = g.primary.reduce((n, b) => n + size(b), 0) > 1500;
  return (
    <div className="descv">
      {d.facts.length > 0 && (
        <dl className="facts">{d.facts.map(f => <div className="fact" key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
      )}
      <div className={'dbody' + (long && !open ? ' clamp' : '')}>
        <Blocks blocks={g.primary} />
      </div>
      {long && <button className="link" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Show full description'}</button>}
      {g.secondary.length > 0 && <details className="company"><summary>About the company, benefits and more</summary><div className="dbody"><Blocks blocks={g.secondary} /></div></details>}
      {d.quality === 'thin' && <p className="sm muted" style={{ marginTop: 10 }}>Only a short description was available. <a href={safeHref(url)} target="_blank" rel="noopener noreferrer">See the full posting ↗</a></p>}
      {d.trimmed && <p className="sm muted" style={{ marginTop: 10 }}>This description is shortened. <a href={safeHref(url)} target="_blank" rel="noopener noreferrer">Read the rest on the employer’s page ↗</a></p>}
    </div>
  );
}
