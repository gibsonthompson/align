import { addDaysISO, titleCase } from '@/lib/format';
import { utcToZoned } from '@/lib/tz';
import type { Block, BlockStatus } from '@/lib/types';

export const SNAP = 15; // minutes
export const DAY_MIN = 1440;
// The hours the time grid shows: 5 AM to 11 PM, all on screen at once.
export const VIEW_START = 5 * 60;
export const VIEW_END = 23 * 60;
export const VIEW_HOURS = (VIEW_END - VIEW_START) / 60;

// A block placed on one day of the grid, in wall-clock minutes.
export interface CalBlock extends Block {
  date: string;
  s: number;
  e: number;
  // Started before this day or runs past it: shown, but not dragged.
  clipped: boolean;
}

export interface Draft {
  id?: string;
  nodeId: string | null;
  nodeTitle?: string;
  nodeType?: string;
  title: string;
  notes: string;
  date: string;
  start: number;
  end: number;
  status: BlockStatus;
  sectorId: string | null;
  // True while the sector is a guess from the words, so it keeps following them.
  sectorAuto?: boolean;
}

// Splits blocks into per-day pieces for the visible days.
export function placeBlocks(blocks: Block[], days: string[]): CalBlock[] {
  const out: CalBlock[] = [];
  const set = new Set(days);
  for (const b of blocks) {
    const a = utcToZoned(b.start_at);
    const z = utcToZoned(b.end_at);
    if (a.date === z.date || (z.minutes === 0 && addDaysISO(a.date, 1) === z.date)) {
      if (set.has(a.date)) out.push({ ...b, date: a.date, s: a.minutes, e: z.date === a.date ? z.minutes : DAY_MIN, clipped: false });
      continue;
    }
    // Runs across midnight: one piece per day it touches.
    for (let d = a.date; d <= z.date; d = addDaysISO(d, 1)) {
      if (!set.has(d)) continue;
      const s = d === a.date ? a.minutes : 0;
      const e = d === z.date ? z.minutes : DAY_MIN;
      if (e > s) out.push({ ...b, date: d, s, e, clipped: true });
    }
  }
  return out;
}

// A block's own day and minutes, when it sits within one day.
export function wallTime(b: Pick<Block, 'start_at' | 'end_at'>): { date: string; s: number; e: number } | null {
  const a = utcToZoned(b.start_at);
  const z = utcToZoned(b.end_at);
  if (a.date === z.date) return { date: a.date, s: a.minutes, e: z.minutes };
  if (z.minutes === 0 && addDaysISO(a.date, 1) === z.date) return { date: a.date, s: a.minutes, e: DAY_MIN };
  return null;
}

export function blockTitle(b: Pick<Block, 'title' | 'node'>): string {
  return titleCase(b.title?.trim() || b.node?.title || 'Untitled');
}

// Side-by-side layout for overlapping blocks within one day.
export function layoutDay(items: CalBlock[]): Map<string, { col: number; cols: number; span: number }> {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  const out = new Map<string, { col: number; cols: number; span: number }>();
  let cluster: CalBlock[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];
  const flush = () => {
    const n = colEnds.length;
    for (const it of cluster) {
      const k = `${it.id}:${it.date}`;
      const col = out.get(k)!.col;
      // Widen into columns to the right that nothing overlapping uses.
      let next = n;
      for (const o of cluster) {
        const oc = out.get(`${o.id}:${o.date}`)!.col;
        if (oc > col && oc < next && o.s < it.e && o.e > it.s) next = oc;
      }
      out.set(k, { col, cols: n, span: next - col });
    }
    cluster = [];
    colEnds = [];
  };
  for (const it of sorted) {
    if (it.s >= clusterEnd && cluster.length) flush();
    let col = colEnds.findIndex((end) => end <= it.s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.e);
    } else colEnds[col] = it.e;
    out.set(`${it.id}:${it.date}`, { col, cols: 1, span: 1 });
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

export const snapDown = (m: number) => Math.floor(m / SNAP) * SNAP;
export const snapNear = (m: number) => Math.round(m / SNAP) * SNAP;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function weekdayShort(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

export function dayNum(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function monthTitle(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function rangeTitle(from: string, to: string): string {
  const f = new Date(`${from}T12:00:00Z`);
  const t = new Date(`${to}T12:00:00Z`);
  const fm = f.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const tm = t.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const y = to.slice(0, 4);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${fm} ${dayNum(from)} to ${dayNum(to)}, ${y}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${fm} ${dayNum(from)} to ${tm} ${dayNum(to)}, ${y}`;
  return `${fm} ${dayNum(from)}, ${from.slice(0, 4)} to ${tm} ${dayNum(to)}, ${y}`;
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) out.push(d);
  return out;
}

// Payload carried when a page is dragged from the side list onto the calendar.
export const DRAG_MIME = 'application/x-align-page';
export interface DragPage {
  id: string;
  title: string;
  type: string;
  minutes: number;
}
