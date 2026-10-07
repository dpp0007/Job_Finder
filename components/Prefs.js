'use client';
import { useState } from 'react';
import { useScout } from './ScoutProvider';
import { ChipGroup, Seg, TagInput } from './Fields';
import Select from './Select';
import ResumeBox from './ResumeBox';
import { api, LEVELS, MODES, TYPES } from '@/lib/client';

const AGE = [[0, 'Any time'], [1, '24 hours'], [3, '3 days'], [7, '7 days'], [14, '14 days'], [30, '30 days']];
const DEPTH = [['quick', 'Quick'], ['standard', 'Standard'], ['deep', 'Deep']];

// The search card: the two inputs that matter up front, quick filters inline, everything else under "More filters".
export default function Finder() {
  const { prefs: p, setPref, status, search, run, notify, refreshStatus, formError, setFormError } = useScout();
  const [more, setMore] = useState(false);
  if (!p) return <div className="finder" style={{ minHeight: 180 }} />;
  const busy = run && !run.done;
  const active = [p.keywords.length, p.must.length, p.exclude.length, p.visa !== 'any', p.minSalary, p.payOnly, p.postedWithin].filter(Boolean).length;

  const saveAlert = async () => {
    const name = [p.roles[0] || 'Any role', p.locations[0] || (p.workMode !== 'any' ? p.workMode : '')].filter(Boolean).join(' · ');
    if (!p.roles.length && !p.keywords.length) return setFormError('Add a role first, then save it as an alert.');
    try {
      const r = await api('/searches', 'POST', { name, prefs: p });
      notify(r.duplicate ? 'You already have this alert' : 'Alert saved. It re-runs automatically.'); refreshStatus();
    } catch (e) { notify(e.message, 'error'); }
  };

  return (
    <div className="finder">
      <div className="finder-main">
        <div className="field"><label>Role</label><TagInput kind="roles" value={p.roles} onChange={v => { setPref('roles', v); setFormError(''); }} placeholder="Data scientist, Product designer…" /></div>
        <div className="field"><label>Location</label><TagInput kind="locations" value={p.locations} onChange={v => setPref('locations', v)} placeholder="Bengaluru, Pune, Remote India…" /></div>
        <div className="go"><button className="primary" disabled={busy || (status && !status.configured)} onClick={() => search()} title={status && !status.configured ? 'Server is missing TINYFISH_API_KEY' : ''}>{busy ? 'Searching…' : 'Search live'}</button></div>
      </div>
      {formError && <div className="ferr" role="alert">{formError}</div>}
      <div className="finder-sub">
        <div className="grp"><span className="lbl" style={{ margin: 0 }}>Mode</span><Seg value={p.workMode} onChange={v => setPref('workMode', v)} options={MODES} /></div>
        <div className="grp"><span className="lbl" style={{ margin: 0 }}>Level</span><ChipGroup value={p.seniority} onChange={v => setPref('seniority', v)} options={LEVELS} /></div>
        <span className="grow" />
        <button className="link" onClick={() => setMore(m => !m)}>{more ? 'Fewer filters' : `More filters${active ? ` (${active})` : ''}`}</button>
        <button className="link" onClick={saveAlert} title="Re-run this search automatically and flag new openings">Save as alert</button>
      </div>
      <div className="finder-resume"><ResumeBox /></div>
      {more && (
        <div className="refine">
          <div><span className="lbl">Job type</span><ChipGroup value={p.types} onChange={v => setPref('types', v)} options={TYPES} /></div>
          <div><span className="lbl">Work abroad / visa</span>
            <Select value={p.visa} onChange={v => setPref('visa', v)} label="Visa" options={[['any', 'No visa requirement'], ['need', 'I need visa sponsorship']]} /></div>
          <div className="two">
            <div><span className="lbl">Min pay (₹ LPA)</span><input type="number" min="0" max="1000" step="1" placeholder="e.g. 8" value={p.minSalary ? p.minSalary / 1e5 : ''} onChange={e => setPref('minSalary', Math.round(Math.min(1000, Math.max(0, +e.target.value || 0)) * 1e5))} /></div>
            <div><span className="lbl">Posted within</span><Select value={p.postedWithin} onChange={v => setPref('postedWithin', v)} label="Posted within" options={AGE} /></div>
          </div>
          <div><span className="lbl">Pay</span><ChipGroup value={p.payOnly ? ['pay'] : []} onChange={v => setPref('payOnly', v.includes('pay'))} options={[['pay', 'Only jobs that list pay']]} />
            <p className="sm muted" style={{ margin: '8px 0 0' }}>Many employers don’t publish pay, so unlisted jobs stay visible unless you tick this.</p></div>
          <div><span className="lbl">Keywords</span><TagInput kind="keywords" value={p.keywords} onChange={v => setPref('keywords', v)} placeholder="python, figma…" />
            <div style={{ marginTop: 10 }}><Seg value={p.keywordMode || 'any'} onChange={v => setPref('keywordMode', v)} options={[['any', 'Must mention one'], ['boost', 'Boost ranking only']]} /></div></div>
          <div><span className="lbl">Must include</span><TagInput kind="must" value={p.must} onChange={v => setPref('must', v)} placeholder="optional" /></div>
          <div><span className="lbl">Exclude</span><TagInput kind="exclude" value={p.exclude} onChange={v => setPref('exclude', v)} placeholder="unpaid, clearance…" /></div>
          <div className="two2"><span className="lbl">Sources</span><ChipGroup value={p.portals} onChange={v => setPref('portals', v)} options={(status?.portals || []).map(x => [x.id, x.label])} /></div>
          <div><span className="lbl">Search depth</span><Seg value={p.depth} onChange={v => setPref('depth', v)} options={DEPTH} /></div>
        </div>
      )}
    </div>
  );
}
