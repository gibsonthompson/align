import 'server-only';
import { db } from '@/lib/db';
import { addDaysISO, mondayOf, todayISO } from '@/lib/format';
import { getHabits } from '@/lib/progress';
import { getCapacity, plannableHours } from '@/lib/profile';
import { utcToZoned, zonedToUtc } from '@/lib/tz';
import type { Capacity, NodeType, Sector } from '@/lib/types';

// Plan health: does everything he has committed to actually fit the week he
// has, the money he has, and the energy he has, and where do the sectors
// collide or duplicate each other.

export type Severity = 'high' | 'medium' | 'low';

export interface PlanIssue {
  severity: Severity;
  type:
    | 'over_capacity'
    | 'buffer_used'
    | 'day_overload'
    | 'overlap'
    | 'sector_over_budget'
    | 'priority_neglected'
    | 'maintain_heavy'
    | 'money_over_budget'
    | 'deadline_cluster'
    | 'possible_duplicate'
    | 'review_due'
    | 'unknown_cost';
  message: string;
  page_ids?: string[];
  sector_id?: string | null;
  date?: string;
}

export interface PlanHealth {
  weekOf: string;
  capacity: Capacity;
  hours: { waking: number; free: number; buffer: number; plannable: number; planned: number; left: number };
  byDay: { date: string; minutes: number; blocks: number }[];
  bySector: { sector_id: string; name: string; colour: string; minutes: number; budget_hours: number | null; mode: string | null }[];
  money: { month: string; total: number; budget: number | null; bySector: { sector_id: string; name: string; total: number; budget: number | null }[] };
  issues: PlanIssue[];
  configured: boolean;
}

const STOP = new Set('a an the and or of to for in on at with my your by from into per each every week weekly day daily times time minutes min do get go'.split(' '));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

function similar(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const union = a.size + b.size - shared;
  return shared >= 2 && union > 0 && shared / union >= 0.6;
}

