// The look shared by sign-in, sign-up, email confirmation and password reset: a dark "scanning" stage on the left,
// and a white sheet cut on the diagonal on the right, with the form sitting low and to the left of its sheet instead of floating in the middle.
const BLIPS = [[62, 28, 0], [78, 52, 1.1], [48, 64, 2.2], [70, 76, 0.6], [34, 40, 1.8], [84, 34, 2.7]];
const SOURCES = [['Career pages', 8, 20, 0], ['Job boards', 52, 11, 1.4], ['Company ATS', 14, 58, 2.6]];

export default function AuthFrame({ children }) {
  return (
    <div className="auth">
      <aside className="auth-art" aria-hidden="true">
        <div className="art-top"><span className="logo" /><span className="art-brand">Scout</span><span className="mono">Live job &amp; internship finder</span></div>
        <div className="radar">{BLIPS.map(([x, y, d], i) => <span key={i} className="blip" style={{ left: x + '%', top: y + '%', animationDelay: d + 's' }} />)}</div>
        {SOURCES.map(([t, x, y, d]) => <span key={t} className="src-chip" style={{ left: x + '%', top: y + '%', animationDelay: d + 's' }}>{t}</span>)}
        <div className="art-copy">
          <p>Every opening, read straight from the page it lives on, then ranked against <em>you</em>.</p>
          <div className="auth-word">Scout<span>.</span></div>
        </div>
      </aside>
      <section className="auth-panel">
        <div className="auth-in">{children}</div>
      </section>
    </div>
  );
}
