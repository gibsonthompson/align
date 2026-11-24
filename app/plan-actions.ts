'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { hasSession } from '@/lib/auth';
import { cleanBody, cleanText, isId } from '@/lib/ids';
import { isISODate } from '@/lib/format';
import { cleanSlots, FACT_KIND_VALUES, getCapacity, getLifestyle, saveCapacity, saveLifestyle } from '@/lib/profile';
import { reviewEvidence, type ReviewEvidence } from '@/lib/review';
import type { ActionResult, Capacity, FactKind, IdealSlot, MeasureCurve } from '@/lib/types';

// Actions for the profile, the lifestyle vision, capacity, strategies and reviews.

const SIGNED_OUT = 'You were signed out. Enter your PIN again.';
const err = <T = undefined,>(error: string): ActionResult<T> => ({ ok: false, error });
const refresh = () => revalidatePath('/', 'layout');

// ---------------------------------------------------------------------------
// Profile facts
// ---------------------------------------------------------------------------

export interface FactInput {
  fact: string;
  kind: FactKind;
  verified: boolean;
  temporary: boolean;
  valid_until: string | null;
  sensitive: boolean;
  sector_id: string | null;
}

function factRow(f: FactInput): Record<string, unknown> | string {
  const fact = cleanText(f.fact, 500);
  if (!fact) return 'Write the fact first.';
  if (!FACT_KIND_VALUES.includes(f.kind)) return 'Pick a kind.';
  if (f.valid_until && !isISODate(f.valid_until)) return 'The end date is not a date.';
  if (f.sector_id && !isId(f.sector_id)) return 'Unknown sector.';
  const verified = f.kind === 'assumption' ? false : f.verified;
  return {
    fact,
    kind: f.kind,
    verified,
    durability: f.temporary || f.valid_until ? 'temporary' : 'durable',
    valid_until: f.temporary || f.valid_until ? (f.valid_until ?? null) : null,
    sensitive: f.sensitive,
    sector_id: f.sector_id,
  };
}

export async function addFactFull(input: FactInput): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  const row = factRow(input);
  if (typeof row === 'string') return err(row);
  const { error } = await db()
    .from('align_facts')
    .insert({ ...row, source: 'gibson', confirmed_at: row.verified ? new Date().toISOString() : null });
  if (error) return err('Could not save the fact. Try again.');
  refresh();
  return { ok: true };
}

// Editing the words of a fact keeps the old version on record and points the new one at it.
export async function editFact(id: string, input: FactInput): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That fact is gone.');
  const row = factRow(input);
  if (typeof row === 'string') return err(row);
  const { data: cur } = await db().from('align_facts').select('fact, verified').eq('id', id).maybeSingle();
  if (!cur) return err('That fact is gone.');
  const confirmedNow = row.verified && !cur.verified ? { confirmed_at: new Date().toISOString() } : {};
  if (cur.fact !== row.fact) {
    const { error } = await db()
      .from('align_facts')
      .insert({ ...row, source: 'gibson', supersedes: id, confirmed_at: row.verified ? new Date().toISOString() : null });
    if (error) return err('Could not save the change. Try again.');
    await db().from('align_facts').update({ archived: true }).eq('id', id);
  } else {
    const { error } = await db().from('align_facts').update({ ...row, ...confirmedNow }).eq('id', id);
    if (error) return err('Could not save the change. Try again.');
  }
  refresh();
  return { ok: true };
}

export async function confirmFact(id: string): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That fact is gone.');
  const { data: cur } = await db().from('align_facts').select('kind').eq('id', id).maybeSingle();
  const { error } = await db()
    .from('align_facts')
    .update({ verified: true, confirmed_at: new Date().toISOString(), ...(cur?.kind === 'assumption' ? { kind: 'fact' } : {}) })
    .eq('id', id);
  if (error) return err('Could not confirm it. Try again.');
  refresh();
  return { ok: true };
}

export async function archiveFactFull(id: string): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That fact is already gone.');
  const { error } = await db().from('align_facts').update({ archived: true }).eq('id', id);
  if (error) return err('Could not remove it. Try again.');
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lifestyle vision and capacity
// ---------------------------------------------------------------------------

