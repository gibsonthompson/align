import Link from 'next/link';
import { getLifeOverview, getSectors } from '@/lib/data';
import TopBar from '@/components/TopBar';

export const dynamic = 'force-dynamic';

function Meter({ v }: { v: number | null }) {
  if (!v) return <span className="dim">Not rated</span>;
  return (
    <span className="meter" aria-label={`${v} of 10`}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < v ? 'on' : undefined} />
      ))}
    </span>
  );
}

export default async function LifePage() {
  const [sectors, all] = await Promise.all([getLifeOverview(), getSectors()]);
  const priorities = sectors.filter((s) => s.mode === 'priority').length;
  const total = sectors.reduce((n, s) => n + s.pages, 0);

  return (
    <>
      <TopBar title="Life" />
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Life</h1>
            <p>
              {sectors.length} sectors, {total} {total === 1 ? 'page' : 'pages'}
              {priorities ? `, ${priorities} marked as a current priority` : ''}.
            </p>
          </div>
        </div>
        <section className="panel ltable">
          <div className="lhead" aria-hidden>
            <span>Sector</span>
            <span>Pages</span>
            <span>Active</span>
            <span>Overdue</span>
            <span className="c-wide">Mode</span>
            <span className="c-wide">Satisfaction</span>
            <span className="c-wide">Areas</span>
          </div>
          {sectors.map((s) => {
            const areas = all.filter((a) => a.parent_id === s.id);
            return (
              <Link key={s.id} href={`/s/${s.slug}`} className="lrow" style={{ ['--c' as string]: s.colour }}>
                <span className="name">
                  <i className="swatch" aria-hidden />
                  <span>{s.name}</span>
                </span>
                <span className="num">{s.pages}</span>
                <span className="num">{s.active}</span>
                <span className="num" style={s.overdue ? { color: 'var(--red)' } : undefined}>
                  {s.overdue}
                </span>
                <span className="c-wide">{s.mode ? <span className="tag">{s.mode === 'priority' ? 'Priority' : 'Maintain'}</span> : <span className="dim">None</span>}</span>
                <span className="c-wide">
                  <Meter v={s.satisfaction} />
                </span>
                <span className="areas c-wide">{areas.map((a) => a.name).join(', ') || 'No areas'}</span>
              </Link>
            );
          })}
        </section>
      </div>
    </>
  );
}
