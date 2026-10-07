'use client';
import { useScout } from './ScoutProvider';
import Prefs from './Prefs';
import Results, { RunPanel } from './Results';
import Tracker from './Tracker';
import Companies from './Companies';
import Alerts from './Alerts';
import Bell from './Bell';

const TABS = [['discover', 'Discover'], ['tracker', 'Tracker'], ['companies', 'Companies'], ['alerts', 'Alerts']];

export default function Shell() {
  const { status, toast, dismissToast, tab, setTab } = useScout();
  const u = status?.usage;
  const missing = status && !status.configured;

  return (
    <>
      <div className="announce">
        {missing
          ? <span><span className="dot off" />Setup needed: add TINYFISH_API_KEY to the server’s .env file and restart</span>
          : <span><span className="dot" />Live data via TinyFish{u ? ` · ${u.search} searches · ${u.fetch} pages read · ${u.agent} agent runs this session` : ''}{status?.ai?.problem ? ` · ⚠ AI reading paused: ${status.ai.problem}` : status?.ai?.enabled ? ` · AI reading on (${status.ai.usage.ok} postings)` : ' · AI reading off (optional: add GEMINI_API_KEY)'}</span>}
      </div>
      {status?.storage?.error && <div className="notice bad" role="alert">Storage problem: {status.storage.error}</div>}
      {status?.storage?.ephemeral && !status?.storage?.error && <div className="notice" role="note">Temporary storage: this deployment can’t keep data between restarts, so saved jobs, your tracker and alerts may reset. For permanent data, connect Google Firestore (see the README) or run Scout on a host with a persistent disk.</div>}
      <header className="top">
        <div className="wrap">
          <div className="brand"><span className="logo" />Scout</div>
          <nav>{TABS.map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {l}{k === 'alerts' && status?.alerts > 0 && <i>{status.alerts}</i>}
            </button>
          ))}</nav>
          <div className="right"><Bell /></div>
        </div>
      </header>
      <main className="wrap">
        <section hidden={tab !== 'discover'}>
          <div className="hero">
            <span className="mono">Live job &amp; internship finder</span>
            <h1>Find the role, not the portal.</h1>
            <p>Scout reads company career pages and job boards across India and the world in real time, removes duplicates, and ranks every opening against what you actually want.</p>
            <Prefs />
          </div>
          <RunPanel />
          <Results />
        </section>
        {tab === 'tracker' && <section className="page"><Tracker /></section>}
        {tab === 'companies' && <section className="page"><Companies /></section>}
        {tab === 'alerts' && <section className="page"><Alerts /></section>}
      </main>
      <footer className="foot"><div className="wrap">Scout · openings come from live pages via TinyFish Search, Fetch and Agent. Always confirm details on the employer’s site.</div></footer>
      {toast && (
        <div className={'toast ' + toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <span>{toast.msg}</span>
          {toast.action && <button className="toast-action" onClick={() => { toast.action.fn(); dismissToast(); }}>{toast.action.label}</button>}
          {toast.kind === 'error' && <button onClick={dismissToast} aria-label="Dismiss">✕</button>}
        </div>
      )}
    </>
  );
}