export async function saveLifestyleAction(patch: { vision?: string; non_negotiables?: string[]; ideal_week?: IdealSlot[] }): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  const cur = await getLifestyle();
  const next = { ...cur };
  if (patch.vision !== undefined) next.vision = cleanBody(patch.vision, 8000);
  if (patch.non_negotiables !== undefined) next.non_negotiables = patch.non_negotiables.map((x) => cleanText(x, 200)).filter(Boolean).slice(0, 30);
  if (patch.ideal_week !== undefined) {
    for (const s of patch.ideal_week) if (s.sector_id && !isId(s.sector_id)) return err('Unknown sector.');
    next.ideal_week = cleanSlots(patch.ideal_week);
  }
  try {
    await saveLifestyle(next);
  } catch {
    return err('Could not save. Try again.');
  }
  refresh();
  return { ok: true };
}

export async function saveCapacityAction(patch: Partial<Capacity>): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  const cur = await getCapacity();
  const next: Capacity = { ...cur };
  const within = (v: unknown, lo: number, hi: number) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi);
  if (patch.work_hours_per_week !== undefined) {
    if (!within(patch.work_hours_per_week, 0, 120)) return err('Work hours are 0 to 120 a week.');
    next.work_hours_per_week = patch.work_hours_per_week;
  }
  if (patch.buffer_percent !== undefined) {
    if (!within(patch.buffer_percent, 0, 90) || patch.buffer_percent === null) return err('Keep between 0 and 90 percent free.');
    next.buffer_percent = patch.buffer_percent;
  }
  if (patch.max_day_hours !== undefined) {
    if (!within(patch.max_day_hours, 1, 18) || patch.max_day_hours === null) return err('A full day is 1 to 18 hours.');
    next.max_day_hours = patch.max_day_hours;
  }
  if (patch.monthly_discretionary_usd !== undefined) {
    if (!within(patch.monthly_discretionary_usd, 0, 10_000_000)) return err('Enter a dollar amount.');
    next.monthly_discretionary_usd = patch.monthly_discretionary_usd;
  }
  if (patch.peak_energy !== undefined) next.peak_energy = cleanText(patch.peak_energy, 200);
  if (patch.energy_notes !== undefined) next.energy_notes = cleanBody(patch.energy_notes, 2000);
  try {
    await saveCapacity(next);
  } catch {
    return err('Could not save. Try again.');
  }
  refresh();
  return { ok: true };
}

// Where a sector is, where it should be, and what it may take.
export async function saveSectorPlan(
  id: string,
  patch: { current_state?: string; desired_state?: string; weekly_hours?: number | null; monthly_budget?: number | null },
): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That sector no longer exists.');
  const row: Record<string, unknown> = {};
  if (patch.current_state !== undefined) row.current_state = cleanBody(patch.current_state, 5000);
  if (patch.desired_state !== undefined) row.desired_state = cleanBody(patch.desired_state, 5000);
  if (patch.weekly_hours !== undefined) {
    if (patch.weekly_hours !== null && !(Number.isFinite(patch.weekly_hours) && patch.weekly_hours >= 0 && patch.weekly_hours <= 168)) return err('Hours a week are 0 to 168.');
    row.weekly_hours = patch.weekly_hours;
  }
  if (patch.monthly_budget !== undefined) {
    if (patch.monthly_budget !== null && !(Number.isFinite(patch.monthly_budget) && patch.monthly_budget >= 0)) return err('Enter a dollar amount.');
    row.monthly_budget = patch.monthly_budget;
  }
  if (!Object.keys(row).length) return { ok: true };
  const { error } = await db().from('align_sectors').update(row).eq('id', id);
  if (error) return err('Could not save. Try again.');
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Strategies, experiments and reviews
// ---------------------------------------------------------------------------

export async function saveStrategyFields(
  id: string,
  patch: { rationale?: string; hypothesis?: string; success_criteria?: string; review_date?: string | null },
): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That page no longer exists.');
  const row: Record<string, unknown> = {};
  if (patch.rationale !== undefined) row.rationale = cleanBody(patch.rationale, 5000);
  if (patch.hypothesis !== undefined) row.hypothesis = cleanBody(patch.hypothesis, 2000);
  if (patch.success_criteria !== undefined) row.success_criteria = cleanBody(patch.success_criteria, 2000);
  if (patch.review_date !== undefined) {
    if (patch.review_date !== null && !isISODate(patch.review_date)) return err('Pick a review date.');
    row.review_date = patch.review_date;
  }
  if (!Object.keys(row).length) return { ok: true };
  const { error } = await db().from('align_nodes').update(row).eq('id', id);
  if (error) return err('Could not save. Try again.');
  refresh();
  return { ok: true };
}

