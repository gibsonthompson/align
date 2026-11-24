'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, ChevronLeft, ChevronRight, GripVertical, ListChecks, PieChart } from 'lucide-react';
import { addDaysISO, dueLabel, mondayOf } from '@/lib/format';
import { duration } from '@/lib/tz';
import type { CalendarNode } from '@/lib/calendar';
import type { Sector } from '@/lib/types';
import type { SectorLookup } from '@/components/ObjectRow';
import EmptyState from '@/components/EmptyState';
import { DRAG_MIME, dayNum, monthTitle, SNAP, type CalBlock, type DragPage } from '@/components/calendar/shared';

export default function CalendarSide({
  anchor,
  today,
  from,
  to,
  blocks,
  toSchedule,
  sectors,
  lookup,
  onPick,
  onSchedule,
  onDragPage,
}: {
  anchor: string;
  today: string;
  from: string;
  to: string;
  blocks: CalBlock[];
  toSchedule: CalendarNode[];
  sectors: Sector[];
  lookup: SectorLookup;
  onPick: (date: string) => void;
  onSchedule: (n: CalendarNode) => void;
  onDragPage: (p: DragPage | null) => void;
}) {
  return (
    <aside className="cal-side">
      <MiniMonth anchor={anchor} today={today} from={from} to={to} blocks={blocks} onPick={onPick} />
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">
            To Schedule <span className="count">{toSchedule.length}</span>
          </h2>
          <span className="panel-note">Drag onto a time</span>
        </div>
        {toSchedule.length ? (
          <div className="ts-list">
            {toSchedule.map((n) => {
              const minutes = Math.min(Math.max(n.effort_minutes ?? 30, SNAP), 480);
              const due = n.status !== 'done' ? dueLabel(n.due_date) : null;
              return (
                <div
                  key={n.id}
                  className="ts-item"
                  draggable
                  style={{ ['--c' as string]: n.sector_id ? (lookup[n.sector_id]?.colour ?? '#8a8a8a') : '#8a8a8a' }}
                  onDragStart={(e) => {
                    const page: DragPage = { id: n.id, title: n.title, type: n.type, minutes };
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(page));
                    e.dataTransfer.effectAllowed = 'copyMove';
                    onDragPage(page);
                  }}
                  onDragEnd={() => onDragPage(null)}
                >
                  <GripVertical size={13} className="ts-grip" aria-hidden />
                  <div className="ts-main">
                    <Link href={`/n/${n.id}`} className="ts-title" draggable={false}>
                      {n.title}
                    </Link>
                    <span className="ts-sub">
                      <i className="swatch" aria-hidden />
                      <span className="mono">{duration(minutes)}</span>
                      {due && <span className={due.tone === 'late' ? 'late' : due.tone === 'soon' ? 'soon' : ''}>{due.text}</span>}
                      {n.part_of && <span className="ts-part">{n.part_of}</span>}
                    </span>
                  </div>
                  <button type="button" className="btn icon ghost" style={{ width: 28, height: 28 }} onClick={() => onSchedule(n)} aria-label={`Schedule ${n.title}`} title="Schedule">
                    <CalendarPlus size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState Icon={ListChecks} title="Nothing Waiting" body="Actions marked ready to do show up here until they have a time on the calendar." />
        )}
      </section>
      <Balance blocks={blocks} sectors={sectors} />
    </aside>
  );
}

function MiniMonth({ anchor, today, from, to, blocks, onPick }: { anchor: string; today: string; from: string; to: string; blocks: CalBlock[]; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(anchor.slice(0, 7));
  useEffect(() => setMonth(anchor.slice(0, 7)), [anchor]);
  const first = `${month}-01`;
  const start = mondayOf(first);
  const days = Array.from({ length: 42 }, (_, i) => addDaysISO(start, i));
  const busy = useMemo(() => new Set(blocks.map((b) => b.date)), [blocks]);
  const shift = (n: number) => {
    const d = new Date(`${first}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <section className="panel mini">
      <div className="mini-head">
        <b>{monthTitle(first)}</b>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="btn icon ghost" style={{ width: 26, height: 26 }} onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft size={14} />
          </button>
          <button type="button" className="btn icon ghost" style={{ width: 26, height: 26 }} onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="mini-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="mini-dow">
            {d}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className="mini-day"
            data-outside={d.slice(0, 7) !== month}
            data-today={d === today}
            data-in={d >= from && d <= to}
            data-busy={busy.has(d)}
            onClick={() => onPick(d)}
            aria-label={d}
          >
            {dayNum(d)}
          </button>
        ))}
      </div>
    </section>
  );
}

function Balance({ blocks, sectors }: { blocks: CalBlock[]; sectors: Sector[] }) {
  const rows = useMemo(() => {
    const top = (id: string | null) => {
      const s = sectors.find((x) => x.id === id);
      return s?.parent_id ? sectors.find((x) => x.id === s.parent_id) : s;
    };
    const m = new Map<string, { name: string; colour: string; planned: number; done: number }>();
    for (const b of blocks) {
      if (b.status === 'skipped') continue;
      const t = top(b.sector_id);
      const k = t?.id ?? 'none';
      const r = m.get(k) ?? { name: t?.name ?? 'Not linked to a sector', colour: t?.colour ?? '#5a5a62', planned: 0, done: 0 };
      r.planned += b.e - b.s;
      if (b.status === 'done') r.done += b.e - b.s;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.planned - a.planned);
  }, [blocks, sectors]);
  const total = rows.reduce((n, r) => n + r.planned, 0);
  const done = rows.reduce((n, r) => n + r.done, 0);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Time By Sector</h2>
        {total > 0 && (
          <span className="panel-note mono">
            {duration(done)} of {duration(total)} done
          </span>
        )}
      </div>
      {rows.length ? (
        <div className="bal-list">
          {rows.map((r) => (
            <div key={r.name} className="bal-row" style={{ ['--c' as string]: r.colour }}>
              <div className="bal-top">
                <span className="bal-name">
                  <i className="swatch" aria-hidden />
                  {r.name}
                </span>
                <span className="mono dim">{duration(r.planned)}</span>
              </div>
              <div className="bal-bar">
                <i style={{ width: `${(r.planned / total) * 100}%` }} />
                <b style={{ width: `${(r.done / total) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState Icon={PieChart} title="No Time Planned" body="Hours on the calendar add up here by sector, so you can see where the week is going." />
      )}
    </section>
  );
}
