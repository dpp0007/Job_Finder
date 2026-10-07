'use client';
import { useEffect, useMemo, useState } from 'react';
import { useScout } from './ScoutProvider';
import Drawer from './Drawer';
import Select from './Select';
import { api, ago, cap, cleanTitle, DROP_LABEL, EXAMPLES, exportCsv, lpa, money, moneyMid, num, RELAX, scoreColor, shortLoc, VISA } from '@/lib/client';

const LV = { intern: 'Intern', entry: 'Fresher', mid: 'Mid', senior: 'Senior', lead: 'Lead+' };

const API_LABEL = { search: 'Search', fetch: 'Fetch', agent: 'Agent', ai: 'AI', rank: 'Rank', error: 'Error' };
const MISS = { type: 'Different job type', seniority: 'Different level', location: 'Different location', age: 'Posted earlier', salary: 'Below your pay floor', visa: 'No sponsorship' };
const PAGE = 25;

// ---------- progress: one plain-language line with a progress bar; the technical log is behind "Details" ----------
const FRIENDLY = { search: 'Checking job portals', fetch: 'Reading company career pages', agent: 'A browsing agent is handling a hard-to-read site', ai: 'Reading postings with AI', rank: 'Matching openings to your profile', error: 'Something went wrong' };
const BUDGET = { quick: 40, standard: 75, deep: 150 };

export function RunPanel() {
  const { run, search, prefs, status } = useScout();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!run || run.done) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [run]);
  if (!run) return null;
  const { stages, stats, done, error, t0, t1 } = run;
  const secs = Math.max(0, Math.round(((done ? t1 : now) - t0) / 1000));
  const bg = status?.background || 0;
  const last = stages[stages.length - 1];
  const C = [['searches', 'Searches'], ['hits', 'Results'], ['boards', 'Boards'], ['fetched', 'Pages read'], ['agent', 'Agent runs'], ['ai', 'AI-read'], ['found', 'Parsed'], ['fresh', 'New']];
  const text = error ? error
    : done ? `Done in ${secs}s · ${stats.fresh || 0} new openings read${stats.failed ? ' · a few requests failed' : ''}${bg ? ` · ${bg} slower task${bg > 1 ? 's' : ''} still finishing in the background` : ''}`
      : `${FRIENDLY[last?.api] || 'Searching'}… ${secs}s · ${stats.found || 0} openings read so far`;
  return (
    <div className={'runbar' + (error ? ' bad' : '')}>
      <div className="runbar-top">
        {!done ? <span className="spin dark" /> : error ? <b>!</b> : <b>✓</b>}
        <span className="grow">{text}</span>
        {error && <button className="link" onClick={() => search()}>Retry</button>}
        <button className="link" onClick={() => setOpen(o => !o)}>{open ? 'Hide details' : 'Details'}</button>
      </div>
      {!done && <div className="progress"><i style={{ width: Math.min(94, secs / (BUDGET[prefs?.depth] || 75) * 100) + '%' }} /></div>}
      {open && (
        <div className="console inner">
          {stages.map((s, i) => (
            <div className="st" key={i}><span className={'api ' + s.api}>{API_LABEL[s.api]}</span><span>{s.msg}</span>{!done && i === stages.length - 1 && <span className="spin" />}</div>
          ))}
          <div className="counters">{C.map(([k, l]) => <div key={k}><b>{stats[k] || 0}</b>{l}</div>)}</div>
        </div>
      )}
    </div>
  );
}

function Bars({ rows }) {
  const mx = rows[0]?.[1] || 1;
  return <div className="mini">{rows.slice(0, 5).map(([k, v]) => (
    <div className="bar1" key={k}><span title={k} className="clip">{k}</span><i style={{ '--w': `${v / mx * 100}%` }} /><span>{v}</span></div>
  ))}</div>;
}

