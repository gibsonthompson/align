import 'server-only';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { addDaysISO, isISODate, mondayOf, todayISO } from '@/lib/format';
import { zonedToUtc } from '@/lib/tz';
import { getSectors } from '@/lib/data';
import type { AlignNode, Block, Sector } from '@/lib/types';

export type CalendarView = 'day' | 'week' | 'month';

export const BLOCK_COLS = 'id, node_id, sector_id, sector_auto, title, notes, start_at, end_at, status, source';
const NODE_LITE = 'id, type, title, status, sector_id, parent_id, due_date, start_date, event_date, location, effort_minutes, done_criteria, actionable';

export type CalendarNode = Pick<
  AlignNode,
  'id' | 'type' | 'title' | 'status' | 'sector_id' | 'parent_id' | 'due_date' | 'start_date' | 'event_date' | 'location' | 'effort_minutes' | 'done_criteria' | 'actionable'
> & { part_of?: string | null; scheduled?: boolean };

export interface CalendarData {
  view: CalendarView;
  anchor: string; // the date the view is built around
  today: string;
  from: string; // first visible day
  to: string; // last visible day
  blocks: Block[];
  due: CalendarNode[]; // pages dated (due) inside the range, not months or weeks
  events: CalendarNode[]; // pages with an event date inside the range
  periods: CalendarNode[]; // months and weeks of plans that overlap the range
  toSchedule: CalendarNode[]; // ready-to-do actions with nothing planned on the calendar
  sectors: Sector[];
}

// The calendar opens on the day.
export function parseView(v: unknown): CalendarView {
  return v === 'week' || v === 'month' ? v : 'day';
}

export function rangeFor(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') {
    const from = mondayOf(anchor);
    return { from, to: addDaysISO(from, 6) };
  }
  // Month: six full weeks starting on the Monday on or before the 1st.
  const first = `${anchor.slice(0, 8)}01`;
  const from = mondayOf(first);
  return { from, to: addDaysISO(from, 41) };
}

export async function loadBlocks(from: string, to: string): Promise<Block[]> {
  const start = zonedToUtc(from, 0).toISOString();
  const end = zonedToUtc(addDaysISO(to, 1), 0).toISOString();
  const { data, error } = await db().from('align_blocks').select(BLOCK_COLS).lt('start_at', end).gt('end_at', start).order('start_at').limit(1500);
  if (error) throw new Error(`Could not load the calendar: ${error.message}`);
  const blocks = (data ?? []) as Block[];
  const ids = [...new Set(blocks.map((b) => b.node_id).filter(Boolean))] as string[];
  if (ids.length) {
    const { data: nodes } = await db().from('align_nodes').select('id, title, type, status, effort_minutes, done_criteria').in('id', ids);
    const map = new Map(((nodes ?? []) as NonNullable<Block['node']>[]).map((n) => [n.id, n]));
    for (const b of blocks) b.node = b.node_id ? (map.get(b.node_id) ?? null) : null;
  }
  return blocks;
}

async function withParents(rows: CalendarNode[]): Promise<CalendarNode[]> {
  const ids = [...new Set(rows.map((r) => r.parent_id).filter(Boolean))] as string[];
  if (!ids.length) return rows;
  const { data } = await db().from('align_nodes').select('id, title').in('id', ids.slice(0, 400));
  const map = new Map(((data ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
  return rows.map((r) => ({ ...r, part_of: r.parent_id ? (map.get(r.parent_id) ?? null) : null }));
}

export async function getCalendar(viewParam: unknown, dateParam: unknown): Promise<CalendarData> {
  await requireSession();
  const today = todayISO();
  const view = parseView(viewParam);
  const anchor = isISODate(dateParam) ? dateParam : today;
  const { from, to } = rangeFor(view, anchor);
  const nowIso = new Date().toISOString();

  const [blocks, due, events, periods, ready, upcoming, sectors] = await Promise.all([
    loadBlocks(from, to),
    db()
      .from('align_nodes')
      .select(NODE_LITE)
      .eq('archived', false)
      .not('type', 'in', '(month,week)')
      .neq('status', 'abandoned')
      .gte('due_date', from)
      .lte('due_date', to)
      .order('due_date')
      .limit(400),
    db().from('align_nodes').select(NODE_LITE).eq('archived', false).gte('event_date', from).lte('event_date', to).order('event_date').limit(100),
    db()
      .from('align_nodes')
      .select(NODE_LITE)
      .eq('archived', false)
      .in('type', ['month', 'week'])
      .in('status', ['active', 'planned', 'done'])
      .lte('start_date', to)
      .gte('due_date', from)
      .order('type')
      .order('start_date')
      .limit(40),
    db()
      .from('align_nodes')
      .select(NODE_LITE)
      .eq('archived', false)
      .in('type', ['action', 'task', 'micro_goal'])
      .in('status', ['active', 'planned'])
      .eq('actionable', true)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(120),
    // Pages that already have a planned block from now on do not need scheduling.
    db().from('align_blocks').select('node_id').eq('status', 'planned').gt('end_at', nowIso).not('node_id', 'is', null).limit(2000),
    getSectors(),
  ]);
  for (const r of [due, events, periods, ready]) if (r.error) throw new Error(`Could not load the calendar: ${r.error.message}`);

  const planned = new Set(((upcoming.data ?? []) as { node_id: string }[]).map((b) => b.node_id));
  const inView = new Set(blocks.map((b) => b.node_id).filter(Boolean));
  const mark = (rows: CalendarNode[]) => rows.map((r) => ({ ...r, scheduled: planned.has(r.id) || inView.has(r.id) }));

  const toSchedule = ((ready.data ?? []) as CalendarNode[]).filter((n) => !planned.has(n.id)).slice(0, 60);
  const [dueP, toP] = await Promise.all([withParents(mark((due.data ?? []) as CalendarNode[])), withParents(toSchedule)]);

  return {
    view,
    anchor,
    today,
    from,
    to,
    blocks,
    due: dueP,
    events: (events.data ?? []) as CalendarNode[],
    periods: (periods.data ?? []) as CalendarNode[],
    toSchedule: toP,
    sectors,
  };
}

// The calendar blocks that belong to one page, for its own page.
export async function getNodeBlocks(nodeId: string): Promise<Block[]> {
  const { data } = await db().from('align_blocks').select(BLOCK_COLS).eq('node_id', nodeId).order('start_at', { ascending: false }).limit(60);
  return (data ?? []) as Block[];
}

