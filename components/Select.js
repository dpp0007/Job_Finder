'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const Chevron = () => <svg className="chev" width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 1.5l5 5 5-5" /></svg>;
const Check = () => <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M1.5 6.5l4 4 7-9" /></svg>;

// Accessible dropdown styled to the design system. options: [value, label, tone?]  (tone: 'danger')
export default function Select({ value, onChange, options, label, variant = '', align = 'left', prefix, display }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [hi, setHi] = useState(0);
  const btn = useRef(null), list = useRef(null), id = useId();
  const cur = options.find(o => o[0] === value);

  const openMenu = () => {
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom, need = Math.min(options.length * 42 + 16, 320);
    setPos({ top: below < need && r.top > need ? undefined : r.bottom + 6, bottom: below < need && r.top > need ? window.innerHeight - r.top + 6 : undefined, left: r.left, right: window.innerWidth - r.right, minWidth: r.width });
    setHi(Math.max(0, options.findIndex(o => o[0] === value)));
    setOpen(true);
  };
  const close = focus => { setOpen(false); if (focus) btn.current?.focus(); };
  const pick = v => { close(true); if (v !== value) onChange(v); };

  useEffect(() => {
    if (!open) return;
    const out = e => { if (!btn.current.contains(e.target) && !list.current?.contains(e.target)) setOpen(false); };
    const away = e => { if (!list.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', out);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => { document.removeEventListener('mousedown', out); window.removeEventListener('scroll', away, true); window.removeEventListener('resize', away); };
  }, [open]);

  const onKey = e => {
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(); } return; }
    const n = options.length;
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => (h - 1 + n) % n); }
    else if (e.key === 'Home') { e.preventDefault(); setHi(0); }
    else if (e.key === 'End') { e.preventDefault(); setHi(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[hi][0]); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button type="button" ref={btn} className={'sel ' + variant} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label}
        onClick={() => (open ? close(false) : openMenu())} onKeyDown={onKey}>
        {prefix && <span className="sel-prefix">{prefix}</span>}<span className="clip">{display ?? (cur ? cur[1] : '—')}</span><Chevron />
      </button>
      {open && pos && createPortal(
        <ul id={id} ref={list} role="listbox" className="menu" aria-label={label}
          style={{ top: pos.top, bottom: pos.bottom, left: align === 'right' ? undefined : pos.left, right: align === 'right' ? pos.right : undefined, minWidth: Math.max(pos.minWidth, 168) }}>
          {options.map(([v, l, tone], i) => (
            <li key={String(v)} role="option" aria-selected={v === value} className={(i === hi ? 'hi ' : '') + (v === value ? 'on ' : '') + (tone || '')}
              onMouseEnter={() => setHi(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(v)}>
              <span>{l}</span>{v === value && <Check />}
            </li>
          ))}
        </ul>, document.body)}
    </>
  );
}
