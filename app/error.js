'use client';

// Route-level error boundary: a render crash shows a recovery screen instead of a blank page.
export default function Error({ error, reset }) {
  return (
    <div className="wrap" style={{ padding: '120px 32px', textAlign: 'center' }}>
      <span className="mono">Something broke</span>
      <h1 style={{ font: '400 clamp(36px,6vw,64px)/1.05 var(--display)', letterSpacing: '-.02em', margin: '14px 0' }}>That didn’t load.</h1>
      <p className="muted" style={{ maxWidth: 480, margin: '0 auto 28px' }}>{error?.message || 'An unexpected error occurred.'} Your saved searches and tracker are safe.</p>
      <div className="row end" style={{ justifyContent: 'center' }}>
        <button className="primary" onClick={reset}>Try again</button>
        <a className="link" href="/">Back to Scout</a>
      </div>
    </div>
  );
}
