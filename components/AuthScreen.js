'use client';
import { useState } from 'react';
import PasswordField from './PasswordField';
import { checkEmail, checkName, checkPassword } from '@/lib/password';

const COPY = {
  signin: { h: 'Welcome back.', p: 'Pick up your search where you left it.', cta: 'Sign in' },
  signup: { h: 'Start scouting.', p: 'Make an account to rank jobs against your resume and track every application.', cta: 'Create account' },
  forgot: { h: 'Reset it.', p: 'Enter your email and we’ll send a link to choose a new password.', cta: 'Send reset link' },
};

async function post(path, body) {
  let r;
  try { r = await fetch('/api/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('Can’t reach the server. Check your connection and try again.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Something went wrong (${r.status}).`);
  return j;
}

export default function AuthScreen({ providers = [], error = '', next = '/', mode: first = 'signin' }) {
  const [mode, setMode] = useState(first);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error);
  const [done, setDone] = useState(null);          // { message, devLink } after sign-up / reset request
  const set = k => v => { setF(x => ({ ...x, [k]: v })); setErr(''); };
  const switchTo = m => { setMode(m); setErr(''); setDone(null); };

  const submit = async e => {
    e.preventDefault();
    if (busy) return;
    const email = checkEmail(f.email);
    if (!email.ok) return setErr(email.error);
    if (mode === 'signup') {
      const n = checkName(f.name), p = checkPassword(f.password, email.value);
      if (!n.ok) return setErr(n.error);
      if (!p.ok) return setErr(p.error);
    }
    setBusy(true); setErr('');
    try {
      if (mode === 'signin') { await post('login', { email: email.value, password: f.password, next }); location.assign(next); return; }
      if (mode === 'signup') setDone(await post('signup', { name: f.name, email: email.value, password: f.password }));
      else setDone(await post('forgot', { email: email.value }));
      setF(x => ({ ...x, password: '' }));
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  const c = COPY[mode];
  return (
    <div className="auth-form">
      <div className="mode" role="tablist" aria-label="Account">
        <button role="tab" aria-selected={mode !== 'signup'} className={mode !== 'signup' ? 'on' : ''} onClick={() => switchTo('signin')}>Sign in</button>
        <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchTo('signup')}>Create account</button>
      </div>

      {done ? (
        <div className="sent" role="status">
          <div className="envelope" aria-hidden="true" />
          <h2>Check your inbox.</h2>
          <p>{done.message}</p>
          <p className="muted sm">Nothing arrived after a few minutes? Look in spam, then try again.</p>
          {done.devLink && <p className="sm"><a href={done.devLink}>Development only: open the link</a></p>}
          <button className="link" onClick={() => switchTo('signin')}>Back to sign in</button>
        </div>
      ) : (
        <>
          <h1>{c.h}</h1>
          <p className="muted lede">{c.p}</p>
          <form onSubmit={submit} noValidate>
            {mode === 'signup' && (
              <div className="af"><label htmlFor="af-name">Your name</label>
                <input id="af-name" type="text" value={f.name} onChange={e => set('name')(e.target.value)} autoComplete="name" maxLength={60} required /></div>
            )}
            <div className="af"><label htmlFor="af-email">Email</label>
              <input id="af-email" type="email" value={f.email} onChange={e => set('email')(e.target.value)} autoComplete="email" maxLength={254} required spellCheck={false} autoCapitalize="none" /></div>
            {mode !== 'forgot' && (
              <PasswordField value={f.password} onChange={set('password')} email={f.email} meter={mode === 'signup'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            )}
            {err && <div className="fmsg" role="alert">{err}</div>}
            <button className="primary go" type="submit" disabled={busy}>{busy ? 'One moment…' : c.cta} <span aria-hidden="true">→</span></button>
            <div className="auth-links">
              {mode === 'signin' && <button type="button" className="link" onClick={() => switchTo('forgot')}>Forgot password?</button>}
              {mode === 'forgot' && <button type="button" className="link" onClick={() => switchTo('signin')}>Back to sign in</button>}
              {mode === 'signup' && <span className="muted sm">Access is by invitation: use the email address you were invited with.</span>}
            </div>
          </form>

          {providers.length > 0 && mode !== 'forgot' && (
            <>
              <div className="or"><span>or continue with</span></div>
              <div className="oauth">{providers.map(p => <a key={p.id} className="ghost" href={`/api/auth/${p.id}?next=${encodeURIComponent(next)}`}>{p.id === 'dev' ? 'Local test account' : p.label}</a>)}</div>
            </>
          )}
        </>
      )}
      <p className="muted sm legal">Your resume, searches and tracker are private to your account. Passwords are stored only as salted scrypt hashes.</p>
    </div>
  );
}
