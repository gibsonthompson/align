import Link from 'next/link';
import { ChevronRight, Orbit, Pin } from 'lucide-react';
import { getToday } from '@/lib/data';
import { sectorLookup } from '@/lib/sectors';
import { dueLabel, greeting, longToday } from '@/lib/format';
import type { AlignNode, ObjectRef, Sector } from '@/lib/types';
import TopBar from '@/components/TopBar';
import ObjectRow from '@/components/ObjectRow';
import EmptyState from '@/components/EmptyState';

export const dynamic = 'force-dynamic';

function asRef(n: AlignNode): ObjectRef {
  return { object_type: 'node', id: n.id, title: n.title, kind: n.type, sector_id: n.sector_id, status: n.status, slug: null };
}

function DueEnd({ iso }: { iso: string | null }) {
  const d = dueLabel(iso);
  return (
    <span className="row-end">
      {d && <span className={`pill compact ${d.tone === 'late' ? 'late' : d.tone === 'soon' ? 'soon' : ''}`}>{d.text}</span>}
      <ChevronRight size={17} />
    </span>
  );
}

export default async function TodayPage() {
  const t = await getToday();
  const lookup = sectorLookup(t.sectors);
  const nothing = !t.pinned.length && !t.recent.length && !t.due.length && !t.overdue.length && !t.objectives.length;

  return (
    <>
      <TopBar />
      <div className="greet">
        <div className="eyebrow">{longToday()}</div>
        <h1>{greeting()}, Gibson</h1>
      </div>

      <div className="stack">
        <div className="bal">
          <a href="#due" className="stat">
            <div className="stat-label">Overdue</div>
            <div className={`stat-value${t.overdue.length ? ' late' : ''}`}>{t.overdue.length}</div>
          </a>
          <a href="#due" className="stat">
            <div className="stat-label">Due In 14 Days</div>
            <div className="stat-value">{t.due.length}</div>
          </a>
          <a href="#objectives" className="stat">
            <div className="stat-label">Active 90-Day</div>
            <div className="stat-value">{t.objectives.length}</div>
          </a>
          <Link href="/search?status=inbox" className="stat">
            <div className="stat-label">Inbox</div>
            <div className="stat-value">{t.inbox}</div>
          </Link>
        </div>

        {nothing && (
          <section className="card">
            <EmptyState
              Icon={Orbit}
              title="Start With A Sector"
              body="Open Life, pick a part of your life, and write the five-year vision for it. Everything else builds down from there."
            >
              <Link href="/life" className="btn primary">
                Open Life
              </Link>
            </EmptyState>
          </section>
        )}

        {t.pinned.length > 0 && (
          <section className="card flush">
            <div className="section-head">
              <h2 className="section-title">
                <Pin size={16} /> Pinned
                <span className="count">{t.pinned.length}</span>
              </h2>
            </div>
            <div className="rows">
              {t.pinned.map((p) => (
                <ObjectRow key={`${p.object_type}:${p.id}`} item={p} sectors={lookup} />
              ))}
            </div>
          </section>
        )}

        {(t.overdue.length > 0 || t.due.length > 0) && (
          <section className="card flush" id="due">
            <div className="section-head">
              <h2 className="section-title">
                Coming Up
                <span className="count">{t.overdue.length + t.due.length}</span>
              </h2>
              <span className="section-note">Next 14 days</span>
            </div>
            <div className="rows">
              {[...t.overdue, ...t.due].map((n) => (
                <ObjectRow key={n.id} item={asRef(n)} sectors={lookup} end={<DueEnd iso={n.due_date} />} />
              ))}
            </div>
          </section>
        )}

        {t.objectives.length > 0 && (
          <section className="card flush" id="objectives">
            <div className="section-head">
              <h2 className="section-title">
                This Quarter
                <span className="count">{t.objectives.length}</span>
              </h2>
              <span className="section-note">Active 90-day objectives</span>
            </div>
            <div className="rows">
              {t.objectives.map((n) => (
                <ObjectRow key={n.id} item={asRef(n)} sectors={lookup} end={<DueEnd iso={n.due_date} />} />
              ))}
            </div>
          </section>
        )}

        {t.recent.length > 0 && (
          <section className="card flush">
            <div className="section-head">
              <h2 className="section-title">Recently Viewed</h2>
            </div>
            <div className="rows">
              {t.recent.map((p) => (
                <ObjectRow key={`${p.object_type}:${p.id}`} item={p} sectors={lookup} />
              ))}
            </div>
          </section>
        )}

        <SectorStrip sectors={t.sectors} />
      </div>
    </>
  );
}

function SectorStrip({ sectors }: { sectors: Sector[] }) {
  const tops = sectors.filter((s) => !s.parent_id);
  if (!tops.length) return null;
  return (
    <Link href="/life" className="card" style={{ display: 'block' }}>
      <div className="section-head" style={{ marginBottom: 12 }}>
        <h2 className="section-title">
          Your Life
          <span className="count">{tops.length} sectors</span>
        </h2>
        <ChevronRight size={18} style={{ color: 'var(--text-3)' }} />
      </div>
      <div className="sector-strip" aria-hidden>
        {tops.map((s) => (
          <span key={s.id} style={{ flex: 1, ['--c' as string]: s.colour }} />
        ))}
      </div>
    </Link>
  );
}
