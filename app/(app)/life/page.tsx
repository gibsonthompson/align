import Link from 'next/link';
import { getLifeOverview } from '@/lib/data';
import { sectorIcon } from '@/lib/kinds';
import TopBar from '@/components/TopBar';

export const dynamic = 'force-dynamic';

export default async function LifePage() {
  const sectors = await getLifeOverview();
  const priorities = sectors.filter((s) => s.mode === 'priority').length;

  return (
    <>
      <TopBar title="Life" />
      <p className="muted" style={{ margin: '-2px 2px 16px', fontWeight: 600, fontSize: 14.5 }}>
        {sectors.length} sectors
        {priorities > 0 ? `, ${priorities} marked as a current priority` : ''}. Open one to see its vision, goals and everything under them.
      </p>
      <div className="bal three">
        {sectors.map((s) => {
          const Icon = sectorIcon(s.icon);
          return (
            <Link key={s.id} href={`/s/${s.slug}`} className="sector-card" style={{ ['--c' as string]: s.colour }}>
              <span className="icon" aria-hidden>
                <Icon size={21} strokeWidth={2.3} />
              </span>
              {s.mode && <span className="pill mode">{s.mode === 'priority' ? 'Priority' : 'Maintain'}</span>}
              <h3>{s.name}</h3>
              <span className="stats">
                <span>
                  <b>{s.pages}</b> {s.pages === 1 ? 'page' : 'pages'}
                </span>
                <span>
                  <b>{s.areas}</b> {s.areas === 1 ? 'area' : 'areas'}
                </span>
                {s.overdue > 0 && (
                  <span style={{ color: 'var(--red)' }}>
                    <b style={{ color: 'inherit' }}>{s.overdue}</b> overdue
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
