'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, stream } from '@/lib/client';

const Ctx = createContext(null);
export const useScout = () => useContext(Ctx);

const EMPTY = { results: [], near: [], dropped: {}, scanned: 0, newSince: 0 };
const RESET = { roles: [], locations: [], workMode: 'any', seniority: [], types: [], keywords: [], must: [], exclude: [], visa: 'any', minSalary: 0, postedWithin: 0 };

export function ScoutProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [resume, setResume] = useState('');
  const [data, setData] = useState(EMPTY);
  const [pending, setPending] = useState(null);   // snapshot held back while the user is scrolled down
  const [loaded, setLoaded] = useState(false);
  const [started, setStarted] = useState(false); // results stay hidden until the user searches or chooses to continue
  const [run, setRun] = useState(null);           // { stages, stats, done, error }
  const [toast, setToast] = useState(null);       // { msg, kind: 'ok' | 'error' }
  const [formError, setFormError] = useState('');
  const [tab, setTab] = useState('discover');
  const [notifs, setNotifs] = useState({ items: [], unread: 0 });
  const [bellOpen, setBellOpen] = useState(false);
  const [perm, setPerm] = useState('default');
  const [jump, setJump] = useState(null);         // { q } asks Discover to focus on one company
  const seen = useRef(null), bgPrev = useRef(0);
  const running = useRef(false), ready = useRef(false), dataRef = useRef(EMPTY), timer = useRef();
  dataRef.current = data;

  const notify = useCallback((msg, kind = 'ok', action) => {
    setToast({ msg, kind, action });
    clearTimeout(timer.current);
    if (kind !== 'error') timer.current = setTimeout(() => setToast(null), action ? 7000 : 3500); // errors stay until dismissed
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);
  const refreshStatus = useCallback(async () => { try { setStatus(await api('/status')); } catch { /* surfaced by init */ } }, []);
  const setPref = useCallback((k, v) => setPrefs(p => ({ ...p, [k]: v })), []);

  const init = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api('/status'), api('/profile')]);
      setStatus(s); setPrefs(p.prefs); setResume(p.resume);
      setData({ ...EMPTY, ...(await api('/rank', 'POST', { prefs: p.prefs, resume: p.resume })) });
      ready.current = true;
    } catch (e) { notify(e.message, 'error'); }
    setLoaded(true);
  }, [notify]);
  useEffect(() => { init(); }, [init]);

  // Persist preferences and re-rank the stored index whenever they change.
  useEffect(() => {
    if (!ready.current || !prefs) return;
    const t = setTimeout(async () => {
      api('/profile', 'PUT', { prefs, resume }).catch(() => {});
      if (!running.current) { setPending(null); setData({ ...EMPTY, ...(await api('/rank', 'POST', { prefs, resume }).catch(() => dataRef.current)) }); }
    }, 500);
    return () => clearTimeout(t);
  }, [prefs, resume]);

  const setResults = useCallback((r, newSince = 0) => { setStarted(true); setPending(null); setData({ ...EMPTY, ...r, newSince }); }, []);
  const patchResults = useCallback(fn => setData(d => ({ ...d, results: fn(d.results) })), []);
  const flushPending = useCallback(() => { setPending(p => { if (p) setData({ ...EMPTY, ...p.snap, newSince: p.since }); return null; }); }, []);

  // New results stream in during a run. If the user is reading further down, don't reshuffle the list under them.
  const offer = useCallback((snap, since) => {
    if (typeof window !== 'undefined' && window.scrollY > 500 && dataRef.current.results.length) setPending({ snap, since });
    else setResults(snap, since);
  }, [setResults]);

  const search = useCallback(async override => {
    if (running.current) return;
    const P = override?.roles ? override : prefs;
    if (!status?.configured) return notify('Scout can’t search yet: add TINYFISH_API_KEY to the server’s .env file and restart.', 'error');
    if (!P.roles.length && !P.keywords.length) return setFormError('Add a role (or a keyword) so Scout knows what to look for.');
    setFormError('');
    setStarted(true);
    running.current = true;
    const stages = []; let stats = {};
    const t0 = Date.now();
    const push = (done, error) => setRun({ stages: [...stages], stats, done, error, t0, t1: done ? Date.now() : null });
    push(false);
    const started = Date.now();
    try {
      await stream('/search', { prefs: P, resume }, ev => {
        if (ev.type === 'stage') { stages.push(ev); push(false); if (ev.api === 'error' && /AI reading/.test(ev.msg)) notify(ev.msg, 'error'); }
        if (ev.type === 'progress' || ev.type === 'batch') { stats = ev.stats; push(false); }
        if (ev.type === 'results') offer(ev, started);
        if (ev.type === 'done') { stats = ev.stats; stages.push({ api: 'rank', msg: `Ranked ${ev.results.length} matches from ${ev.scanned} indexed openings` }); push(true); offer(ev, started); }
        if (ev.type === 'error') throw new Error(ev.message);
      });
    } catch (e) {
      stages.push({ api: 'error', msg: e.message }); push(true, e.message);
      notify(e.message, 'error');
    }
    running.current = false;
    setRun(r => r && { ...r, done: true });
    refreshStatus();
  }, [status, prefs, resume, notify, offer, refreshStatus]);

  const rerank = useCallback(async () => {
    try { setData({ ...EMPTY, ...(await api('/rank', 'POST', { prefs, resume })) }); } catch { /* keep what is on screen */ }
  }, [prefs, resume]);

  // ---- alerts: poll for notifications and for slow background work (cheap, only while the tab is visible) ----
  useEffect(() => { if (typeof Notification !== 'undefined') setPerm(Notification.permission); }, []);

  const pollNotifs = useCallback(async () => {
    try {
      const n = await api('/notifications');
      setNotifs(n);
      const maxId = Math.max(0, ...n.items.map(i => i.id));
      if (seen.current === null) { seen.current = maxId; return; }       // first poll: don't announce old ones
      const fresh = n.items.filter(i => i.id > seen.current && !i.read).reverse();
      seen.current = Math.max(seen.current, maxId);
      for (const i of fresh) {
        notify(i.title, 'ok', { label: 'View', fn: () => setBellOpen(true) });
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const d = new Notification(i.title, { body: i.body, tag: 'scout-' + i.id });
          d.onclick = () => { window.focus(); setBellOpen(true); d.close(); };
        }
      }
    } catch { /* offline: try again next tick */ }
  }, [notify]);

  const pollStatus = useCallback(async () => {
    try {
      const s = await api('/status');
      setStatus(s);
      if (bgPrev.current > 0 && s.background === 0 && !running.current) {
        await rerank();
        notify('Slower sites finished reading in the background. Results updated.');
      }
      bgPrev.current = s.background;
    } catch { /* offline */ }
  }, [rerank, notify]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') { pollNotifs(); pollStatus(); } };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [pollNotifs, pollStatus]);

  useEffect(() => { document.title = `${notifs.unread ? `(${notifs.unread}) ` : ''}Scout — live job finder`; }, [notifs.unread]);

  const enableDesktop = useCallback(async () => {
    if (typeof Notification === 'undefined') return notify('This browser doesn’t support desktop notifications.', 'error');
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') { new Notification('Desktop alerts are on', { body: 'Scout will tell you when a saved search finds new openings.' }); notify('Desktop alerts turned on'); }
    else notify('Desktop alerts are blocked. Allow notifications for this site in your browser settings.', 'error');
  }, [notify]);

  const markRead = useCallback(async arg => { try { setNotifs(await api('/notifications', 'POST', arg)); } catch (e) { notify(e.message, 'error'); } }, [notify]);

  // Demo: sends a real notification through the same path an alert uses, with openings already in your index.
  const sendDemo = useCallback(async () => {
    try { await api('/notifications/demo', 'POST', { prefs, resume }); await pollNotifs(); setBellOpen(true); }
    catch (e) { notify(e.message, 'error'); }
  }, [prefs, resume, pollNotifs, notify]);

  // One-click example: fill the preferences and run immediately.
  const runExample = useCallback(({ label, ...ex }) => { const next = { ...prefs, ...RESET, ...ex }; setPrefs(next); search(next); }, [prefs, search]);

  const value = { status, refreshStatus, prefs, setPref, setPrefs, resume, setResume, data, setResults, patchResults, pending, flushPending, loaded, started, setStarted, run, search, runExample, formError, setFormError, toast, notify, dismissToast, tab, setTab, jump, setJump, rerank, notifs, bellOpen, setBellOpen, perm, enableDesktop, markRead, sendDemo };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
