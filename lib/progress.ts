import 'server-only';
import { db } from '@/lib/db';
import { addDaysISO, mondayOf, todayISO } from '@/lib/format';
import { utcToZoned, zonedToUtc } from '@/lib/tz';
import { habitStat, measureStat, plannedDays, type HabitStat, type MeasureStat } from '@/lib/habits';
import type { Habit, HabitLog, Measure, MeasureLog, NodeStatus, NodeType } from '@/lib/types';

export const HABIT_COLS = 'id, node_id, schedule, days, per_week, minutes, window_start, window_end, auto_place, paused, started_on';
export const MEASURE_COLS = 'id, node_id, sector_id, name, unit, kind, direction, period, start_value, target_value, target_date, archived, sort, created_at';

export interface HabitRow extends Habit {
  node: { id: string; title: string; type: NodeType; status: NodeStatus; sector_id: string | null; archived: boolean };
  logs: HabitLog[];
  stat: HabitStat;
}

export interface MeasureRow extends Measure {
  node: { id: string; title: string } | null;
  logs: MeasureLog[];
  stat: MeasureStat;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function normaliseMeasure(m: Measure): Measure {
  return { ...m, start_value: num(m.start_value), target_value: num(m.target_value) };
}

async function habitsWith(nodeId?: string): Promise<HabitRow[]> {
  const today = todayISO();
  let q = db().from('align_habits').select(HABIT_COLS);
  if (nodeId) q = q.eq('node_id', nodeId);
  const { data, error } = await q.limit(200);
  if (error) throw new Error(`Could not load habits: ${error.message}`);
  const habits = (data ?? []) as Habit[];
  if (!habits.length) return [];
  const [nodes, logs] = await Promise.all([
    db().from('align_nodes').select('id, title, type, status, sector_id, archived').in('id', habits.map((h) => h.node_id)),
    db().from('align_habit_logs').select('id, habit_id, day, status, amount, note, source').in('habit_id', habits.map((h) => h.id)).gte('day', addDaysISO(today, -400)).order('day', { ascending: false }).limit(5000),
  ]);
  const nodeMap = new Map(((nodes.data ?? []) as HabitRow['node'][]).map((n) => [n.id, n]));
  const logMap = new Map<string, HabitLog[]>();
  for (const l of (logs.data ?? []) as HabitLog[]) logMap.set(l.habit_id, [...(logMap.get(l.habit_id) ?? []), { ...l, amount: num(l.amount) }]);
  return habits
    .map((h) => {
      const node = nodeMap.get(h.node_id);
      if (!node || node.archived) return null;
      const hl = logMap.get(h.id) ?? [];
      return { ...h, days: (h.days ?? []).map(Number), node, logs: hl, stat: habitStat(h, hl, today) };
    })
    .filter((h): h is HabitRow => Boolean(h))
    .sort((a, b) => Number(a.paused) - Number(b.paused) || Number(b.stat.dueToday && !b.stat.doneToday) - Number(a.stat.dueToday && !a.stat.doneToday) || a.node.title.localeCompare(b.node.title));
}

async function measuresWith(nodeId?: string): Promise<MeasureRow[]> {
  const today = todayISO();
  let q = db().from('align_measures').select(MEASURE_COLS).eq('archived', false);
  if (nodeId) q = q.eq('node_id', nodeId);
  const { data, error } = await q.order('sort').order('created_at').limit(200);
  if (error) throw new Error(`Could not load measures: ${error.message}`);
  const measures = ((data ?? []) as Measure[]).map(normaliseMeasure);
  if (!measures.length) return [];
  const nodeIds = [...new Set(measures.map((m) => m.node_id).filter(Boolean))] as string[];
  const [logs, nodes] = await Promise.all([
    db().from('align_measure_logs').select('id, measure_id, day, value, note, source, created_at').in('measure_id', measures.map((m) => m.id)).gte('day', addDaysISO(today, -730)).order('day').limit(10000),
    nodeIds.length ? db().from('align_nodes').select('id, title').in('id', nodeIds) : Promise.resolve({ data: [] }),
  ]);
  const nodeMap = new Map(((nodes.data ?? []) as { id: string; title: string }[]).map((n) => [n.id, n]));
  const logMap = new Map<string, MeasureLog[]>();
  for (const l of (logs.data ?? []) as MeasureLog[]) logMap.set(l.measure_id, [...(logMap.get(l.measure_id) ?? []), { ...l, value: Number(l.value) }]);
  return measures.map((m) => {
    const ml = logMap.get(m.id) ?? [];
    return { ...m, node: m.node_id ? (nodeMap.get(m.node_id) ?? null) : null, logs: ml, stat: measureStat(m, ml, today) };
  });
}

export function getHabits(): Promise<HabitRow[]> {
  return habitsWith();
}

export function getMeasures(): Promise<MeasureRow[]> {
  return measuresWith();
}

export async function getNodeProgress(nodeId: string): Promise<{ habit: HabitRow | null; measures: MeasureRow[] }> {
  const [habits, measures] = await Promise.all([habitsWith(nodeId), measuresWith(nodeId)]);
  return { habit: habits[0] ?? null, measures };
}

// ---------------------------------------------------------------------------
// Placing habit sessions on the calendar
// ---------------------------------------------------------------------------

export interface PlaceResult {
  placed: { habit: string; date: string; start: number; end: number; blockId: string }[];
  skipped: { habit: string; reason: string }[];
}

// Puts each habit's remaining sessions for the week into free time inside its window.
export async function placeHabitSessions(weekAnchor: string, onlyHabitIds?: string[], source: 'align' | 'chatgpt' = 'align'): Promise<PlaceResult> {
  const today = todayISO();
  const weekStart = mondayOf(weekAnchor);
  const weekEnd = addDaysISO(weekStart, 6);
  const out: PlaceResult = { placed: [], skipped: [] };
  if (weekEnd < today) return out;

  const habits = (await getHabits()).filter((h) => !h.paused && h.node.status !== 'done' && h.node.status !== 'abandoned' && (!onlyHabitIds || onlyHabitIds.includes(h.id)));
  if (!habits.length) return out;

  const { data: blocks } = await db()
    .from('align_blocks')
    .select('id, node_id, start_at, end_at, status')
    .lt('start_at', zonedToUtc(addDaysISO(weekEnd, 1), 0).toISOString())
    .gt('end_at', zonedToUtc(weekStart, 0).toISOString())
    .limit(2000);
  const busy = new Map<string, [number, number][]>();
  const bookedFor = new Map<string, Set<string>>();
  for (const b of (blocks ?? []) as { node_id: string | null; start_at: string; end_at: string; status: string }[]) {
    if (b.status === 'skipped') continue;
    const a = utcToZoned(b.start_at);
    const z = utcToZoned(b.end_at);
    for (let d = a.date; d <= z.date; d = addDaysISO(d, 1)) {
      const s = d === a.date ? a.minutes : 0;
      const e = d === z.date ? z.minutes : 1440;
      if (e > s) busy.set(d, [...(busy.get(d) ?? []), [s, e]]);
    }
    if (b.node_id) bookedFor.set(b.node_id, new Set([...(bookedFor.get(b.node_id) ?? []), a.date]));
  }

  const nowMin = utcToZoned(Date.now()).minutes;
  const inserts: { habit: HabitRow; date: string; s: number; e: number }[] = [];
  for (const h of habits) {
    const len = h.minutes ?? 30;
    const done = new Set(h.logs.filter((l) => l.status === 'done' || l.status === 'skipped').map((l) => l.day));
    const booked = bookedFor.get(h.node_id) ?? new Set<string>();
    const days = plannedDays(h, weekStart, today, done, booked);
    if (!days.length) {
      out.skipped.push({ habit: h.node.title, reason: 'Already on track or booked for this week.' });
      continue;
    }
    const winStart = h.window_start ?? 6 * 60;
    const winEnd = h.window_end ?? 22 * 60;
    for (const d of days) {
      const taken = busy.get(d) ?? [];
      const from = Math.max(winStart, d === today ? Math.ceil((nowMin + 10) / 15) * 15 : 0);
      let slot: number | null = null;
      for (let m = from; m + len <= winEnd; m += 15) {
        if (!taken.some(([s, e]) => m < e && m + len > s)) {
          slot = m;
          break;
        }
      }
      if (slot === null) {
        out.skipped.push({ habit: h.node.title, reason: `No free ${len} minutes on ${d} inside its time window.` });
        continue;
      }
      inserts.push({ habit: h, date: d, s: slot, e: slot + len });
      busy.set(d, [...taken, [slot, slot + len]]);
    }
  }
  if (!inserts.length) return out;
  const { data, error } = await db()
    .from('align_blocks')
    .insert(inserts.map((i) => ({ node_id: i.habit.node_id, title: '', notes: '', start_at: zonedToUtc(i.date, i.s).toISOString(), end_at: zonedToUtc(i.date, i.e).toISOString(), source })))
    .select('id');
  if (error) throw new Error('Could not place the habit sessions.');
  ((data ?? []) as { id: string }[]).forEach((row, i) => out.placed.push({ habit: inserts[i].habit.node.title, date: inserts[i].date, start: inserts[i].s, end: inserts[i].e, blockId: row.id }));
  return out;
}
