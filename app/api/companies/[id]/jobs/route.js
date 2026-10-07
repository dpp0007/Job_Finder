import { get, loadJobs } from '@/lib/db';
import { normCompany } from '@/lib/parse';
import { handler, json } from '@/lib/http';

// Openings already indexed for one watchlist company, so the Companies page can show what a scan found.
export const GET = handler(async (_req, ctx) => {
  const { id } = await ctx.params;
  const c = get('SELECT * FROM companies WHERE id=?', Number(id));
  if (!c) return json({ error: 'Unknown company' }, 404);
  const nm = normCompany(c.name), slug = (c.slug || '').toLowerCase();
  const jobs = loadJobs(120)
    .filter(j => { const jc = normCompany(j.company); return (nm && jc && (jc.includes(nm) || nm.includes(jc))) || (slug && j.sources.some(s => s.url.toLowerCase().includes('/' + slug))); })
    .sort((a, b) => (b.postedAt || b.firstSeen) - (a.postedAt || a.firstSeen));
  return json({ total: jobs.length, jobs: jobs.slice(0, 30).map(j => ({ id: j.id, title: j.title, location: j.location, url: j.url, postedAt: j.postedAt, firstSeen: j.firstSeen, workMode: j.workMode, salary: j.salary, seniority: j.seniority, employmentType: j.employmentType })) });
});
