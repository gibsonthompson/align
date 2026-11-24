// Pure maths for habits and measures, shared by the server, the browser and ChatGPT's tools.
import { addDaysISO, mondayOf } from '@/lib/format';
import type { Habit, HabitLog, Measure, MeasureLog } from '@/lib/types';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// 1 Monday to 7 Sunday.
export function isoDow(day: string): number {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function scheduleLabel(h: Pick<Habit, 'schedule' | 'days' | 'per_week' | 'minutes'>): string {
  const len = h.minutes ? `, ${h.minutes} min` : '';
  if (h.schedule === 'daily') return `Every day${len}`;
  if (h.schedule === 'days') {
    const d = [...h.days].sort((a, b) => a - b);
    if (d.join() === '1,2,3,4,5') return `Weekdays${len}`;
    if (d.join() === '6,7') return `Weekends${len}`;
    return `${d.map((x) => WEEKDAYS[x - 1]).join(', ')}${len}`;
  }
  const n = h.per_week ?? 1;
  return `${n} ${n === 1 ? 'time' : 'times'} a week${len}`;
}

// Is a session expected on this exact day (for daily and weekday habits)?
export function scheduledOn(h: Habit, day: string): boolean {
  if (day < h.started_on) return false;
  if (h.schedule === 'daily') return true;
  if (h.schedule === 'days') return h.days.includes(isoDow(day));
  return false;
}

export interface HabitStat {
  weekDone: number;
  weekTarget: number;
  dueToday: boolean;
  doneToday: boolean;
  skippedToday: boolean;
  streak: number;
  streakUnit: 'day' | 'week';
  rate: number | null; // share of expected sessions done over the last 4 weeks
  remainingThisWeek: number;
}

export function habitStat(h: Habit, logs: HabitLog[], today: string): HabitStat {
  const done = new Set(logs.filter((l) => l.status === 'done').map((l) => l.day));
  const skipped = new Set(logs.filter((l) => l.status === 'skipped').map((l) => l.day));
  const monday = mondayOf(today);
  let weekDone = 0;
  for (let d = monday; d <= addDaysISO(monday, 6); d = addDaysISO(d, 1)) if (done.has(d)) weekDone++;

  let weekTarget: number;
  if (h.schedule === 'daily') weekTarget = 7;
  else if (h.schedule === 'days') weekTarget = h.days.length;
  else weekTarget = h.per_week ?? 1;

  const doneToday = done.has(today);
  const skippedToday = skipped.has(today);
  const dueToday = !h.paused && (h.schedule === 'per_week' ? weekDone < weekTarget || doneToday : scheduledOn(h, today));

  // Streak: consecutive scheduled days done (skips do not break it), or consecutive weeks on target.
  let streak = 0;
  let streakUnit: 'day' | 'week' = 'day';
  if (h.schedule === 'per_week') {
    streakUnit = 'week';
    if (weekDone >= weekTarget) streak = 1;
    for (let w = addDaysISO(monday, -7); w >= mondayOf(h.started_on); w = addDaysISO(w, -7)) {
      let n = 0;
      for (let d = w; d <= addDaysISO(w, 6); d = addDaysISO(d, 1)) if (done.has(d)) n++;
      if (n >= weekTarget) streak++;
      else break;
    }
  } else {
    let d = doneToday ? today : addDaysISO(today, -1);
    for (let i = 0; i < 400 && d >= h.started_on; i++, d = addDaysISO(d, -1)) {
      if (!scheduledOn(h, d) || skipped.has(d)) continue;
      if (done.has(d)) streak++;
      else break;
    }
  }

  // Four-week rate, counting only full past days.
  const from = addDaysISO(today, -28) < h.started_on ? h.started_on : addDaysISO(today, -28);
  let expected = 0;
  let hit = 0;
  if (h.schedule === 'per_week') {
    const days = Math.max(0, Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000));
    expected = Math.round(((h.per_week ?? 1) * days) / 7);
    for (let d = from; d < today; d = addDaysISO(d, 1)) if (done.has(d)) hit++;
  } else {
    for (let d = from; d < today; d = addDaysISO(d, 1)) {
      if (!scheduledOn(h, d) || skipped.has(d)) continue;
      expected++;
      if (done.has(d)) hit++;
    }
  }
  const rate = expected > 0 ? Math.min(1, hit / expected) : null;

  return {
    weekDone,
    weekTarget,
    dueToday,
    doneToday,
    skippedToday,
    streak,
    streakUnit,
    rate,
    remainingThisWeek: Math.max(0, weekTarget - weekDone),
  };
}