const SEV: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export async function planHealth(anchor = todayISO()): Promise<PlanHealth> {
  const today = todayISO();
  const monday = mondayOf(anchor);
  const sunday = addDaysISO(monday, 6);
  const month = anchor.slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

  const [capacity, sectorsRes, blocksRes, habits, dueRes, moneyRes, openRes, reviewRes, horizonRes] = await Promise.all([
    getCapacity(),
    db().from('align_sectors').select('id, name, parent_id, colour, mode, weekly_hours, monthly_budget').eq('archived', false),
    db()
      .from('align_blocks')
      .select('id, node_id, sector_id, title, start_at, end_at, status')
      .gte('start_at', zonedToUtc(monday, 0).toISOString())
      .lt('start_at', zonedToUtc(addDaysISO(monday, 7), 0).toISOString())
      .limit(2000),
    getHabits(),
    db()
      .from('align_nodes')
      .select('id, title, type, sector_id, effort_minutes, due_date')
      .eq('archived', false)
      .in('type', ['action', 'task'])
      .in('status', ['active', 'planned', 'inbox'])
      .gte('due_date', monday)
      .lte('due_date', sunday)
      .limit(1000),
    db()
      .from('align_nodes')
      .select('id, title, sector_id, cost, event_date, due_date, status')
      .eq('archived', false)
      .not('cost', 'is', null)
      .neq('status', 'abandoned')
      .limit(1000),
    db()
      .from('align_nodes')
      .select('id, title, type, sector_id, parent_id, effort_minutes, cadence')
      .eq('archived', false)
      .in('type', ['commitment', 'action', 'task', 'strategy', 'experiment', 'micro_goal'])
      .in('status', ['active', 'planned'])
      .limit(800),
    db()
      .from('align_nodes')
      .select('id, title, type, review_date, due_date, verdict, status')
      .eq('archived', false)
      .in('type', ['strategy', 'experiment'])
      .in('status', ['active', 'planned'])
      .limit(300),
    db()
      .from('align_nodes')
      .select('id, title, type, event_date, due_date')
      .eq('archived', false)
      .in('status', ['active', 'planned'])
      .or(`event_date.gte.${today},and(type.in.(objective,milestone,project),due_date.gte.${today})`)
      .limit(400),
  ]);

  const sectors = (sectorsRes.data ?? []) as (Pick<Sector, 'id' | 'name' | 'parent_id' | 'colour' | 'mode'> & { weekly_hours: number | null; monthly_budget: number | null })[];
  const byId = new Map(sectors.map((s) => [s.id, s]));
  const top = (id: string | null | undefined) => {
    let s = id ? byId.get(id) : undefined;
    while (s?.parent_id) s = byId.get(s.parent_id);
    return s ?? null;
  };

  const issues: PlanIssue[] = [];
  const dayMin = new Map<string, number>(Array.from({ length: 7 }, (_, i) => [addDaysISO(monday, i), 0]));
  const dayBlocks = new Map<string, number>();
  const sectorMin = new Map<string, number>();
  const addSector = (sid: string | null | undefined, min: number) => {
    const t = top(sid);
    if (t) sectorMin.set(t.id, (sectorMin.get(t.id) ?? 0) + min);
  };

  // Calendar blocks that are not skipped.
  type B = { id: string; node_id: string | null; sector_id: string | null; title: string; start_at: string; end_at: string; status: string };
  const blocks = ((blocksRes.data ?? []) as B[]).filter((b) => b.status !== 'skipped');
  const blockedNodeMin = new Map<string, number>();
  const perDay = new Map<string, { s: number; e: number; b: B }[]>();
  for (const b of blocks) {
    const s = utcToZoned(b.start_at);
    const e = utcToZoned(b.end_at);
    const end = e.date === s.date ? e.minutes : 1440;
    const min = Math.max(0, end - s.minutes);
    dayMin.set(s.date, (dayMin.get(s.date) ?? 0) + min);
    dayBlocks.set(s.date, (dayBlocks.get(s.date) ?? 0) + 1);
    addSector(b.sector_id, min);
    if (b.node_id) blockedNodeMin.set(b.node_id, (blockedNodeMin.get(b.node_id) ?? 0) + min);
    perDay.set(s.date, [...(perDay.get(s.date) ?? []), { s: s.minutes, e: end, b }]);
  }
  for (const [date, list] of perDay) {
    const sorted = list.sort((x, y) => x.s - y.s);
    for (let i = 1; i < sorted.length; i++) {
      for (let j = 0; j < i; j++) {
        if (sorted[j].e > sorted[i].s) {
          issues.push({ severity: 'medium', type: 'overlap', date, message: `"${sorted[j].b.title}" and "${sorted[i].b.title}" overlap on ${date}.`, page_ids: [sorted[j].b.node_id, sorted[i].b.node_id].filter(Boolean) as string[] });
        }
      }
    }
  }

  // Dated actions with effort but no block yet land on their day.
  for (const n of (dueRes.data ?? []) as { id: string; title: string; sector_id: string | null; effort_minutes: number | null; due_date: string }[]) {
    if (!n.effort_minutes || blockedNodeMin.has(n.id)) continue;
    dayMin.set(n.due_date, (dayMin.get(n.due_date) ?? 0) + n.effort_minutes);
    addSector(n.sector_id, n.effort_minutes);
  }

  // Habits count their full week, less what is already blocked for them.
  const habitNodes = new Set<string>();
  let habitMin = 0;
  for (const h of habits) {
    habitNodes.add(h.node_id);
    if (h.paused || h.node.archived || !h.minutes) continue;
    const times = h.schedule === 'daily' ? 7 : h.schedule === 'days' ? h.days.length : (h.per_week ?? 0);
    const extra = Math.max(0, h.minutes * times - (blockedNodeMin.get(h.node_id) ?? 0));
    habitMin += extra;
    addSector(h.node.sector_id, extra);
  }

  const plannedMin = [...dayMin.values()].reduce((a, b) => a + b, 0) + habitMin;
  const { free, buffer, plannable } = plannableHours(capacity);
  const planned = plannedMin / 60;
  const configured = capacity.work_hours_per_week !== null;

  if (planned > free) issues.push({ severity: 'high', type: 'over_capacity', message: `${planned.toFixed(1)} hours are planned this week but only ${free.toFixed(0)} free waking hours exist after work.` });
  else if (planned > plannable)
    issues.push({ severity: 'medium', type: 'buffer_used', message: `${planned.toFixed(1)} planned hours eat into the ${capacity.buffer_percent}% kept free for rest and the unexpected (${plannable.toFixed(0)} plannable).` });

  const maxDay = capacity.max_day_hours * 60;
  for (const [date, min] of dayMin) {
    if (min > maxDay) issues.push({ severity: min > maxDay * 1.3 ? 'high' : 'medium', type: 'day_overload', date, message: `${date} has ${(min / 60).toFixed(1)} hours planned, over the ${capacity.max_day_hours} hour limit.` });
  }

  const bySector = sectors
    .filter((s) => !s.parent_id)
    .map((s) => ({ sector_id: s.id, name: s.name, colour: s.colour, minutes: sectorMin.get(s.id) ?? 0, budget_hours: s.weekly_hours === null || s.weekly_hours === undefined ? null : Number(s.weekly_hours), mode: s.mode }));
  for (const s of bySector) {
    if (s.budget_hours !== null && s.minutes > s.budget_hours * 60 * 1.1)
      issues.push({ severity: 'medium', type: 'sector_over_budget', sector_id: s.sector_id, message: `${s.name} has ${(s.minutes / 60).toFixed(1)} hours planned against a ${s.budget_hours} hour weekly budget.` });
    if (s.mode === 'priority' && s.minutes === 0)
      issues.push({ severity: 'medium', type: 'priority_neglected', sector_id: s.sector_id, message: `${s.name} is a priority but has no time planned this week.` });
    if (s.mode === 'maintain' && s.minutes > 180 && plannedMin > 0 && s.minutes / plannedMin > 0.25)
      issues.push({ severity: 'low', type: 'maintain_heavy', sector_id: s.sector_id, message: `${s.name} is in maintain mode but takes ${Math.round((s.minutes / plannedMin) * 100)}% of this week's planned time.` });
  }

  // Money this month: anything with a cost whose event or due date falls in it.
  const costs = ((moneyRes.data ?? []) as { id: string; title: string; sector_id: string | null; cost: number; event_date: string | null; due_date: string | null }[]).filter((n) => {
    const d = n.event_date ?? n.due_date;
    return d && d >= monthStart && d <= monthEnd;
  });
  const moneySector = new Map<string, number>();
  let moneyTotal = 0;
  for (const n of costs) {
    moneyTotal += Number(n.cost);
    const t = top(n.sector_id);
    if (t) moneySector.set(t.id, (moneySector.get(t.id) ?? 0) + Number(n.cost));
  }
  const money = {
    month,
    total: moneyTotal,
    budget: capacity.monthly_discretionary_usd,
    bySector: sectors
      .filter((s) => !s.parent_id && (moneySector.get(s.id) || (s.monthly_budget !== null && s.monthly_budget !== undefined)))
      .map((s) => ({ sector_id: s.id, name: s.name, total: moneySector.get(s.id) ?? 0, budget: s.monthly_budget === null || s.monthly_budget === undefined ? null : Number(s.monthly_budget) })),
  };
  if (money.budget !== null && moneyTotal > money.budget)
    issues.push({ severity: 'high', type: 'money_over_budget', message: `$${moneyTotal.toFixed(0)} of planned costs this month against $${money.budget} of discretionary money.` });
  for (const s of money.bySector)
    if (s.budget !== null && s.total > s.budget)
      issues.push({ severity: 'medium', type: 'money_over_budget', sector_id: s.sector_id, message: `${s.name} has $${s.total.toFixed(0)} planned this month against a $${s.budget} budget.` });

  // Deadlines bunched into the same week.
  const dates = ((horizonRes.data ?? []) as { id: string; title: string; event_date: string | null; due_date: string | null }[])
    .map((n) => ({ id: n.id, title: n.title, d: (n.event_date ?? n.due_date)! }))
    .filter((n) => n.d && n.d <= addDaysISO(today, 90))
    .sort((a, b) => a.d.localeCompare(b.d));
  for (let i = 0; i < dates.length; i++) {
    const win = dates.filter((x) => x.d >= dates[i].d && x.d <= addDaysISO(dates[i].d, 6));
    if (win.length >= 3 && (i === 0 || dates[i - 1].d < addDaysISO(dates[i].d, -6))) {
      issues.push({ severity: 'medium', type: 'deadline_cluster', date: dates[i].d, page_ids: win.map((x) => x.id), message: `${win.length} deadlines or events fall within a week starting ${dates[i].d}: ${win.map((x) => x.title).join(', ')}.` });
    }
  }

  // The same activity planned twice in different places.
  const open = (openRes.data ?? []) as { id: string; title: string; type: NodeType; sector_id: string | null; parent_id: string | null; effort_minutes: number | null; cadence: string }[];
  const sets = open.filter((n) => n.type !== 'task' && n.type !== 'action').map((n) => ({ n, w: words(n.title) }));
  const seen = new Set<string>();
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (a.n.parent_id && a.n.parent_id === b.n.parent_id) continue;
      if (!similar(a.w, b.w)) continue;
      const key = [a.n.id, b.n.id].sort().join();
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ severity: 'low', type: 'possible_duplicate', page_ids: [a.n.id, b.n.id], message: `"${a.n.title}" and "${b.n.title}" look like the same activity. Keep one and link it to both goals.` });
    }
  }

  // Strategies and experiments waiting on a verdict.
  for (const n of (reviewRes.data ?? []) as { id: string; title: string; type: NodeType; review_date: string | null; due_date: string | null; verdict: string }[]) {
    const due = n.review_date ?? (n.type === 'experiment' ? n.due_date : null);
    if (due && due <= today) issues.push({ severity: 'medium', type: 'review_due', date: due, page_ids: [n.id], message: `${n.type === 'experiment' ? 'Experiment' : 'Strategy'} "${n.title}" was due for review on ${due}.` });
  }

  // Ongoing commitments with no habit and no effort cannot be counted.
  for (const n of open.filter((x) => x.type === 'commitment' && !habitNodes.has(x.id) && !x.effort_minutes))
    issues.push({ severity: 'low', type: 'unknown_cost', page_ids: [n.id], message: `"${n.title}" has no habit schedule or effort, so its time is not counted. Make it a habit with minutes.` });

  issues.sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const byDay = [...dayMin.entries()].sort().map(([date, minutes]) => ({ date, minutes, blocks: dayBlocks.get(date) ?? 0 }));
  return {
    weekOf: monday,
    capacity,
    hours: { waking: free + (capacity.work_hours_per_week ?? 0), free, buffer, plannable, planned, left: plannable - planned },
    byDay,
    bySector,
    money,
    issues,
    configured,
  };
}

