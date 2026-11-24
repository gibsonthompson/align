'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Clock3, Flag } from 'lucide-react';
import { clock, duration } from '@/lib/tz';
import type { CalendarNode } from '@/lib/calendar';
import type { SectorLookup } from '@/components/ObjectRow';
import {
  blockTitle,
  clamp,
  DAY_MIN,
  dayNum,
  DRAG_MIME,
  layoutDay,
  SNAP,
  snapDown,
  snapNear,
  weekdayShort,
  type CalBlock,
  type DragPage,
} from '@/components/calendar/shared';

type Preview = { mode: 'create' | 'move' | 'resize'; id?: string; date: string; s: number; e: number } | null;

export interface TimeGridProps {
  days: string[];
  today: string;
  nowMin: number;
  blocks: CalBlock[];
  dueByDay: Map<string, CalendarNode[]>;
  eventsByDay: Map<string, CalendarNode[]>;
  lookup: SectorLookup;
  hourPx: number;
  quarters: boolean; // label every 15 minutes (day view)
  dragPage: DragPage | null;
  busyIds: Set<string>;
  onCreate: (r: { date: string; start: number; end: number }) => void;
  onOpen: (b: CalBlock) => void;
  onChange: (b: CalBlock, to: { date: string; start: number; end: number }) => void;
  onToggleDone: (b: CalBlock) => void;
  onDropPage: (p: DragPage, date: string, start: number) => void;
  onOpenDay: (date: string) => void;
  onDragPage: (p: DragPage | null) => void;
}

