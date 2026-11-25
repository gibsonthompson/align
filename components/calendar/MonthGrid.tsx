'use client';

import { useRef, useState } from 'react';
import BlockHover from '@/components/calendar/BlockHover';
import Link from 'next/link';
import { Clock3, Flag } from 'lucide-react';
import { clock } from '@/lib/tz';
import { titleCase } from '@/lib/format';
import type { CalendarNode } from '@/lib/calendar';
import type { SectorLookup } from '@/components/ObjectRow';
import { blockTitle, dayNum, DRAG_MIME, type CalBlock, type DragPage } from '@/components/calendar/shared';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Six weeks at a glance. Timed blocks, events and due pages per day; the rest
// folds into "+N more", which opens the day.
export default function MonthGrid({
  days,
  month,
  today,
  blocks,
  dueByDay,
  eventsByDay,
  lookup,
  onOpen,
  onOpenDay,
  onCreateOn,
  onDatePage,
  onDragPage,
}: {
  days: string[];
  month: string; // YYYY-MM of the month being shown
  today: string;
  blocks: CalBlock[];
  dueByDay: Map<string, CalendarNode[]>;
  eventsByDay: Map<string, CalendarNode[]>;
  lookup: SectorLookup;
  onOpen: (b: CalBlock) => void;
  onOpenDay: (date: string) => void;
  onCreateOn: (date: string) => void;
  onDatePage: (p: DragPage, date: string) => void;
  onDragPage: (p: DragPage | null) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const [card, setCard] = useState<{ b: CalBlock; rect: DOMRect } | null>(null);
  const timer = useRef<number | null>(null);
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setCard(null);
  };
  const byDay = new Map<string, CalBlock[]>();
  for (const b of blocks) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b]);
  const colour = (id: string | null) => (id ? (lookup[id]?.colour ?? '#8a8a8a') : '#8a8a8a');
  const LIMIT = 4;

  return (
    <div className="mg">
      {card && <BlockHover block={card.b} anchor={card.rect} lookup={lookup} movable={false} />}
      <div className="mg-head">
        {DOW.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mg-grid">
        {days.map((d) => {
          const ev = eventsByDay.get(d) ?? [];
          const timed = (byDay.get(d) ?? []).sort((a, b) => a.s - b.s);
          const due = dueByDay.get(d) ?? [];
          const items = [
            ...ev.map((n) => ({ key: `e:${n.id}`, el: <EventItem key={`e:${n.id}`} n={n} colour={colour(n.sector_id)} /> })),
            ...timed.map((b) => ({
              key: `b:${b.id}`,
              el: (
                <button
                  key={`b:${b.id}`}
                  type="button"
                  className="mg-item blk-line"
                  data-status={b.status}
                  style={{ ['--c' as string]: colour(b.sector_id) }}
                  onPointerEnter={(e) => {
                    if (e.pointerType !== 'mouse') return;
                    const el = e.currentTarget;
                    if (timer.current) window.clearTimeout(timer.current);
                    timer.current = window.setTimeout(() => setCard({ b, rect: el.getBoundingClientRect() }), 220);
                  }}
                  onPointerLeave={hide}
                  onClick={(e) => {
                    e.stopPropagation();
                    hide();
                    onOpen(b);
                  }}
                >
                  <i className="swatch" aria-hidden />
                  <span className="mono mg-time">{clock(b.s)}</span>
                  <span className="mg-title">{blockTitle(b)}</span>
                </button>
              ),
            })),
            ...due.map((n) => ({
              key: `d:${n.id}`,
              el: (
                <Link
                  key={`d:${n.id}`}
                  href={`/n/${n.id}`}
                  className="mg-item due"
                  data-done={n.status === 'done'}
                  style={{ ['--c' as string]: colour(n.sector_id) }}
                  onClick={(e) => e.stopPropagation()}
                  title={`${n.title}${n.part_of ? ` · ${n.part_of}` : ''}`}
                >
                  {n.scheduled ? <Clock3 size={10} /> : <i className="ring" aria-hidden />}
                  <span className="mg-title">{titleCase(n.title)}</span>
                </Link>
              ),
            })),
          ];
          const outside = d.slice(0, 7) !== month;
          return (
            <div
              key={d}
              className="mg-cell"
              data-outside={outside}
              data-today={d === today}
              data-over={over === d}
              onClick={() => onCreateOn(d)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== d) setOver(d);
              }}
              onDragLeave={(e) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => {
                setOver(null);
                onDragPage(null);
                const raw = e.dataTransfer.getData(DRAG_MIME);
                if (!raw) return;
                e.preventDefault();
                try {
                  onDatePage(JSON.parse(raw) as DragPage, d);
                } catch {}
              }}
            >
              <div className="mg-date">
                <button
                  type="button"
                  className="mg-num"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDay(d);
                  }}
                  aria-label={`Open ${d}`}
                >
                  {dayNum(d) === 1 ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : dayNum(d)}
                </button>
              </div>
              <div className="mg-items">
                {items.slice(0, LIMIT).map((i) => i.el)}
                {items.length > LIMIT && (
                  <button
                    type="button"
                    className="mg-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDay(d);
                    }}
                  >
                    +{items.length - LIMIT} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventItem({ n, colour }: { n: CalendarNode; colour: string }) {
  return (
    <Link href={`/n/${n.id}`} className="mg-item event" style={{ ['--c' as string]: colour }} onClick={(e) => e.stopPropagation()} title={`${n.title}${n.location ? ` · ${n.location}` : ''}`}>
      <Flag size={10} />
      <span className="mg-title">{titleCase(n.title)}</span>
    </Link>
  );
}
