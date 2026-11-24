'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2, Plus, Repeat } from 'lucide-react';
import { createBlock, deleteBlock, placeHabits, updateBlock, updateNode } from '@/app/actions';
import { addDaysISO } from '@/lib/format';
import { clock, duration, nowZoned, zonedToUtc } from '@/lib/tz';
import { sectorLookup } from '@/lib/sectors';
import type { CalendarData, CalendarNode, CalendarView } from '@/lib/calendar';
import type { Block, NodeType } from '@/lib/types';
import TimeGrid, { useNowMinute } from '@/components/calendar/TimeGrid';
import MenuButton from '@/components/MenuButton';
import MonthGrid from '@/components/calendar/MonthGrid';
import CalendarSide from '@/components/calendar/CalendarSide';
import BlockSheet from '@/components/calendar/BlockSheet';
import {
  DAY_MIN,
  VIEW_END,
  VIEW_START,
  daysBetween,
  longDate,
  monthTitle,
  placeBlocks,
  rangeTitle,
  SNAP,
  weekdayShort,
  wallTime,
  type CalBlock,
  type Draft,
  type DragPage,
} from '@/components/calendar/shared';

const VIEWS: { value: CalendarView; label: string; key: string }[] = [
  { value: 'day', label: 'Day', key: 'D' },
  { value: 'week', label: 'Week', key: 'W' },
  { value: 'month', label: 'Month', key: 'M' },
];

type Toast = { text: string; undo?: () => void; tone?: 'error' } | null;