export default function TimeGrid(props: TimeGridProps) {
  const { days, today, nowMin, blocks, dueByDay, eventsByDay, lookup, hourPx, quarters, dragPage, busyIds } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [hover, setHover] = useState<{ date: string; min: number } | null>(null);
  const [dropAt, setDropAt] = useState<{ date: string; s: number; e: number } | null>(null);
  const dragging = useRef(false);
  const single = days.length === 1;
  const height = (DAY_MIN / 60) * hourPx;
  const px = (min: number) => (min / 60) * hourPx;

  // Start the view at the current hour (today) or at 7 AM, once per set of days.
  const key = days.join(',');
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focus = days.includes(today) ? Math.max(0, nowMin - 90) : 7 * 60;
    el.scrollTop = px(focus);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => {
    const m = new Map<string, CalBlock[]>();
    for (const d of days) m.set(d, []);
    for (const b of blocks) m.get(b.date)?.push(b);
    return m;
  }, [blocks, days]);

  const layouts = useMemo(() => {
    const m = new Map<string, { col: number; cols: number; span: number }>();
    for (const list of byDay.values()) for (const [k, v] of layoutDay(list)) m.set(k, v);
    return m;
  }, [byDay]);

  function locate(x: number, y: number) {
    const r = colsRef.current!.getBoundingClientRect();
    const w = r.width / days.length;
    const i = clamp(Math.floor((x - r.left) / w), 0, days.length - 1);
    return { date: days[i], min: clamp(((y - r.top) / hourPx) * 60, 0, DAY_MIN) };
  }

  // Keeps a drag going when the pointer reaches the top or bottom edge.
  function autoScroll(y: number) {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (y < r.top + 36) el.scrollTop -= 14;
    else if (y > r.bottom - 36) el.scrollTop += 14;
  }

  function startCreate(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.blk')) return;
    e.preventDefault();
    const p = locate(e.clientX, e.clientY);
    const anchor = Math.min(snapDown(p.min), DAY_MIN - SNAP);
    let moved = false;
    let cur = { date: p.date, s: anchor, e: anchor + SNAP };
    dragging.current = true;
    setHover(null);
    setPreview({ mode: 'create', ...cur });
    const move = (ev: PointerEvent) => {
      autoScroll(ev.clientY);
      const q = locate(ev.clientX, ev.clientY);
      const at = Math.min(snapDown(q.min), DAY_MIN - SNAP);
      if (at !== anchor) moved = true;
      cur = { date: p.date, s: Math.min(anchor, at), e: Math.max(anchor, at) + SNAP };
      setPreview({ mode: 'create', ...cur });
    };
    const end = (ev: PointerEvent) => {
      cleanup();
      setPreview(null);
      if (ev.type === 'pointercancel') return;
      // A plain click makes a 30 minute block.
      const e2 = moved ? cur.e : Math.min(cur.s + 30, DAY_MIN);
      props.onCreate({ date: cur.date, start: cur.s, end: e2 });
    };
    const cleanup = () => {
      dragging.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function startMove(e: React.PointerEvent, b: CalBlock, mode: 'move' | 'resize') {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (b.clipped || busyIds.has(b.id)) {
      if (mode === 'move') {
        const up = () => {
          window.removeEventListener('pointerup', up);
          props.onOpen(b);
        };
        window.addEventListener('pointerup', up);
      }
      return;
    }
    e.preventDefault();
    const p = locate(e.clientX, e.clientY);
    const offset = p.min - b.s;
    const len = b.e - b.s;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let cur = { date: b.date, s: b.s, e: b.e };
    dragging.current = true;
    setHover(null);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      autoScroll(ev.clientY);
      const q = locate(ev.clientX, ev.clientY);
      if (mode === 'move') {
        const s = clamp(snapNear(q.min - offset), 0, DAY_MIN - len);
        cur = { date: q.date, s, e: s + len };
      } else {
        cur = { date: b.date, s: b.s, e: clamp(snapNear(q.min), b.s + SNAP, DAY_MIN) };
      }
      setPreview({ mode, id: b.id, ...cur });
    };
    const end = (ev: PointerEvent) => {
      dragging.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setPreview(null);
      if (ev.type === 'pointercancel') return;
      if (!moved) {
        if (mode === 'move') props.onOpen(b);
        return;
      }
      if (cur.date !== b.date || cur.s !== b.s || cur.e !== b.e) props.onChange(b, { date: cur.date, start: cur.s, end: cur.e });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function onHover(e: React.PointerEvent) {
    if (dragging.current || e.pointerType !== 'mouse') return;
    if ((e.target as HTMLElement).closest('.blk')) return setHover(null);
    const p = locate(e.clientX, e.clientY);
    const min = Math.min(snapDown(p.min), DAY_MIN - SNAP);
    if (!hover || hover.date !== p.date || hover.min !== min) setHover({ date: p.date, min });
  }

  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    autoScroll(e.clientY);
    const p = locate(e.clientX, e.clientY);
    const len = dragPage?.minutes ?? 30;
    const s = clamp(snapDown(p.min), 0, DAY_MIN - len);
    if (!dropAt || dropAt.date !== p.date || dropAt.s !== s) setDropAt({ date: p.date, s, e: s + len });
  }

  function onDrop(e: React.DragEvent) {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    setDropAt(null);
    props.onDragPage(null);
    if (!raw) return;
    e.preventDefault();
    try {
      const page = JSON.parse(raw) as { id: string; title: string; type: string; minutes: number };
      const p = locate(e.clientX, e.clientY);
      const s = clamp(snapDown(p.min), 0, DAY_MIN - page.minutes);
      props.onDropPage(page, p.date, s);
    } catch {}
  }

  const gridBg = {
    backgroundImage: [
      `linear-gradient(to bottom, var(--line) 1px, transparent 1px)`,
      `linear-gradient(to bottom, var(--cal-half) 1px, transparent 1px)`,
      ...(quarters ? [`linear-gradient(to bottom, var(--cal-quarter) 1px, transparent 1px)`] : []),
    ].join(','),
    backgroundSize: [`100% ${hourPx}px`, `100% ${hourPx / 2}px`, ...(quarters ? [`100% ${hourPx / 4}px`] : [])].join(','),
  } as React.CSSProperties;

  const planned = (d: string) => (byDay.get(d) ?? []).filter((b) => b.status !== 'skipped').reduce((m, b) => m + (b.e - b.s), 0);

  return (
    <div className="tg" style={{ ['--cols' as string]: days.length }}>
      <div className="tg-head">
        <div className="tg-gutter" />
        {days.map((d) => {
          const mins = planned(d);
          return (
            <button
              key={d}
              type="button"
              className="tg-day"
              data-today={d === today}
              onClick={() => !single && props.onOpenDay(d)}
              aria-label={single ? undefined : `Open ${d} in the day view`}
              disabled={single}
            >
              <span className="tg-dow">{weekdayShort(d)}</span>
              <span className="tg-num">{dayNum(d)}</span>
              {mins > 0 && <span className="tg-load mono">{duration(mins)}</span>}
            </button>
          );
        })}
      </div>

      <div className="tg-allday">
        <div className="tg-gutter tg-allday-label">All day</div>
        {days.map((d) => {
          const ev = eventsByDay.get(d) ?? [];
          const due = dueByDay.get(d) ?? [];
          const limit = single ? 99 : 3;
          const all = [...ev.map((n) => ({ n, kind: 'event' as const })), ...due.map((n) => ({ n, kind: 'due' as const }))];
          return (
            <div key={d} className="tg-allday-cell" data-today={d === today}>
              {all.slice(0, limit).map(({ n, kind }) => (
                <Link
                  key={`${kind}:${n.id}`}
                  href={`/n/${n.id}`}
                  className={`chip ${kind}`}
                  data-done={n.status === 'done'}
                  data-scheduled={kind === 'due' && n.scheduled}
                  style={{ ['--c' as string]: n.sector_id ? (lookup[n.sector_id]?.colour ?? '#8a8a8a') : '#8a8a8a' }}
                  title={kind === 'event' ? `${n.title}${n.location ? ` · ${n.location}` : ''}` : `${n.title}${n.part_of ? ` · ${n.part_of}` : ''}${n.scheduled ? ' · on the calendar' : ' · drag onto a time to schedule it'}`}
                  draggable={kind === 'due' && n.status !== 'done'}
                  onDragStart={(e) => {
                    const page: DragPage = { id: n.id, title: n.title, type: n.type, minutes: Math.min(Math.max(n.effort_minutes ?? 30, SNAP), 480) };
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(page));
                    e.dataTransfer.effectAllowed = 'copy';
                    props.onDragPage(page);
                  }}
                  onDragEnd={() => props.onDragPage(null)}
                >
                  {kind === 'event' ? <Flag size={10} /> : n.scheduled ? <Clock3 size={10} /> : <i className="swatch" aria-hidden />}
                  <span>{n.title}</span>
                </Link>
              ))}
              {all.length > limit && (
                <button type="button" className="chip more" onClick={() => props.onOpenDay(d)}>
                  +{all.length - limit} more
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ height }}>
          <div className="tg-gutter tg-hours" aria-hidden>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="tg-hour" style={{ top: px(h * 60) }}>
                {h > 0 && <span>{clock(h * 60, true).replace(/a$/, ' AM').replace(/p$/, ' PM')}</span>}
                {quarters &&
                  [15, 30, 45].map((q) => (
                    <span key={q} className="tg-quarter" style={{ top: px(q) }}>
                      :{q}
                    </span>
                  ))}
              </div>
            ))}
          </div>
          <div className="tg-cols" ref={colsRef} onPointerLeave={() => setHover(null)}>
            {days.map((d) => {
              const list = byDay.get(d) ?? [];
              return (
                <div
                  key={d}
                  className="tg-col"
                  data-today={d === today}
                  style={gridBg}
                  onPointerDown={startCreate}
                  onPointerMove={onHover}
                  onDragOver={onDragOver}
                  onDragLeave={(e) => {
                    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropAt(null);
                  }}
                  onDrop={onDrop}
                >
                  {hover?.date === d && !preview && (
                    <div className="tg-hover" style={{ top: px(hover.min), height: px(SNAP) }}>
                      <span>{clock(hover.min)}</span>
                    </div>
                  )}
                  {list.map((b) => {
                    const pos = layouts.get(`${b.id}:${b.date}`) ?? { col: 0, cols: 1, span: 1 };
                    const moving = preview?.id === b.id;
                    const colour = b.sector_id ? (lookup[b.sector_id]?.colour ?? '#8a8a8a') : '#8a8a8a';
                    const h = px(b.e - b.s);
                    // Overlaps cascade: each block reaches past its own column and later ones sit on top.
                    const last = pos.col + pos.span >= pos.cols;
                    const reach = pos.cols > 1 && !last ? Math.min(pos.span * 1.7, pos.cols - pos.col) : pos.span;
                    return (
                      <div
                        key={`${b.id}:${b.date}`}
                        className="blk"
                        data-status={b.status}
                        data-ghosted={moving}
                        data-short={h < 26}
                        data-busy={busyIds.has(b.id)}
                        style={{
                          top: px(b.s),
                          height: Math.max(h - 2, 10),
                          left: `calc(${(pos.col / pos.cols) * 100}% + 2px)`,
                          width: `calc(${(100 * reach) / pos.cols}% - 4px)`,
                          zIndex: 2 + pos.col,
                          ['--c' as string]: colour,
                        }}
                        onPointerDown={(e) => startMove(e, b, 'move')}
                        role="button"
                        tabIndex={0}
                        aria-label={`${blockTitle(b)}, ${clock(b.s)} to ${clock(b.e)}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            props.onOpen(b);
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="blk-check"
                          aria-label={b.status === 'done' ? 'Mark not done' : 'Mark done'}
                          aria-pressed={b.status === 'done'}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onToggleDone(b);
                          }}
                        >
                          <Check size={10} strokeWidth={3.4} />
                        </button>
                        <div className="blk-text">
                          <span className="blk-title">{blockTitle(b)}</span>
                          <span className="blk-time mono">
                            {clock(b.s, true)} to {clock(b.e, true)}
                          </span>
                        </div>
                        {/* Short blocks are all handle otherwise; resize those from the editor. */}
                        {!b.clipped && h >= 22 && <div className="blk-resize" onPointerDown={(e) => startMove(e, b, 'resize')} aria-hidden />}
                      </div>
                    );
                  })}
                  {preview && preview.date === d && (
                    <div className="blk preview" data-mode={preview.mode} style={{ top: px(preview.s), height: Math.max(px(preview.e - preview.s) - 2, 10), left: 2, right: 2 }}>
                      <div className="blk-text">
                        <span className="blk-title">
                          {preview.id ? blockTitle(blocks.find((b) => b.id === preview.id) ?? { title: '', node: null }) : 'New block'}
                        </span>
                        <span className="blk-time mono">
                          {clock(preview.s, true)} to {clock(preview.e, true)} · {duration(preview.e - preview.s)}
                        </span>
                      </div>
                    </div>
                  )}
                  {dropAt && dropAt.date === d && (
                    <div className="blk preview" data-mode="drop" style={{ top: px(dropAt.s), height: Math.max(px(dropAt.e - dropAt.s) - 2, 10), left: 2, right: 2 }}>
                      <div className="blk-text">
                        <span className="blk-title">{dragPage?.title ?? 'Drop to schedule'}</span>
                        <span className="blk-time mono">
                          {clock(dropAt.s, true)} to {clock(dropAt.e, true)}
                        </span>
                      </div>
                    </div>
                  )}
                  {d === today && (
                    <div className="tg-now" style={{ top: px(nowMin) }} aria-hidden>
                      <i />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Keeps the red line on the current minute.
export function useNowMinute(initial: number): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const tick = () => {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
      const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0);
      const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
      setNow(h * 60 + m);
    };
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}
