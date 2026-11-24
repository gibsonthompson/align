import 'server-only';
import { db } from '@/lib/db';
import { addDaysISO, todayISO } from '@/lib/format';
import { isoDow } from '@/lib/habits';
import { getHabits, getMeasures } from '@/lib/progress';
import { utcToZoned, zonedToUtc } from '@/lib/tz';
import type { NodeType, Review } from '@/lib/types';

// The evidence for a review: was the plan carried out (execution) and did the
// numbers move (effectiveness). Doing everything without progress points at the
// strategy, not at effort, so the answer is rarely "do more".

export const REVIEW_COLS = 'id, node_id, period_start, period_end, execution, effective, verdict, summary, changes, evidence, source, created_at';

export interface ReviewEvidence {
  page: { id: string; title: string; type: NodeType; rationale: string; hypothesis: string; success_criteria: string; review_date: string | null; due_date: string | null };
  period: { from: string; to: string; days: number };
  actions: { planned: number; done: number; open_overdue: number; completed_in_period: number };
  calendar: { blocks: number; done: number; skipped: number; minutes_done: number };
  habits: { title: string; target: number; done: number; rate: number | null }[];
  measures: { name: string; unit: string; start: number | null; end: number | null; change: number | null; toward_target: boolean | null; status: string | null }[];
  execution: number | null;
  effectiveness: 'improving' | 'flat' | 'worse' | 'no_measure';
  diagnosis: string;
  previous_reviews: Pick<Review, 'created_at' | 'verdict' | 'effective' | 'execution' | 'summary'>[];
}

async function descendants(rootId: string): Promise<string[]> {
  const out: string[] = [];
  let frontier = [rootId];
  for (let depth = 0; depth < 10 && frontier.length && out.length < 800; depth++) {
    const { data } = await db().from('align_nodes').select('id').in('parent_id', frontier).eq('archived', false).limit(800);
    frontier = ((data ?? []) as { id: string }[]).map((r) => r.id);
    out.push(...frontier);
  }
  return out;
}

async function ancestors(id: string): Promise<string[]> {
  const out: string[] = [];
  let cur: string | null = id;
  for (let i = 0; i < 12 && cur; i++) {
    const { data }: { data: { parent_id: string | null } | null } = await db().from('align_nodes').select('parent_id').eq('id', cur).maybeSingle();
    cur = (data?.parent_id as string | null) ?? null;
    if (cur) out.push(cur);
  }
  return out;
}

const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000) + 1;