// Days a habit should land on this week, from today on, spaced out evenly.
export function plannedDays(h: Habit, weekStart: string, today: string, alreadyDone: Set<string>, alreadyBooked: Set<string>): string[] {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)).filter((d) => d >= today && d >= h.started_on);
  if (h.schedule === 'daily' || h.schedule === 'days') return days.filter((d) => scheduledOn(h, d) && !alreadyDone.has(d) && !alreadyBooked.has(d));
  const need = (h.per_week ?? 1) - [...alreadyDone, ...alreadyBooked].filter((d) => d >= weekStart && d <= addDaysISO(weekStart, 6)).length;
  if (need <= 0) return [];
  const open = days.filter((d) => !alreadyDone.has(d) && !alreadyBooked.has(d));
  if (open.length <= need) return open;
  // Spread them out: pick evenly spaced days from what is left of the week.
  const out: string[] = [];
  for (let i = 0; i < need; i++) out.push(open[Math.round((i * (open.length - 1)) / Math.max(1, need - 1))]);
  return [...new Set(out)];
}

export interface MeasureStat {
  current: number | null; // latest value (level) or the total for the period (total)
  latestDay: string | null;
  change: number | null; // change since the start value or the first log
  progress: number | null; // 0 to 1 toward the target
  onTrack: boolean | null;
  periodLabel: string;
  count: number;
}

export function periodStart(m: Pick<Measure, 'period' | 'created_at'>, today: string): string | null {
  if (m.period === 'week') return mondayOf(today);
  if (m.period === 'month') return `${today.slice(0, 8)}01`;
  return null;
}

export function measureStat(m: Measure, logs: MeasureLog[], today: string): MeasureStat {
  const sorted = [...logs].sort((a, b) => a.day.localeCompare(b.day) || a.created_at.localeCompare(b.created_at));
  const latest = sorted[sorted.length - 1] ?? null;
  const periodLabel = m.kind === 'total' ? (m.period === 'week' ? 'This week' : m.period === 'month' ? 'This month' : 'All time') : 'Latest';
  let current: number | null;
  if (m.kind === 'total') {
    const from = periodStart(m, today);
    current = sorted.filter((l) => !from || l.day >= from).reduce((n, l) => n + Number(l.value), 0);
  } else current = latest ? Number(latest.value) : null;

  const base = m.start_value ?? (m.kind === 'level' && sorted.length ? Number(sorted[0].value) : m.kind === 'total' ? 0 : null);
  const change = current !== null && base !== null && m.kind === 'level' ? current - Number(base) : null;

  let progress: number | null = null;
  if (m.target_value !== null && current !== null) {
    const target = Number(m.target_value);
    if (m.kind === 'total') progress = target > 0 ? Math.max(0, Math.min(1, current / target)) : null;
    else if (base !== null && target !== Number(base)) progress = Math.max(0, Math.min(1, (current - Number(base)) / (target - Number(base))));
    else progress = (m.direction === 'up' ? current >= target : current <= target) ? 1 : 0;
  }

  // On track: where progress should be by now if moving steadily toward the target date.
  let onTrack: boolean | null = null;
  if (progress !== null) {
    if (progress >= 1) onTrack = true;
    else if (m.kind === 'total' && m.period !== 'all') {
      const from = periodStart(m, today)!;
      const len = m.period === 'week' ? 7 : new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
      const elapsed = Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000) + 1;
      onTrack = progress >= (elapsed / len) * 0.9;
    } else if (m.target_date) {
      const start = (m.created_at ?? '').slice(0, 10) || today;
      const span = new Date(`${m.target_date}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime();
      const gone = new Date(`${today}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime();
      onTrack = span > 0 ? progress >= Math.min(1, gone / span) * 0.9 : progress >= 1;
    }
  }
  return { current, latestDay: latest?.day ?? null, change, progress, onTrack, periodLabel, count: sorted.length };
}

// "182.4 lb", "$1,250", "3.1 mi".
export function fmtValue(v: number | null, unit: string): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'None';
  const n = Math.abs(v) >= 1000 ? Math.round(v) : Math.round(v * 100) / 100;
  const s = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (unit === '$') return `${v < 0 ? '-' : ''}$${s.replace('-', '')}`;
  return unit ? `${s} ${unit}` : s;
}
