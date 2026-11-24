import 'server-only';
import { db } from '@/lib/db';
import { addDaysISO, todayISO } from '@/lib/format';
import type { Capacity, Fact, FactKind, IdealSlot, Lifestyle } from '@/lib/types';

// The personal profile: the lifestyle he is building toward, the ideal week,
// what capacity he really has, and every fact Align knows about him.

export const FACT_KINDS: { value: FactKind; label: string; hint: string }[] = [
  { value: 'fact', label: 'Fact', hint: 'Something true about him or his life' },
  { value: 'preference', label: 'Preference', hint: 'What he likes, dislikes or prefers' },
  { value: 'constraint', label: 'Constraint', hint: 'A limit: time, money, health, location, obligations' },
  { value: 'resource', label: 'Resource', hint: 'Something he has: gear, skills, money, people, access' },
  { value: 'value', label: 'Value', hint: 'What matters to him and why' },
  { value: 'environment', label: 'Environment', hint: 'Home, workspace, city, the places his days happen in' },
  { value: 'community', label: 'Community', hint: 'Groups, clubs, churches, teams he belongs to or could join' },
  { value: 'routine', label: 'Routine', hint: 'How his days and weeks usually run' },
  { value: 'assumption', label: 'Assumption', hint: 'Believed but not yet confirmed' },
];
export const FACT_KIND_VALUES = FACT_KINDS.map((k) => k.value);
export const factKindLabel = (k?: string) => FACT_KINDS.find((x) => x.value === k)?.label ?? 'Fact';

// A durable fact nobody has confirmed in this long is worth re-checking.
export const STALE_DAYS = 180;

export const FACT_COLS = 'id, fact, source, sector_id, node_id, created_at, kind, durability, verified, valid_until, sensitive, confirmed_at, updated_at, supersedes';

export type FactState = 'confirmed' | 'assumed' | 'expired' | 'stale';

export function factState(f: Fact, today = todayISO()): FactState {
  if (f.durability === 'temporary' && f.valid_until && f.valid_until < today) return 'expired';
  if (f.verified === false || f.kind === 'assumption') return 'assumed';
  const seen = (f.confirmed_at ?? f.updated_at ?? f.created_at ?? '').slice(0, 10);
  if (seen && seen < addDaysISO(today, -STALE_DAYS)) return 'stale';
  return 'confirmed';
}

export const DEFAULT_LIFESTYLE: Lifestyle = { vision: '', non_negotiables: [], ideal_week: [] };

export const DEFAULT_CAPACITY: Capacity = {
  work_hours_per_week: null,
  buffer_percent: 25,
  max_day_hours: 10,
  monthly_discretionary_usd: null,
  peak_energy: '',
  energy_notes: '',
};

// His waking day on the calendar, 5 AM to 11 PM.
export const DAY_START = 300;
export const DAY_END = 1380;
export const WAKING_HOURS_PER_WEEK = ((DAY_END - DAY_START) / 60) * 7;

async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db().from('align_settings').select('value, updated_at').eq('key', key).maybeSingle();
  if (!data?.value || typeof data.value !== 'object') return fallback;
  return { ...fallback, ...(data.value as object), updated_at: data.updated_at } as T;
}

async function saveSetting(key: string, value: unknown) {
  const { error } = await db().from('align_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error('Could not save.');
}

export function cleanSlots(raw: unknown): IdealSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => r as Partial<IdealSlot>)
    .filter((r) => Number.isInteger(r.day) && r.day! >= 1 && r.day! <= 7 && Number.isInteger(r.start) && Number.isInteger(r.end) && r.end! > r.start! && r.start! >= 0 && r.end! <= 1440)
    .map((r) => ({ day: r.day!, start: r.start!, end: r.end!, label: String(r.label ?? '').slice(0, 80), sector_id: typeof r.sector_id === 'string' ? r.sector_id : null }))
    .sort((a, b) => a.day - b.day || a.start - b.start)
    .slice(0, 200);
}

export async function getLifestyle(): Promise<Lifestyle> {
  const l = await setting<Lifestyle>('lifestyle', DEFAULT_LIFESTYLE);
  return { ...l, ideal_week: cleanSlots(l.ideal_week), non_negotiables: Array.isArray(l.non_negotiables) ? l.non_negotiables.map(String) : [] };
}

export async function saveLifestyle(l: Lifestyle) {
  await saveSetting('lifestyle', { vision: l.vision, non_negotiables: l.non_negotiables, ideal_week: cleanSlots(l.ideal_week) });
}

export async function getCapacity(): Promise<Capacity> {
  return setting<Capacity>('capacity', DEFAULT_CAPACITY);
}

export async function saveCapacity(c: Capacity) {
  const { updated_at: _u, ...rest } = c;
  await saveSetting('capacity', rest);
}

// Hours a week he can actually plan: waking hours, less work, less the buffer
// that stays free for rest, spontaneity and the unexpected.
export function plannableHours(c: Capacity): { free: number; buffer: number; plannable: number } {
  const free = Math.max(0, WAKING_HOURS_PER_WEEK - (c.work_hours_per_week ?? 0));
  const buffer = (free * Math.min(Math.max(c.buffer_percent, 0), 90)) / 100;
  return { free, buffer, plannable: free - buffer };
}

export async function getFacts(opts: { includeSensitive?: boolean; includeArchived?: boolean } = {}): Promise<Fact[]> {
  let q = db().from('align_facts').select(`${FACT_COLS}, archived`).order('kind').order('created_at').limit(2000);
  if (!opts.includeArchived) q = q.eq('archived', false);
  if (!opts.includeSensitive) q = q.eq('sensitive', false);
  const { data } = await q;
  return (data ?? []) as Fact[];
}

// Facts written as one line each, marked so the brain can tell confirmed from assumed.
export function factLine(f: Fact, today = todayISO()): string {
  const st = factState(f, today);
  const tags = [factKindLabel(f.kind).toLowerCase()];
  if (st === 'assumed') tags.push('ASSUMED, not confirmed');
  if (st === 'stale') tags.push(`last confirmed ${(f.confirmed_at ?? f.created_at).slice(0, 10)}, may be out of date`);
  if (f.durability === 'temporary') tags.push(f.valid_until ? `temporary until ${f.valid_until}` : 'temporary');
  return `${f.fact} (${tags.join('; ')})`;
}