export async function reviewEvidence(pageId: string, fromArg?: string | null, toArg?: string | null): Promise<ReviewEvidence> {
  const { data: page } = await db()
    .from('align_nodes')
    .select('id, title, type, rationale, hypothesis, success_criteria, review_date, start_date, due_date, created_at')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) throw new Error('No page with that id.');
  const { data: prev } = await db().from('align_reviews').select(REVIEW_COLS).eq('node_id', pageId).order('created_at', { ascending: false }).limit(10);
  const previous = (prev ?? []) as Review[];

  const today = todayISO();
  const to = toArg ?? today;
  const lastEnd = previous[0]?.period_end;
  const created = page.created_at ? utcToZoned(page.created_at).date : today;
  let from = fromArg ?? (lastEnd ? addDaysISO(lastEnd, 1) : null) ?? page.start_date ?? created;
  // Reviewed again on the same day it was last reviewed, or a start in the future.
  if (from > to) from = to;
  const days = Math.max(1, daysBetween(from, to));

  const desc = await descendants(pageId);
  const ids = [pageId, ...desc];

  const [nodesRes, blocksRes, habits, measures, up] = await Promise.all([
    db().from('align_nodes').select('id, type, status, due_date, done_at').in('id', ids).limit(1000),
    db()
      .from('align_blocks')
      .select('node_id, start_at, end_at, status')
      .in('node_id', ids)
      .gte('start_at', zonedToUtc(from, 0).toISOString())
      .lt('start_at', zonedToUtc(addDaysISO(to, 1), 0).toISOString())
      .limit(2000),
    getHabits(),
    getMeasures(),
    ancestors(pageId),
  ]);

  const nodes = (nodesRes.data ?? []) as { id: string; type: NodeType; status: string; due_date: string | null; done_at: string | null }[];
  const leaves = nodes.filter((n) => n.type === 'action' || n.type === 'task');
  const inPeriod = leaves.filter((n) => n.due_date && n.due_date >= from && n.due_date <= to);
  const actions = {
    planned: inPeriod.length,
    done: inPeriod.filter((n) => n.status === 'done').length,
    open_overdue: leaves.filter((n) => n.due_date && n.due_date < today && !['done', 'abandoned'].includes(n.status)).length,
    completed_in_period: nodes.filter((n) => n.done_at && n.done_at.slice(0, 10) >= from && n.done_at.slice(0, 10) <= to).length,
  };

  const blocks = (blocksRes.data ?? []) as { start_at: string; end_at: string; status: string }[];
  const past = blocks.filter((b) => b.start_at < new Date().toISOString());
  const calendar = {
    blocks: past.length,
    done: past.filter((b) => b.status === 'done').length,
    skipped: past.filter((b) => b.status === 'skipped').length,
    minutes_done: past.filter((b) => b.status === 'done').reduce((n, b) => n + (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000, 0),
  };

  const idSet = new Set(ids);
  const habitRows = habits
    .filter((h) => idSet.has(h.node_id))
    .map((h) => {
      const start = h.started_on > from ? h.started_on : from;
      const end = to > today ? today : to;
      let target = 0;
      if (end >= start) {
        const span = daysBetween(start, end);
        if (h.schedule === 'daily') target = span;
        else if (h.schedule === 'days') for (let i = 0; i < span; i++) target += h.days.includes(isoDow(addDaysISO(start, i))) ? 1 : 0;
        else target = Math.round(((h.per_week ?? 0) * span) / 7);
      }
      const done = h.logs.filter((l) => l.status === 'done' && l.day >= start && l.day <= end).length;
      return { title: h.node.title, target, done, rate: target ? Math.min(1, done / target) : null };
    });

  const related = new Set([...ids, ...up]);
  const measureRows = measures
    .filter((m) => m.node_id && related.has(m.node_id))
    .map((m) => {
      const logs = [...m.logs].sort((a, b) => a.day.localeCompare(b.day));
      const valueAt = (d: string) => {
        if (m.kind === 'total') return logs.filter((l) => l.day <= d).reduce((n, l) => n + Number(l.value), 0);
        const hit = logs.filter((l) => l.day <= d).pop();
        return hit ? Number(hit.value) : null;
      };
      const start = valueAt(addDaysISO(from, -1)) ?? (m.kind === 'level' ? (m.start_value ?? logs[0]?.value ?? null) : 0);
      const end = valueAt(to);
      const change = start !== null && end !== null ? end - Number(start) : null;
      const dir = m.target_value !== null && start !== null ? (Number(m.target_value) >= Number(start) ? 1 : -1) : m.direction === 'down' ? -1 : 1;
      return {
        name: m.name,
        unit: m.unit,
        start: start === null ? null : Number(start),
        end,
        change,
        toward_target: change === null ? null : change * dir > 0 ? true : change === 0 ? null : false,
        status: m.model?.status ?? null,
      };
    });

  const rates: number[] = [];
  if (actions.planned) rates.push(actions.done / actions.planned);
  if (calendar.blocks) rates.push(calendar.done / calendar.blocks);
  for (const h of habitRows) if (h.rate !== null) rates.push(h.rate);
  const execution = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;

  let effectiveness: ReviewEvidence['effectiveness'] = 'no_measure';
  if (measureRows.length) {
    const moved = measureRows.filter((m) => m.toward_target === true).length;
    const worse = measureRows.filter((m) => m.toward_target === false).length;
    effectiveness = moved > worse ? 'improving' : worse > moved ? 'worse' : 'flat';
  }

  let diagnosis: string;
  if (execution === null) diagnosis = 'Nothing was scheduled or tracked in this period, so execution cannot be judged. Give it actions, a habit or a measure before the next review.';
  else if (execution < 0.5)
    diagnosis = `Only about ${Math.round(execution * 100)}% was carried out. Before judging the strategy, look at why: timing, capacity, environment, or whether it fits his life. Adding more work is unlikely to help.`;
  else if (effectiveness === 'improving') diagnosis = 'Carried out and the numbers are moving toward the target. The evidence says continue.';
  else if (effectiveness === 'no_measure') diagnosis = `About ${Math.round(execution * 100)}% was carried out but no number is attached, so judge it against the success criteria and how it felt.`;
  else
    diagnosis = `About ${Math.round(execution * 100)}% was carried out but the numbers are ${effectiveness === 'worse' ? 'moving the wrong way' : 'not moving'}. The strategy itself may be the problem: modify or replace it rather than doing more of it.`;

  return {
    page: {
      id: page.id,
      title: page.title,
      type: page.type,
      rationale: page.rationale ?? '',
      hypothesis: page.hypothesis ?? '',
      success_criteria: page.success_criteria ?? '',
      review_date: page.review_date,
      due_date: page.due_date,
    },
    period: { from, to, days },
    actions,
    calendar: { ...calendar, minutes_done: Math.round(calendar.minutes_done) },
    habits: habitRows,
    measures: measureRows,
    execution: execution === null ? null : Math.round(execution * 1000) / 1000,
    effectiveness,
    diagnosis,
    previous_reviews: previous.map((r) => ({ created_at: r.created_at, verdict: r.verdict, effective: r.effective, execution: r.execution === null ? null : Number(r.execution), summary: r.summary })),
  };
}

// Strategies and experiments whose review is due (or overdue) within a few days.
export async function reviewsDue(withinDays = 7) {
  const limit = addDaysISO(todayISO(), withinDays);
  const { data } = await db()
    .from('align_nodes')
    .select('id, title, type, sector_id, review_date, due_date, verdict, status')
    .eq('archived', false)
    .in('type', ['strategy', 'experiment', 'objective'])
    .in('status', ['active', 'planned'])
    .or(`review_date.lte.${limit},and(type.eq.experiment,due_date.lte.${limit})`)
    .order('review_date', { ascending: true, nullsFirst: false })
    .limit(100);
  return (data ?? []) as { id: string; title: string; type: NodeType; sector_id: string | null; review_date: string | null; due_date: string | null; verdict: string; status: string }[];
}