// A few lines for the brain's context.
export function healthLines(h: PlanHealth): string {
  const lines = [
    `This week (from ${h.weekOf}): ${h.hours.planned.toFixed(1)} hours planned of ${h.hours.plannable.toFixed(0)} plannable (${h.hours.free.toFixed(0)} free after ${h.capacity.work_hours_per_week ?? 'unknown'} work hours, ${h.capacity.buffer_percent}% kept unplanned).`,
  ];
  if (!h.configured) lines.push('Work hours are not set yet, so capacity is an estimate.');
  if (h.capacity.peak_energy) lines.push(`Peak energy: ${h.capacity.peak_energy}.`);
  if (h.capacity.energy_notes) lines.push(`Energy notes: ${h.capacity.energy_notes}`);
  const used = h.bySector.filter((s) => s.minutes > 0 || s.budget_hours !== null);
  if (used.length) lines.push(`Hours by sector: ${used.map((s) => `${s.name} ${(s.minutes / 60).toFixed(1)}${s.budget_hours !== null ? ` of ${s.budget_hours}` : ''}`).join(', ')}.`);
  if (h.money.total || h.money.budget !== null) lines.push(`Planned costs this month: $${h.money.total.toFixed(0)}${h.money.budget !== null ? ` of $${h.money.budget} discretionary` : ''}.`);
  for (const i of h.issues.filter((x) => x.severity !== 'low').slice(0, 8)) lines.push(`Warning: ${i.message}`);
  return lines.join('\n');
}
