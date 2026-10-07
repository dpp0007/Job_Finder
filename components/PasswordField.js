'use client';
import { useId, useState } from 'react';
import { checkPassword, STRENGTH } from '@/lib/password';

// A password box with show/hide and, when `meter` is set, a live strength bar that uses the same rules as the server.
export default function PasswordField({ value, onChange, label = 'Password', email = '', meter, autoComplete = 'current-password', hint }) {
  const id = useId();
  const [show, setShow] = useState(false);
  const r = meter && value ? checkPassword(value, email) : null;
  return (
    <div className="af">
      <label htmlFor={id}>{label}</label>
      <div className="af-row">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} maxLength={128} required spellCheck={false} autoCapitalize="none" />
        <button type="button" className="af-show" onClick={() => setShow(s => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
      </div>
      {meter && (
        <div className="meter" aria-live="polite">
          <span className="bars" data-s={r ? r.score : 0}><i /><i /><i /><i /></span>
          <span className="muted sm">{r ? (r.ok ? STRENGTH[r.score] : r.error) : hint || 'At least 10 characters. A few random words work well.'}</span>
        </div>
      )}
    </div>
  );
}
