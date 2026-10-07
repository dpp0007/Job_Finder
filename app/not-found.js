export default function NotFound() {
  return (
    <div className="wrap" style={{ padding: '120px 32px', textAlign: 'center' }}>
      <span className="mono">404</span>
      <h1 style={{ font: '400 clamp(36px,6vw,64px)/1.05 var(--display)', letterSpacing: '-.02em', margin: '14px 0' }}>Nothing here.</h1>
      <p className="muted" style={{ marginBottom: 28 }}>That page doesn’t exist. Your openings are one click away.</p>
      <a className="btn" href="/">Back to Scout</a>
    </div>
  );
}
