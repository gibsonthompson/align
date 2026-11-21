import Link from 'next/link';
import { Orbit } from 'lucide-react';
import { getToday } from '@/lib/data';
import { sectorLookup } from '@/lib/sectors';
import { dueLabel, greeting, longToday } from '@/lib/format';
import type { AlignNode, ObjectRef } from '@/lib/types';
import TopBar from '@/components/TopBar';
import ObjectRow from '@/components/ObjectRow';
import EmptyState from '@/components/EmptyState';

export const dynamic = 'force-dynamic';

function asRef(n: AlignNode): ObjectRef {
  return { object_type: 'node', id: n.id, title: n.title, kind: n.type, sector_id: n.sector_id, status: n.status, slug: null };
}

function Due({ n }: { n: AlignNode }) {
  const d = dueLabel(n.due_date);
  return (
    <span className="row-end">
      {n.actionable && <span className="tag good">Ready</span>}
      {d && <span className={`tag ${d.tone === 'late' ? 'late' : d.tone === 'soon' ? 'soon' : ''}`}>{d.text}</span>}
    </span>
  );
}

export default async function TodayPage() {
  const t = await getToday();
  const lookup = sectorLookup(t.sectors);
  const coming = [...t.overdue, ...t.due];
  const nothing = !t.pinned.length && !t.recent.length && !coming.length && !t.objectives.length;

  return (
    <>
      <TopBar title="Today" />
      <div className="content">
        <div className="page-head">
          <div>
            <div className="eyebrow">{longToday()}</div>
            <h1 style={{ marginTop: 8 }}>{greeting()}, Gibson</h1>
          </div>
        </div>

        <div className="bal four" style={{ marginBottom: 18 }}>
          <a href="#coming" className="stat">
            <div className="stat-label">Overdue</div>
            <div className={`stat-value${t.overdue.length ? ' late' : ''}`}>{t.overdue.length}</div>
          </a>
          <a href="#coming" className="stat">
            <div className="stat-label">Due in 14 days</div>
            <div className="stat-value">{t.due.length}</div>
          </a>
          <a href="#quarter" className="stat">
            <div className="stat-label">Active 90-day objectives</div>
            <div className="stat-value">{t.objectives.length}</div>
          </a>
          <Link href="/search?status=inbox" className="stat">
            <div className="stat-label">Inbox</div>
            <div className="stat-value">{t.inbox}</div>
          </Link>
        </div>

        {nothing ? (
          <section className="panel">
            <EmptyState big Icon={Orbit} title="Start With A Sector" body="Open a sector, run the brain, and let it draft the five-year vision with you. Everything else builds down from there.">
              <Link href="/life" className="btn primary lg">
                Open Life
              </Link>
            </EmptyState>
          </section>
        ) : (
          <div className="two-col">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <section className="panel" id="coming">
                <div className="panel-head">
                  <h2 className="panel-title">
                    Coming Up <span className="count">{coming.length}</span>
                  </h2>
                  <span className="panel-note">Overdue and next 14 days</span>
                </div>
                {coming.length ? (
                  <div className="rows">
                    {coming.map((n) => (
                      <ObjectRow key={n.id} item={asRef(n)} sectors={lookup} end={<Due n={n} />} />
                    ))}
                  </div>
                ) : (
                  <EmptyState Icon={Orbit} title="Nothing Due" body="Pages with a due date in the next two weeks show up here." />
                )}
              </section>
              <section className="panel" id="quarter">
                <div className="panel-head">
                  <h2 className="panel-title">
                    This Quarter <span className="count">{t.objectives.length}</span>
                  </h2>
                  <span className="panel-note">Active 90-day objectives</span>
                </div>
                {t.objectives.length ? (
                  <div className="rows">
                    {t.objectives.map((n) => (
                      <ObjectRow key={n.id} item={asRef(n)} sectors={lookup} end={<Due n={n} />} />
                    ))}
                  </div>
                ) : (
                  <EmptyState Icon={Orbit} title="No Active Objectives" body="90-day objectives you mark active show up here." />
                )}
              </section>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">
                    Pinned <span className="count">{t.pinned.length}</span>
                  </h2>
                </div>
                {t.pinned.length ? (
                  <div className="rows">
                    {t.pinned.map((p) => (
                      <ObjectRow key={`${p.object_type}:${p.id}`} item={p} sectors={lookup} />
                    ))}
                  </div>
                ) : (
                  <EmptyState Icon={Orbit} title="Nothing Pinned" body="Pin any page to keep it one click away, however deep it is." />
                )}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Recently Viewed</h2>
                </div>
                {t.recent.length ? (
                  <div className="rows">
                    {t.recent.map((p) => (
                      <ObjectRow key={`${p.object_type}:${p.id}`} item={p} sectors={lookup} />
                    ))}
                  </div>
                ) : (
                  <EmptyState Icon={Orbit} title="Nothing Yet" body="Pages you open show up here." />
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