export async function loadReviewEvidence(id: string): Promise<ActionResult<ReviewEvidence>> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That page no longer exists.');
  try {
    return { ok: true, data: await reviewEvidence(id) };
  } catch {
    return err('Could not gather the evidence. Try again.');
  }
}

export async function recordReviewAction(
  id: string,
  input: { verdict: 'continue' | 'modify' | 'replace' | 'stop'; effective: 'yes' | 'partly' | 'no' | 'unclear'; summary: string; changes: string; next_review_date: string | null; pause_children: boolean },
): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That page no longer exists.');
  if (!['continue', 'modify', 'replace', 'stop'].includes(input.verdict)) return err('Pick a verdict.');
  if (!['yes', 'partly', 'no', 'unclear'].includes(input.effective)) return err('Say whether it worked.');
  const summary = cleanBody(input.summary, 5000);
  if (!summary) return err('Write a line on what happened and why.');
  if (input.next_review_date && !isISODate(input.next_review_date)) return err('Pick a next review date.');
  let ev: ReviewEvidence;
  try {
    ev = await reviewEvidence(id);
  } catch {
    return err('That page no longer exists.');
  }
  const { error } = await db()
    .from('align_reviews')
    .insert({
      node_id: id,
      period_start: ev.period.from,
      period_end: ev.period.to,
      execution: ev.execution,
      effective: input.effective,
      verdict: input.verdict,
      summary,
      changes: cleanBody(input.changes, 5000),
      evidence: { actions: ev.actions, calendar: ev.calendar, habits: ev.habits, measures: ev.measures, diagnosis: ev.diagnosis },
      source: 'align',
    });
  if (error) return err('Could not save the review. Try again.');
  if (input.verdict === 'continue' || input.verdict === 'modify') {
    await db().from('align_nodes').update({ review_date: input.next_review_date }).eq('id', id);
  } else {
    await db().from('align_nodes').update({ status: 'abandoned', review_date: null }).eq('id', id);
    if (input.pause_children) await db().from('align_nodes').update({ status: 'paused' }).eq('parent_id', id).in('status', ['active', 'planned', 'inbox']).eq('archived', false);
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The model behind a measure
// ---------------------------------------------------------------------------

export async function saveMeasureModel(
  id: string,
  patch: {
    baseline_date?: string | null;
    curve?: MeasureCurve;
    assumptions?: { text: string; confirmed: boolean }[];
    scenarios?: Partial<Record<'conservative' | 'realistic' | 'ambitious', { value: number | null; note: string }>>;
    method?: string;
  },
): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That measure no longer exists.');
  const row: Record<string, unknown> = {};
  if (patch.baseline_date !== undefined) {
    if (patch.baseline_date !== null && !isISODate(patch.baseline_date)) return err('Pick a baseline date.');
    row.baseline_date = patch.baseline_date;
  }
  if (patch.curve !== undefined) {
    if (!['linear', 'front_loaded', 'back_loaded', 'compound'].includes(patch.curve)) return err('Unknown curve.');
    row.curve = patch.curve;
  }
  if (patch.assumptions !== undefined) row.assumptions = patch.assumptions.map((a) => ({ text: cleanText(a.text, 300), confirmed: Boolean(a.confirmed) })).filter((a) => a.text).slice(0, 20);
  if (patch.scenarios !== undefined) {
    const out: Record<string, { value: number | null; note: string }> = {};
    for (const k of ['conservative', 'realistic', 'ambitious'] as const) {
      const v = patch.scenarios[k];
      if (!v) continue;
      if (v.value !== null && !Number.isFinite(v.value)) return err('Scenario values are numbers.');
      out[k] = { value: v.value, note: cleanText(v.note ?? '', 400) };
    }
    row.scenarios = out;
  }
  if (patch.method !== undefined) row.method = cleanBody(patch.method, 5000);
  if (!Object.keys(row).length) return { ok: true };
  const { error } = await db().from('align_measures').update(row).eq('id', id);
  if (error) return err('Could not save. Try again.');
  refresh();
  return { ok: true };
}
