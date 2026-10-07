'use client';
import { useEffect, useState } from 'react';
import PasswordField from './PasswordField';
import { checkPassword } from '@/lib/password';

// The page behind an emailed link: "confirm your email" or "choose a new password". The token is removed from the address bar at once.
export default function LinkPanel({ kind, token }) {
  const reset = kind === 'reset';
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(token ? '' : 'This link is incomplete. Open it again from your email.');
  useEffect(() => { history.replaceState(null, '', location.pathname); }, []);   // keep the token out of history and referrers

  const go = async e => {
    e?.preventDefault();
    if (busy || !token) return;
    if (reset) { const p = checkPassword(pw); if (!p.ok) return setErr(p.error); }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/auth/${reset ? 'reset' : 'verify'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...(reset ? { password: pw } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That didn’t work. Please try again.');
      location.assign('/');
      return;
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  return (
    <div className="auth-form">
      <div className="mode"><button className="on" tabIndex={-1}>{reset ? 'New password' : 'Confirm email'}</button></div>
      <h1>{reset ? 'Choose a new one.' : 'One last click.'}</h1>
      <p className="muted lede">{reset ? 'Pick a password you don’t use anywhere else.' : 'Confirm this address to finish creating your account.'}</p>
      <form onSubmit={go} noValidate>
        {reset && <PasswordField value={pw} onChange={v => { setPw(v); setErr(''); }} label="New password" meter autoComplete="new-password" />}
        {err && <div className="fmsg" role="alert">{err} {!token || /invalid|expired|used/i.test(err) ? <a href="/login">Back to sign in</a> : null}</div>}
        <button className="primary go" type="submit" disabled={busy || !token}>{busy ? 'One moment…' : reset ? 'Save password' : 'Confirm my email'} <span aria-hidden="true">→</span></button>
      </form>
    </div>
  );
}