function Insights({ results }) {
  const s = useMemo(() => {
    const count = f => { const m = {}; results.forEach(j => [].concat(f(j) || []).forEach(k => m[k] = (m[k] || 0) + 1)); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const sal = results.filter(j => j.salary && j.salary.period !== 'month').map(j => moneyMid(j.salary)).sort((a, b) => a - b);
    return { skills: count(j => j.skills), companies: count(j => j.company), sal, sponsors: results.filter(j => j.visa === 'yes').length, fresh: results.filter(j => j.firstSeen > Date.now() - 2 * 864e5).length };
  }, [results]);
  if (results.length < 5) return null;
  return (
    <div className="ins">
      <div><h5>Openings found</h5><div className="big">{num(results.length)}</div><div className="muted">at {num(s.companies.length)} companies · {num(s.fresh)} added in the last 2 days</div></div>
      <div><h5>Typical pay (median)</h5><div className="big small">{s.sal.length ? lpa(s.sal[Math.floor(s.sal.length / 2)]) : 'Not listed'}</div><div className="muted">{s.sal.length ? `from ${s.sal.length} openings that show pay` : 'Most employers don’t publish pay'}{s.sponsors ? ` · ${s.sponsors} sponsor visas` : ''}</div></div>
      <div><h5>Skills asked for most</h5>{s.skills.length ? <Bars rows={s.skills} /> : <div className="muted">None detected</div>}<div className="cap">number = openings that mention it</div></div>
      <div><h5>Companies hiring most</h5><Bars rows={s.companies} /><div className="cap">number = open roles in your results</div></div>
    </div>
  );
}

function Row({ j, isNew, onOpen, onAct, near }) {
  const matched = new Set(j.matched);
  return (
    <article className="jobrow" onClick={() => onOpen(j)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(j)}>
      {!near && <div className="num" title="How well this opening fits your search, out of 100" style={{ '--s': j.score, '--c': scoreColor(j.score) }}>{j.score}<small /><em>% match</em></div>}
      <div>
        <h3 title={j.title}>{cleanTitle(j.title)}{isNew && (!j.postedAt || Date.now() - j.postedAt < 30 * 864e5) && <span className="new">JUST FOUND</span>}</h3>
        {j.summary && <div className="summary">{j.summary}</div>}
        <div className="meta"><b>{j.company}</b>{j.location ? ' · ' + shortLoc(j.location) : ''}{j.postedAt ? ' · ' + ago(j.postedAt) : ' · found ' + ago(j.firstSeen)}<span className="via"> · via {cap(j.sources[0]?.name || 'web')}</span></div>
        <div>
          {near && <span className="badge miss">{MISS[j.missed]}</span>}
          {j.workMode !== 'unknown' && <span className="badge brand">{cap(j.workMode)}</span>}
          <span className={'badge' + (j.seniorityConf === 'default' && j.employmentType !== 'intern' ? ' warn' : '')}>{j.employmentType === 'intern' ? 'Internship' : j.seniorityConf === 'default' ? 'Level not stated' : LV[j.seniority]}</span>
          {!['fulltime', 'intern'].includes(j.employmentType) && <span className="badge">{cap(j.employmentType)}</span>}
          {VISA[j.visa] && <span className={'badge ' + VISA[j.visa][1]}>{VISA[j.visa][0]}</span>}
          {j.optCpt && <span className="badge good">OPT/CPT</span>}
          {j.salary && <span className="badge good">{money(j.salary)}</span>}
          {j.sources.length > 1 && <span className="badge">{j.sources.length} sources</span>}
        </div>
        {!near && j.skills.length > 0 && <div>{j.skills.slice(0, 7).map(s => <span key={s} className={'sk' + (matched.has(s) ? ' hit' : '')}>{s}</span>)}</div>}
        {!near && <div className="why">{j.reasons.slice(0, 3).map(r => <span key={r}>{r}</span>)}</div>}
      </div>
      <div className="acts" onClick={e => e.stopPropagation()}>
        <a className="btn" href={j.url} target="_blank" rel="noopener noreferrer">Apply</a>
        <button className="link" onClick={() => onAct(j, j.stage === 'saved' ? 'unsave' : 'save')}>{j.stage ? 'Saved ✓' : 'Save'}</button>
        <button className="link muted-link" onClick={() => onAct(j, 'hide')}>Hide</button>
      </div>
    </article>
  );
}

const Skeleton = () => <div aria-busy="true">{[0, 1, 2, 3].map(i => (
  <div className="jobrow sk-row" key={i}><div className="num"><span className="shim" style={{ width: 44, height: 40 }} /></div>
    <div><span className="shim" style={{ width: '55%', height: 26 }} /><span className="shim" style={{ width: '35%', height: 14, marginTop: 10 }} /><span className="shim" style={{ width: '70%', height: 14, marginTop: 14 }} /></div><div /></div>
))}</div>;

const FACET0 = { q: '', mode: '', level: '', visa: false, paid: false, fresh: false, saved: false };

export default function Results() {
  const { data, patchResults, notify, run, loaded, started, setStarted, setTab, jump, setJump, pending, flushPending, prefs, setPrefs, setPref, search, runExample } = useScout();
  const { results, dropped, scanned, newSince } = data;
  const near = data.near || [];
  const [sort, setSort] = useState('score');
  const [open, setOpen] = useState(null);
  const [f, setF] = useState(FACET0);
  const [shown, setShown] = useState(PAGE);
  const searching = run && !run.done;
  useEffect(() => setShown(PAGE), [f, sort]);
  useEffect(() => { if (jump) { setF({ ...FACET0, q: jump.q }); setJump(null); } }, [jump, setJump]);

  const facets = useMemo(() => {
    const c = k => results.filter(j => j[k]).length;
    const modes = ['remote', 'hybrid', 'onsite'].map(m => [m, results.filter(j => j.workMode === m).length]).filter(x => x[1]);
    const levels = ['intern', 'entry', 'mid', 'senior', 'lead'].map(l => [l, results.filter(j => j.seniority === l && j.seniorityConf !== 'default').length]).filter(x => x[1]);
    return {
      modes, levels, visa: results.filter(j => j.visa === 'yes').length, paid: c('salary'),
      fresh: results.filter(j => j.firstSeen > Date.now() - 2 * 864e5 || (j.postedAt && j.postedAt > Date.now() - 3 * 864e5)).length, saved: results.filter(j => j.stage === 'saved').length,
    };
  }, [results]);

  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const a = results.filter(j => (!q || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)) && (!f.mode || j.workMode === f.mode) && (!f.level || j.seniority === f.level)
      && (!f.visa || j.visa === 'yes') && (!f.paid || j.salary) && (!f.saved || j.stage === 'saved')
      && (!f.fresh || j.firstSeen > Date.now() - 2 * 864e5 || (j.postedAt && j.postedAt > Date.now() - 3 * 864e5)));
    if (sort === 'date') a.sort((x, y) => (y.postedAt || y.firstSeen) - (x.postedAt || x.firstSeen));
    if (sort === 'salary') a.sort((x, y) => (y.salary?.max || 0) - (x.salary?.max || 0));
    return a;
  }, [results, sort, f]);

  const act = async (j, a) => {
    try {
      if (a === 'save') { await api('/tracker', 'POST', { jobId: j.id, stage: 'saved' }); patchResults(r => r.map(x => x.id === j.id ? { ...x, stage: 'saved' } : x)); notify('Saved to your tracker', 'ok', { label: 'View tracker', fn: () => setTab('tracker') }); }
      if (a === 'unsave') { await api('/tracker', 'POST', { jobId: j.id, stage: null }); patchResults(r => r.map(x => x.id === j.id ? { ...x, stage: null } : x)); }
      if (a === 'hide') { await api('/tracker', 'POST', { jobId: j.id, stage: 'hidden' }); patchResults(r => r.filter(x => x.id !== j.id)); notify('Hidden. It won’t show up again.'); }
    } catch (e) { notify(e.message, 'error'); }
  };

  const reasons = Object.entries(dropped).filter(([k]) => RELAX[k]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const relax = k => setPrefs(p => ({ ...p, ...RELAX[k][1]() }));
  const faceted = JSON.stringify(f) !== JSON.stringify(FACET0);
  const noNew = run?.done && !run.error && !run.stats.found;
  const tog = k => setF(x => ({ ...x, [k]: !x[k] }));
  const drop = Object.entries(dropped).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${num(v)} ${DROP_LABEL[k] || k}`).join(', ');

  // Nothing is shown until the user searches or chooses to continue: the stored index is not "results".
  const hasQuery = !!prefs && (prefs.roles.length || prefs.keywords.length);
  const last = prefs ? [prefs.roles.join(', '), prefs.keywords.join(', '), prefs.locations.join(', ')].filter(Boolean).join(' · ') : '';
  if (loaded && !started && !run) return (
    <div className="empty" style={{ paddingTop: 56 }}>
      <h3>Start with a search</h3>
      <p>Enter a role and city above and press <b>Search live</b>, or try an example.</p>
      <div className="chips center">{EXAMPLES.map(ex => <span className="chip" key={ex.label} onClick={() => runExample(ex)}>{ex.label}</span>)}</div>
      {hasQuery && scanned > 0 && (
        <p style={{ marginTop: 28 }}>Or <button className="link" onClick={() => setStarted(true)}>continue your last search ({last})</button> to see the {num(scanned)} openings already in your index.</p>
      )}
    </div>
  );

  // ----- empty states: every one ends in a next action -----
  let empty = null;
  if (loaded && !searching && !list.length) {
    if (!scanned && !run) empty = (
      <div className="empty">
        <h3>Start with a search</h3>
        <p>Pick an example to see Scout work, or enter your own role above.</p>
        <div className="chips center">{EXAMPLES.map(ex => <span className="chip" key={ex.label} onClick={() => runExample(ex)}>{ex.label}</span>)}</div>
      </div>);
    else if (results.length && faceted) empty = (
      <div className="empty"><h3>No openings with these quick filters</h3><p>{results.length} matches are hidden by your quick filters.</p><button className="ghost" onClick={() => setF(FACET0)}>Clear quick filters</button></div>);
    else empty = (
      <div className="empty">
        <h3>{noNew ? 'Nothing new this time' : 'No exact matches'}</h3>
        <p>{noNew ? 'The live search found no new openings for these settings.' : scanned ? 'Your filters removed everything. Loosen one:' : 'Nothing indexed yet. Run a live search to pull fresh openings.'}</p>
        <div className="chips center">
          {reasons.map(([k, n]) => <span className="chip" key={k} onClick={() => relax(k)}>{RELAX[k][0]} · +{n}</span>)}
          {prefs?.depth !== 'deep' && <span className="chip" onClick={() => { setPref('depth', 'deep'); search({ ...prefs, depth: 'deep' }); }}>Search deeper</span>}
          <span className="chip dark" onClick={() => search()}>Search live again</span>
        </div>
        {near.length > 0 && <p className="muted" style={{ marginTop: 20 }}>Closest openings are below.</p>}
      </div>);
  }

  return (
    <>
      {pending && <button className="pill-new" onClick={() => { flushPending(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>↑ {Math.max(pending.snap.results.length - results.length, 0) || 'Updated'} {pending.snap.results.length > results.length ? 'new matches' : 'results'} · Show</button>}
      <Insights results={results} />
      <div className="results-head">
        <h2>{faceted ? `${list.length} of ${results.length}` : results.length} {results.length === 1 ? 'match' : 'matches'}{searching && <span className="live"><span className="spin dark" /> live</span>}</h2>
        <span className="meta">Showing the best of {num(scanned)} openings in your index{drop ? `. Hidden: ${drop}.` : '.'}</span>
        <span className="grow" />
        <Select variant="pill" value={sort} onChange={setSort} label="Sort results" align="right"
          options={[['score', 'Best match'], ['date', 'Newest first'], ['salary', 'Highest pay']]} />
        <button className="ghost" disabled={!list.length} onClick={() => exportCsv(list)}>Export CSV</button>
      </div>

      {results.length > 4 && (
        <div className="facets">
          <input type="text" className="fsearch" placeholder="Filter these results…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} aria-label="Filter results" />
          {facets.modes.filter(x => x[1] < results.length).map(([m, n]) => <span key={m} className={'chip' + (f.mode === m ? ' on' : '')} onClick={() => setF({ ...f, mode: f.mode === m ? '' : m })}>{cap(m)} {n}</span>)}
          {facets.levels.filter(x => x[1] < results.length).map(([l, n]) => <span key={l} className={'chip' + (f.level === l ? ' on' : '')} onClick={() => setF({ ...f, level: f.level === l ? '' : l })}>{LV[l]} {n}</span>)}
          {facets.visa > 0 && facets.visa < results.length && <span className={'chip' + (f.visa ? ' on' : '')} onClick={() => tog('visa')}>Sponsors visa {facets.visa}</span>}
          {facets.paid > 0 && facets.paid < results.length && <span className={'chip' + (f.paid ? ' on' : '')} onClick={() => tog('paid')}>Pay shown {facets.paid}</span>}
          {facets.fresh > 0 && facets.fresh < results.length && <span className={'chip' + (f.fresh ? ' on' : '')} onClick={() => tog('fresh')}>Added recently {facets.fresh}</span>}
          {facets.saved > 0 && <span className={'chip' + (f.saved ? ' on' : '')} onClick={() => tog('saved')}>Saved {facets.saved}</span>}
          {faceted && <button className="link" onClick={() => setF(FACET0)}>Clear</button>}
        </div>
      )}

      {!loaded || (searching && !list.length && !near.length) ? <Skeleton /> : (
        <>
          {list.slice(0, shown).map(j => <Row key={j.id} j={j} isNew={newSince && j.firstSeen >= newSince} onOpen={setOpen} onAct={act} />)}
          {list.length > shown && <div className="more"><button className="ghost" onClick={() => setShown(s => s + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more · {list.length - shown} left</button></div>}
        </>
      )}
      {empty}

      {near.length > 0 && results.length < 6 && !searching && (
        <section className="near">
          <h3>Almost matched</h3>
          <p className="muted" style={{ margin: '0 0 8px' }}>Right role, one filter off. Open one to see the details.</p>
          {near.map(j => <Row key={j.id} j={j} near onOpen={setOpen} onAct={act} />)}
        </section>
      )}
      {open && <Drawer job={open} onClose={() => setOpen(null)} onClosed={id => patchResults(r => r.filter(x => x.id !== id))} />}
    </>
  );
}