export default function Calendar({ data, explicitView, scheduleNode }: { data: CalendarData; explicitView: boolean; scheduleNode: CalendarNode | null }) {
  const router = useRouter();
  const { view, anchor, today, from, to } = data;
  const [blocks, setBlocks] = useState<Block[]>(data.blocks);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dragPage, setDragPage] = useState<DragPage | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast>(null);
  const [placing, setPlacing] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const nowMin = useNowMinute(nowZoned().minutes);

  useEffect(() => setBlocks(data.blocks), [data.blocks]);

  const lookup = useMemo(() => sectorLookup(data.sectors), [data.sectors]);
  const days = useMemo(() => daysBetween(from, to), [from, to]);
  const placed = useMemo(() => placeBlocks(blocks, days), [blocks, days]);
  const dueByDay = useMemo(() => groupBy(data.due, (n) => n.due_date), [data.due]);
  const eventsByDay = useMemo(() => groupBy(data.events, (n) => n.event_date), [data.events]);

  const go = useCallback((v: CalendarView, d: string, replace = false) => {
    const url = `/calendar?view=${v}&date=${d}`;
    if (replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }, [router]);

  // Phones open on the day view unless a view was asked for.
  useEffect(() => {
    if (!explicitView && window.innerWidth < 760 && view !== 'day') go('day', anchor, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function shift(dir: 1 | -1) {
    if (view === 'day') return go(view, addDaysISO(anchor, dir));
    if (view === 'week') return go(view, addDaysISO(anchor, dir * 7));
    const d = new Date(`${anchor.slice(0, 8)}01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + dir);
    go(view, d.toISOString().slice(0, 10));
  }

  function say(t: Toast, ms = 5000) {
    setToast(t);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }

  const markBusy = (id: string, on: boolean) =>
    setBusy((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  // Next open slot on a day, from a starting minute, for something this long.
  function freeSlot(date: string, len: number, fromMin: number): number {
    const taken = placeBlocks(blocks, [date]).filter((b) => b.status !== 'skipped');
    const first = Math.max(VIEW_START, Math.ceil(fromMin / SNAP) * SNAP);
    for (let m = first; m + len <= VIEW_END; m += SNAP) {
      if (!taken.some((b) => m < b.e && m + len > b.s)) return m;
    }
    return Math.min(first, VIEW_END - len);
  }

  function scheduleDraft(n: Pick<CalendarNode, 'id' | 'title' | 'type' | 'effort_minutes'>, date?: string) {
    const len = Math.min(Math.max(n.effort_minutes ?? 30, SNAP), 480);
    const day = date ?? (view === 'day' ? anchor : today >= from && today <= to ? today : from);
    const startFrom = day === today ? Math.max(nowMin + 5, 6 * 60) : 9 * 60;
    const start = freeSlot(day, len, startFrom);
    setDraft({ nodeId: n.id, nodeTitle: n.title, nodeType: n.type, title: '', notes: '', date: day, start, end: Math.min(start + len, DAY_MIN), status: 'planned', sectorId: null });
  }

  // Opened from a page's "Schedule It" button.
  const opened = useRef(false);
  useEffect(() => {
    if (scheduleNode && !opened.current) {
      opened.current = true;
      scheduleDraft(scheduleNode, anchor);
      router.replace(`/calendar?view=${view}&date=${anchor}`, { scroll: false });
    }
  }, [scheduleNode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: D W M switch views, T jumps to today, arrows move, N adds a block.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (draft || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, [contenteditable="true"], [role="listbox"], .switcher')) return;
      const k = e.key.toLowerCase();
      if (k === 'd') go('day', anchor);
      else if (k === 'w') go('week', anchor);
      else if (k === 'm') go('month', anchor);
      else if (k === 't') go(view, today);
      else if (e.key === 'ArrowLeft') shift(-1);
      else if (e.key === 'ArrowRight') shift(1);
      else if (k === 'n') {
        const day = view === 'day' ? anchor : today >= from && today <= to ? today : from;
        const start = freeSlot(day, 30, day === today ? nowMin + 5 : 9 * 60);
        setDraft({ nodeId: null, title: '', notes: '', date: day, start, end: start + 30, status: 'planned', sectorId: null });
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function asIso(date: string, start: number, end: number) {
    return { start_at: zonedToUtc(date, start).toISOString(), end_at: zonedToUtc(date, end).toISOString() };
  }

  async function move(b: CalBlock, to: { date: string; start: number; end: number }) {
    const before = blocks.find((x) => x.id === b.id);
    if (!before) return;
    setBlocks((list) => list.map((x) => (x.id === b.id ? { ...x, ...asIso(to.date, to.start, to.end) } : x)));
    markBusy(b.id, true);
    const res = await updateBlock(b.id, to);
    markBusy(b.id, false);
    if (!res.ok) {
      setBlocks((list) => list.map((x) => (x.id === b.id ? before : x)));
      return say({ text: res.error, tone: 'error' });
    }
    const back = { date: b.date, start: b.s, end: b.e };
    say({
      text: `${to.date === b.date ? 'Moved to' : `Moved to ${weekdayShort(to.date)}`} ${clock(to.start)} to ${clock(to.end)}`,
      undo: () => move({ ...b, ...asIso(to.date, to.start, to.end), date: to.date, s: to.start, e: to.end }, back),
    });
  }

  async function toggleDone(b: CalBlock) {
    const next = b.status === 'done' ? 'planned' : 'done';
    setBlocks((list) => list.map((x) => (x.id === b.id ? { ...x, status: next } : x)));
    const res = await updateBlock(b.id, { status: next });
    if (!res.ok) {
      setBlocks((list) => list.map((x) => (x.id === b.id ? { ...x, status: b.status } : x)));
      return say({ text: res.error, tone: 'error' });
    }
    router.refresh();
  }

  async function dropPage(p: DragPage, date: string, start: number) {
    const end = Math.min(start + p.minutes, DAY_MIN);
    const tmp: Block = {
      id: `tmp-${Date.now()}`,
      node_id: p.id,
      sector_id: data.toSchedule.find((n) => n.id === p.id)?.sector_id ?? data.due.find((n) => n.id === p.id)?.sector_id ?? null,
      title: '',
      notes: '',
      status: 'planned',
      source: 'align',
      ...asIso(date, start, end),
      node: { id: p.id, title: p.title, type: p.type as NodeType, status: 'active', effort_minutes: p.minutes, done_criteria: '' },
    };
    setBlocks((list) => [...list, tmp]);
    markBusy(tmp.id, true);
    const res = await createBlock({ nodeId: p.id, date, start, end });
    markBusy(tmp.id, false);
    if (!res.ok || !res.data) {
      setBlocks((list) => list.filter((x) => x.id !== tmp.id));
      return say({ text: res.ok ? 'Could not schedule it.' : res.error, tone: 'error' });
    }
    const real = { ...res.data.block, node: tmp.node };
    setBlocks((list) => list.map((x) => (x.id === tmp.id ? real : x)));
    say({ text: `Scheduled ${weekdayShort(date)} ${clock(start)}`, undo: () => remove(real.id, true) });
    router.refresh();
  }

  async function datePage(p: DragPage, date: string) {
    const res = await updateNode(p.id, { due_date: date });
    if (!res.ok) return say({ text: res.error, tone: 'error' });
    say({ text: `"${p.title}" is now due ${weekdayShort(date)} ${Number(date.slice(8))}` });
    router.refresh();
  }

  async function save(d: Draft): Promise<string | null> {
    if (d.id) {
      const res = await updateBlock(d.id, { title: d.title, notes: d.notes, nodeId: d.nodeId, sectorId: d.nodeId ? undefined : d.sectorId, sectorAuto: d.sectorAuto, date: d.date, start: d.start, end: d.end, status: d.status });
      if (!res.ok) return res.error;
      const node = d.nodeId ? { id: d.nodeId, title: d.nodeTitle ?? '', type: (d.nodeType ?? 'action') as NodeType, status: 'active' as const, effort_minutes: null, done_criteria: '' } : null;
      setBlocks((list) => list.map((x) => (x.id === d.id ? { ...res.data!.block, node } : x)));
    } else {
      const res = await createBlock({ nodeId: d.nodeId, sectorId: d.nodeId ? null : d.sectorId, sectorAuto: d.sectorAuto, title: d.title, notes: d.notes, date: d.date, start: d.start, end: d.end });
      if (!res.ok) return res.error;
      const node = d.nodeId ? { id: d.nodeId, title: d.nodeTitle ?? '', type: (d.nodeType ?? 'action') as NodeType, status: 'active' as const, effort_minutes: null, done_criteria: '' } : null;
      setBlocks((list) => [...list, { ...res.data!.block, node }]);
      if (!days.includes(d.date)) say({ text: `Added for ${longDate(d.date)}` });
    }
    setDraft(null);
    router.refresh();
    return null;
  }

  async function remove(id: string, quiet = false): Promise<string | null> {
    const before = blocks.find((x) => x.id === id);
    setBlocks((list) => list.filter((x) => x.id !== id));
    const res = await deleteBlock(id);
    if (!res.ok) {
      if (before) setBlocks((list) => [...list, before]);
      return res.error;
    }
    setDraft(null);
    if (!quiet && before) {
      const p = wallTime(before);
      say({
        text: 'Removed from the calendar',
        undo: p
          ? async () => {
              const r = await createBlock({ nodeId: before.node_id, sectorId: before.sector_id, title: before.title, notes: before.notes, date: p.date, start: p.s, end: p.e, status: before.status });
              if (r.ok && r.data) setBlocks((list) => [...list, { ...r.data!.block, node: before.node }]);
              router.refresh();
            }
          : undefined,
      });
    }
    router.refresh();
    return null;
  }

  function openBlock(b: CalBlock) {
    if (b.id.startsWith('tmp-')) return;
    setDraft({
      id: b.id,
      nodeId: b.node_id,
      nodeTitle: b.node?.title,
      nodeType: b.node?.type,
      title: b.title,
      notes: b.notes,
      date: b.date,
      start: b.s,
      end: b.e,
      status: b.status,
      sectorId: b.sector_id,
      sectorAuto: Boolean(b.sector_auto),
    });
  }

  const title = view === 'day' ? longDate(anchor) : view === 'week' ? rangeTitle(from, to) : monthTitle(anchor);
  const shortTitle =
    view === 'day'
      ? new Date(`${anchor}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      : view === 'week'
        ? rangeTitle(from, to).replace(/, \d{4}$/, '')
        : new Date(`${anchor}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const inRange = view === 'month' ? placed.filter((b) => b.date.slice(0, 7) === anchor.slice(0, 7)) : placed;
  const plannedMin = inRange.filter((b) => b.status !== 'skipped').reduce((n, b) => n + (b.e - b.s), 0);
  const isCurrent = today >= (view === 'month' ? `${anchor.slice(0, 8)}01` : from) && today <= to && (view !== 'month' || today.slice(0, 7) === anchor.slice(0, 7));
  const periods = data.periods.filter((p) => p.status !== 'done' || view !== 'day');

  return (
    <>
      {/* The calendar's controls live in the top bar, so the grid gets the height. */}
      <header className="top cal-top">
        <MenuButton />
        <div className="cal-nav">
          <button type="button" className="btn" onClick={() => go(view, today)} disabled={isCurrent} title="Today (T)">
            Today
          </button>
          <div className="cal-arrows">
            <button type="button" className="btn icon" onClick={() => shift(-1)} aria-label={`Previous ${view}`} title="Previous (Left arrow)">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="btn icon" onClick={() => shift(1)} aria-label={`Next ${view}`} title="Next (Right arrow)">
              <ChevronRight size={16} />
            </button>
          </div>
          <h1 className="cal-title">
            <span className="cal-title-long">{title}</span>
            <span className="cal-title-short">{shortTitle}</span>
          </h1>
          {plannedMin > 0 && (
            <span className="tag" title="Time planned in this view">
              {duration(plannedMin)} planned
            </span>
          )}
        </div>
        <div className="cal-tools top-actions">
          <div className="segmented cal-views" role="group" aria-label="Calendar view">
            {VIEWS.map((v) => (
              <button key={v.value} type="button" aria-pressed={view === v.value} onClick={() => go(v.value, anchor)} title={`${v.label} (${v.key})`}>
                {v.label}
              </button>
            ))}
          </div>
          {view !== 'month' && to >= today && (
            <button
              type="button"
              className="btn"
              disabled={placing}
              title="Put this week's habit sessions into free time"
              onClick={async () => {
                setPlacing(true);
                const res = await placeHabits(anchor);
                setPlacing(false);
                if (!res.ok) return say({ text: res.error, tone: 'error' });
                const n = res.data?.placed.length ?? 0;
                const miss = res.data?.skipped.filter((s) => s.reason.startsWith('No free')).length ?? 0;
                say({ text: n ? `Placed ${n} habit ${n === 1 ? 'session' : 'sessions'}${miss ? `, ${miss} could not fit` : ''}` : miss ? `${miss} habit ${miss === 1 ? 'session' : 'sessions'} could not fit` : 'Habits are already on track or booked this week' });
                router.refresh();
              }}
            >
              {placing ? <Loader2 size={14} className="spin" /> : <Repeat size={14} />} Place Habits
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const day = view === 'day' ? anchor : today >= from && today <= to ? today : from;
              const start = freeSlot(day, 30, day === today ? nowMin + 5 : 9 * 60);
              setDraft({ nodeId: null, title: '', notes: '', date: day, start, end: start + 30, status: 'planned', sectorId: null });
            }}
            title="New block (N)"
          >
            <Plus size={14} /> New Block
          </button>
        </div>
      </header>
      <div className="content cal-content">
    <div className="cal">
      <div className="cal-wrap">
        <div className="cal-main">
          {view === 'month' ? (
            <MonthGrid
              days={days}
              month={anchor.slice(0, 7)}
              today={today}
              blocks={placed}
              dueByDay={dueByDay}
              eventsByDay={eventsByDay}
              lookup={lookup}
              onOpen={openBlock}
              onOpenDay={(d) => go('day', d)}
              onCreateOn={(d) => {
                const start = freeSlot(d, 30, d === today ? nowMin + 5 : 9 * 60);
                setDraft({ nodeId: null, title: '', notes: '', date: d, start, end: start + 30, status: 'planned', sectorId: null });
              }}
              onDatePage={datePage}
              onDragPage={setDragPage}
            />
          ) : (
            <TimeGrid
              days={days}
              today={today}
              nowMin={nowMin}
              blocks={placed}
              dueByDay={dueByDay}
              eventsByDay={eventsByDay}
              lookup={lookup}
              minHourPx={view === 'day' ? 30 : 26}
              quarters={view === 'day'}
              dragPage={dragPage}
              busyIds={busy}
              onCreate={(r) => setDraft({ nodeId: null, title: '', notes: '', date: r.date, start: r.start, end: r.end, status: 'planned', sectorId: null })}
              onOpen={openBlock}
              onChange={move}
              onToggleDone={toggleDone}
              onDropPage={dropPage}
              onOpenDay={(d) => go('day', d)}
              onDragPage={setDragPage}
            />
          )}

        </div>
        <CalendarSide
          anchor={anchor}
          today={today}
          from={view === 'month' ? `${anchor.slice(0, 8)}01` : from}
          to={view === 'month' ? monthEnd(anchor) : to}
          blocks={inRange}
          toSchedule={data.toSchedule}
          sectors={data.sectors}
          lookup={lookup}
          onPick={(d) => go(view, d)}
          onSchedule={(n) => scheduleDraft(n)}
          onDragPage={setDragPage}
          periods={periods}
          hint={
            view === 'month'
              ? 'Click a day to add a block, or its number to open it. Drag a page from To Schedule onto a day to set its due date.'
              : 'Drag on the grid to block out time. Drag a block to move it, its bottom edge to resize it. Drag a page from To Schedule onto a time.'
          }
        />
      </div>

      <BlockSheet draft={draft} sectors={data.sectors} onClose={() => setDraft(null)} onSave={save} onDelete={(id) => remove(id)} />

      {toast && (
        <div className="toast" role="status" data-tone={toast.tone}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                const u = toast.undo!;
                setToast(null);
                u();
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
      </div>
    </>
  );
}

function monthEnd(anchor: string): string {
  const d = new Date(`${anchor.slice(0, 8)}01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return addDaysISO(d.toISOString().slice(0, 10), -1);
}

function groupBy(rows: CalendarNode[], key: (n: CalendarNode) => string | null): Map<string, CalendarNode[]> {
  const m = new Map<string, CalendarNode[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}
