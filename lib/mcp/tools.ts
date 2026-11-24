import 'server-only';
import { db } from '@/lib/db';
import { isId, cleanBody, cleanLink, cleanText, slugify } from '@/lib/ids';
import { isISODate, todayISO, addDaysISO } from '@/lib/format';
import { NODE_KINDS, PERIOD_TYPES } from '@/lib/kinds';
import { hhmm, parseClock, TZ, utcToZoned, zonedToUtc } from '@/lib/tz';
import { getHabits, getMeasures, placeHabitSessions, type HabitRow, type MeasureRow } from '@/lib/progress';
import { scheduleLabel } from '@/lib/habits';
import { guessSector } from '@/lib/classify';
import { CURVE_LABEL, MODEL_STATUS_LABEL } from '@/lib/habits';
import { planHealth } from '@/lib/capacity';
import { reviewEvidence, reviewsDue } from '@/lib/review';
import {
  FACT_KIND_VALUES,
  cleanSlots,
  factState,
  getCapacity,
  getFacts,
  getLifestyle,
  plannableHours,
  saveCapacity,
  saveLifestyle,
} from '@/lib/profile';
import type { Capacity, Fact, FactKind } from '@/lib/types';
import type { NodeType, NodeStatus, Relation, Sector } from '@/lib/types';

// The tools ChatGPT gets in Align. Read tools are marked read-only; everything
// else is a write and ChatGPT asks Gibson to confirm it.

const NODE_TYPES = Object.keys(NODE_KINDS) as NodeType[];
const STATUSES: NodeStatus[] = ['inbox', 'planned', 'active', 'done', 'paused', 'abandoned'];
const RELATIONS: Relation[] = ['supports', 'depends_on', 'related'];
const NODE_COLS =
  'id, type, title, body, sector_id, parent_id, status, priority, start_date, due_date, done_at, done_criteria, effort_minutes, cadence, actionable, archived, sort, updated_at, event_date, link_url, location, cost, rationale, hypothesis, success_criteria, review_date, verdict, verdict_note';
const SECTOR_COLS =
  'id, slug, name, parent_id, colour, summary, importance, satisfaction, attention_needed, mode, sort, archived, current_state, desired_state, weekly_hours, monthly_budget';
const VERDICTS = ['continue', 'modify', 'replace', 'stop'] as const;
const DAY_KEYS: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

export class ToolError extends Error {}

type Args = Record<string, unknown>;
type Ctx = { origin: string };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function sectors(): Promise<Sector[]> {
  const { data, error } = await db().from('align_sectors').select(SECTOR_COLS).eq('archived', false).order('sort');
  if (error) throw new ToolError('Could not load sectors.');
  return (data ?? []) as Sector[];
}

async function sectorBySlug(slug: unknown): Promise<Sector> {
  if (typeof slug !== 'string' || !slug) throw new ToolError('sector_slug is required. Call get_life_overview for the list of slugs.');
  const all = await sectors();
  const s = all.find((x) => x.slug === slug.trim().toLowerCase());
  if (!s) throw new ToolError(`No sector or area with slug "${slug}". Valid slugs: ${all.map((x) => x.slug).join(', ')}`);
  return s;
}

async function nodeById(id: unknown) {
  if (!isId(id)) throw new ToolError('A valid page id is required.');
  const { data } = await db().from('align_nodes').select(NODE_COLS).eq('id', id).maybeSingle();
  if (!data) throw new ToolError(`No page with id ${id}.`);
  return data as Record<string, unknown> & { id: string; type: NodeType; title: string; sector_id: string | null; parent_id: string | null; archived: boolean };
}

const url = (ctx: Ctx, kind: 'node' | 'sector', idOrSlug: string) => (kind === 'node' ? `${ctx.origin}/n/${idOrSlug}` : `${ctx.origin}/s/${idOrSlug}`);

function str(v: unknown, max: number, field: string, required = false): string | undefined {
  if (v === undefined || v === null) {
    if (required) throw new ToolError(`${field} is required.`);
    return undefined;
  }
  if (typeof v !== 'string') throw new ToolError(`${field} must be text.`);
  const s = field === 'body' || field === 'done_criteria' ? cleanBody(v, max) : cleanText(v, max);
  if (required && !s) throw new ToolError(`${field} cannot be empty.`);
  return s;
}

function date(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isISODate(v)) throw new ToolError(`${field} must be a date like 2026-12-31.`);
  return v as string;
}

// Mark the history rows a ChatGPT write produced.
async function tagVia(since: string) {
  await db().from('align_activity').update({ via: 'chatgpt' }).gte('at', since).is('via', null);
}

function nodeSummary(n: Record<string, unknown>, ctx: Ctx) {
  return {
    id: n.id,
    type: n.type,
    kind: NODE_KINDS[n.type as NodeType]?.label,
    title: n.title,
    status: n.status,
    ...(n.body ? { description: n.body } : {}),
    ...(n.done_criteria ? { done_when: n.done_criteria } : {}),
    ...(n.effort_minutes ? { effort_minutes: n.effort_minutes } : {}),
    ...(n.cadence ? { cadence: n.cadence } : {}),
    ...(n.start_date ? { start_date: n.start_date } : {}),
    ...(n.due_date ? { due_date: n.due_date } : {}),
    ...(n.priority ? { priority: n.priority } : {}),
    ...(n.event_date ? { event_date: n.event_date } : {}),
    ...(n.location ? { location: n.location } : {}),
    ...(n.cost !== null && n.cost !== undefined ? { cost_usd: Number(n.cost) } : {}),
    ...(n.link_url ? { link_url: n.link_url } : {}),
    ...(n.rationale ? { rationale: n.rationale } : {}),
    ...(n.hypothesis ? { hypothesis: n.hypothesis } : {}),
    ...(n.success_criteria ? { success_criteria: n.success_criteria } : {}),
    ...(n.review_date ? { review_date: n.review_date } : {}),
    ...(n.verdict ? { verdict: n.verdict, ...(n.verdict_note ? { verdict_note: n.verdict_note } : {}) } : {}),
    ready_to_do: Boolean(n.actionable),
    url: url(ctx, 'node', n.id as string),
  };
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

async function getLifeOverview(_a: Args, ctx: Ctx) {
  const [all, roots, counts, facts, inbox] = await Promise.all([
    sectors(),
    db().from('align_nodes').select('id, title, type, status, sector_id, due_date, actionable').is('parent_id', null).eq('archived', false).order('sort').limit(800),
    db().rpc('align_sector_counts'),
    db().from('align_facts').select('id', { count: 'exact', head: true }).eq('archived', false),
    db().from('align_nodes').select('id', { count: 'exact', head: true }).eq('archived', false).eq('status', 'inbox'),
  ]);
  const c = new Map(((counts.data ?? []) as { sector_id: string; pages: number; own_pages: number; overdue: number }[]).map((r) => [r.sector_id, r]));
  const rootRows = (roots.data ?? []) as { id: string; title: string; type: NodeType; status: string; sector_id: string | null }[];
  const shape = (s: Sector) => ({
    slug: s.slug,
    name: s.name,
    ...(s.summary ? { summary: s.summary } : {}),
    ...(s.importance ? { importance: s.importance } : {}),
    ...(s.satisfaction ? { satisfaction: s.satisfaction } : {}),
    ...(s.attention_needed ? { attention_needed: s.attention_needed } : {}),
    ...(s.mode ? { mode: s.mode } : {}),
    ...(s.current_state ? { current_state: s.current_state } : {}),
    ...(s.desired_state ? { desired_state: s.desired_state } : {}),
    ...(s.weekly_hours !== null && s.weekly_hours !== undefined ? { weekly_hours_budget: Number(s.weekly_hours) } : {}),
    ...(s.monthly_budget !== null && s.monthly_budget !== undefined ? { monthly_budget_usd: Number(s.monthly_budget) } : {}),
    pages_total: Number(c.get(s.id)?.pages ?? c.get(s.id)?.own_pages ?? 0),
    overdue: Number(c.get(s.id)?.overdue ?? 0),
    top_pages: rootRows.filter((r) => r.sector_id === s.id).map((r) => ({ id: r.id, kind: NODE_KINDS[r.type]?.label, title: r.title, status: r.status })),
    url: url(ctx, 'sector', s.slug),
  });
  return {
    today: todayISO(),
    sectors: all
      .filter((s) => !s.parent_id)
      .map((s) => ({ ...shape(s), areas: all.filter((a) => a.parent_id === s.id).map((a) => ({ ...shape(a), pages_total: Number(c.get(a.id)?.own_pages ?? 0) })) })),
    unfiled_pages: rootRows.filter((r) => !r.sector_id).map((r) => ({ id: r.id, title: r.title, status: r.status })),
    inbox_count: inbox.count ?? 0,
    facts_known: facts.count ?? 0,
    next: 'Call get_profile for who he is, his lifestyle vision and capacity, and check_plan before adding commitments.',
  };
}

async function searchPages(a: Args, ctx: Ctx) {
  const q = str(a.query, 120, 'query', true)!;
  const limit = Math.min(Math.max(Number(a.limit) || 20, 1), 50);
  const { data, error } = await db().rpc('align_search', { p_q: q, p_limit: limit });
  if (error) throw new ToolError('Search failed.');
  return {
    results: ((data ?? []) as { object_type: string; id: string; title: string; kind: string; status: string | null; slug: string | null; snippet: string | null }[]).map((r) => ({
      kind: r.object_type === 'sector' ? (r.kind === 'area' ? 'Area' : 'Sector') : NODE_KINDS[r.kind as NodeType]?.label,
      ...(r.object_type === 'sector' ? { sector_slug: r.slug } : { id: r.id }),
      title: r.title,
      status: r.status,
      ...(r.snippet ? { matched_note: r.snippet } : {}),
      url: r.object_type === 'sector' ? url(ctx, 'sector', r.slug!) : url(ctx, 'node', r.id),
    })),
  };
}

async function getPage(a: Args, ctx: Ctx) {
  if (a.sector_slug) {
    const s = await sectorBySlug(a.sector_slug);
    const [roots, links, notes, brain] = await Promise.all([
      db().rpc('align_children', { p_parent: null, p_sector: s.id }),
      db().rpc('align_links_for', { p_type: 'sector', p_id: s.id }),
      db().from('align_notes').select('body, created_at').eq('attached_type', 'sector').eq('attached_id', s.id).eq('archived', false).order('created_at', { ascending: false }).limit(20),
      db().from('align_brain_messages').select('data').eq('object_type', 'sector').eq('object_id', s.id).eq('role', 'brain').order('created_at', { ascending: false }).limit(1),
    ]);
    return {
      sector: {
        slug: s.slug,
        name: s.name,
        summary: s.summary,
        importance: s.importance,
        satisfaction: s.satisfaction,
        attention_needed: s.attention_needed,
        mode: s.mode,
        current_state: s.current_state ?? '',
        desired_state: s.desired_state ?? '',
        weekly_hours_budget: s.weekly_hours ?? null,
        monthly_budget_usd: s.monthly_budget ?? null,
        url: url(ctx, 'sector', s.slug),
      },
      top_pages: ((roots.data ?? []) as Record<string, unknown>[]).map((n) => ({ ...nodeSummary(n, ctx), pages_under: n.child_count })),
      links: links.data ?? [],
      notes: notes.data ?? [],
      last_brain_assessment: (brain.data?.[0]?.data as { assessment?: string } | undefined)?.assessment ?? null,
    };
  }
  const n = await nodeById(a.id);
  const [path, kids, links, notes, brain, reviews] = await Promise.all([
    db().rpc('align_node_path', { p_id: n.id }),
    db().rpc('align_children', { p_parent: n.id }),
    db().rpc('align_links_for', { p_type: 'node', p_id: n.id }),
    db().from('align_notes').select('body, created_at').eq('attached_type', 'node').eq('attached_id', n.id).eq('archived', false).order('created_at', { ascending: false }).limit(20),
    db().from('align_brain_messages').select('data').eq('object_type', 'node').eq('object_id', n.id).eq('role', 'brain').order('created_at', { ascending: false }).limit(1),
    db().from('align_reviews').select('created_at, period_start, period_end, execution, effective, verdict, summary, changes').eq('node_id', n.id).order('created_at', { ascending: false }).limit(10),
  ]);
  return {
    page: { ...nodeSummary(n, ctx), archived: n.archived },
    reviews: reviews.data ?? [],
    path_from_top: ((path.data ?? []) as { object_type: string; id: string; title: string; kind: string; slug: string | null }[]).map((c) =>
      c.object_type === 'sector' ? { sector_slug: c.slug, title: c.title } : { id: c.id, kind: NODE_KINDS[c.kind as NodeType]?.label, title: c.title },
    ),
    pages_under: ((kids.data ?? []) as Record<string, unknown>[]).map((k) => ({ ...nodeSummary(k, ctx), pages_under: k.child_count })),
    links: links.data ?? [],
    notes: notes.data ?? [],
    last_brain_assessment: (brain.data?.[0]?.data as { assessment?: string } | undefined)?.assessment ?? null,
  };
}

async function getTree(a: Args, ctx: Ctx) {
  const depth = Math.min(Math.max(Number(a.depth) || 4, 1), 8);
  const includeDone = a.include_done !== false;
  let rootIds: string[] = [];
  let top: unknown;
  if (a.sector_slug) {
    const s = await sectorBySlug(a.sector_slug);
    const ids = [s.id, ...(await sectors()).filter((x) => x.parent_id === s.id).map((x) => x.id)];
    const { data } = await db().from('align_nodes').select('id').is('parent_id', null).in('sector_id', ids).eq('archived', false);
    rootIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
    top = { sector_slug: s.slug, name: s.name };
  } else {
    const n = await nodeById(a.id);
    rootIds = [n.id];
    top = { id: n.id, title: n.title };
  }
  // Walk down level by level, capped so a huge tree stays readable.
  const byParent = new Map<string, Record<string, unknown>[]>();
  const all = new Map<string, Record<string, unknown>>();
  let frontier = rootIds;
  if (rootIds.length) {
    const { data } = await db().from('align_nodes').select(NODE_COLS).in('id', rootIds);
    for (const r of (data ?? []) as Record<string, unknown>[]) all.set(r.id as string, r);
  }
  let count = all.size;
  for (let level = 1; level < depth && frontier.length && count < 600; level++) {
    const { data } = await db().from('align_nodes').select(NODE_COLS).in('parent_id', frontier).eq('archived', false).order('sort').limit(600);
    const rows = ((data ?? []) as Record<string, unknown>[]).filter((r) => includeDone || r.status !== 'done');
    for (const r of rows) {
      all.set(r.id as string, r);
      const p = r.parent_id as string;
      byParent.set(p, [...(byParent.get(p) ?? []), r]);
    }
    count += rows.length;
    frontier = rows.map((r) => r.id as string);
  }
  const build = (id: string): unknown => {
    const n = all.get(id)!;
    const kids = byParent.get(id) ?? [];
    return { ...nodeSummary(n, ctx), ...(kids.length ? { children: kids.map((k) => build(k.id as string)) } : {}) };
  };
  return { root: top, depth, tree: rootIds.filter((id) => all.has(id)).map(build), truncated: count >= 600 };
}

async function getDue(a: Args, ctx: Ctx) {
  const days = Math.min(Math.max(Number(a.days) || 14, 1), 120);
  const today = todayISO();
  const open = ['active', 'planned', 'inbox', 'paused'];
  const [overdue, due, ready, objectives, events] = await Promise.all([
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).in('status', open).not('type', 'in', '(month,week)').lt('due_date', today).order('due_date').limit(50),
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).in('status', open).not('type', 'in', '(month,week)').gte('due_date', today).lte('due_date', addDaysISO(today, days)).order('due_date').limit(80),
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).eq('actionable', true).in('status', ['active', 'planned']).order('updated_at', { ascending: false }).limit(40),
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).eq('type', 'objective').eq('status', 'active').limit(30),
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).gte('event_date', today).order('event_date').limit(30),
  ]);
  const map = (r: { data: unknown }) => ((r.data ?? []) as Record<string, unknown>[]).map((n) => nodeSummary(n, ctx));
  const reviews = await reviewsDue(days);
  return {
    today,
    window_days: days,
    overdue: map(overdue),
    due: map(due),
    ready_to_do: map(ready),
    active_90_day_objectives: map(objectives),
    upcoming_events: map(events),
    reviews_due: reviews.map((r) => ({ id: r.id, kind: NODE_KINDS[r.type]?.label, title: r.title, review_date: r.review_date ?? r.due_date, url: url(ctx, 'node', r.id) })),
  };
}

function factOut(f: Fact, all: Sector[]) {
  const st = factState(f);
  return {
    id: f.id,
    fact: f.fact,
    kind: f.kind ?? 'fact',
    status: st,
    durability: f.durability ?? 'durable',
    ...(f.valid_until ? { valid_until: f.valid_until } : {}),
    ...(f.sensitive ? { sensitive: true } : {}),
    sector: all.find((s) => s.id === f.sector_id)?.slug ?? null,
    ...(f.node_id ? { page_id: f.node_id } : {}),
    last_confirmed: (f.confirmed_at ?? f.created_at)?.slice(0, 10) ?? null,
    source: f.source,
  };
}

async function listFacts(a: Args) {
  const [facts, all] = await Promise.all([getFacts({ includeSensitive: a.include_sensitive === true, includeArchived: false }), sectors()]);
  let list = facts;
  if (a.sector_slug) {
    const s = await sectorBySlug(a.sector_slug);
    list = list.filter((f) => f.sector_id === s.id || !f.sector_id);
  }
  if (typeof a.kind === 'string') list = list.filter((f) => (f.kind ?? 'fact') === a.kind);
  if (a.needs_attention === true) list = list.filter((f) => factState(f) !== 'confirmed');
  return { facts: list.map((f) => factOut(f, all)), hidden_sensitive: a.include_sensitive === true ? 0 : undefined };
}

async function getProfile(a: Args, ctx: Ctx) {
  const [life, capacity, facts, all, health] = await Promise.all([getLifestyle(), getCapacity(), getFacts({ includeSensitive: a.include_sensitive === true }), sectors(), planHealth()]);
  const grouped: Record<string, ReturnType<typeof factOut>[]> = {};
  for (const f of facts) (grouped[f.kind ?? 'fact'] ??= []).push(factOut(f, all));
  const name = (id: string | null) => all.find((s) => s.id === id)?.slug ?? null;
  const hours = plannableHours(capacity);
  const DAY = ['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return {
    lifestyle_vision: life.vision || null,
    non_negotiables: life.non_negotiables,
    ideal_week: life.ideal_week.map((x) => ({ day: DAY[x.day], start: hhmm(x.start), end: hhmm(x.end), label: x.label, sector: name(x.sector_id) })),
    capacity: {
      ...capacity,
      free_hours_per_week: Math.round(hours.free),
      buffer_hours: Math.round(hours.buffer),
      plannable_hours: Math.round(hours.plannable),
      planned_this_week: Math.round(health.hours.planned * 10) / 10,
    },
    sectors: all
      .filter((s) => !s.parent_id)
      .map((s) => ({
        slug: s.slug,
        name: s.name,
        importance: s.importance,
        satisfaction: s.satisfaction,
        attention_needed: s.attention_needed,
        mode: s.mode,
        current_state: s.current_state || null,
        desired_state: s.desired_state || null,
        weekly_hours_budget: s.weekly_hours ?? null,
        monthly_budget_usd: s.monthly_budget ?? null,
        url: url(ctx, 'sector', s.slug),
      })),
    facts: grouped,
    facts_needing_attention: facts.filter((f) => factState(f) !== 'confirmed').map((f) => ({ id: f.id, fact: f.fact, status: factState(f) })),
    ...(a.include_sensitive === true ? {} : { note: 'Facts Gibson marked sensitive are left out. Pass include_sensitive only when he asks or the answer depends on them.' }),
  };
}

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

interface PageInput {
  type?: unknown;
  title?: unknown;
  body?: unknown;
  done_criteria?: unknown;
  effort_minutes?: unknown;
  cadence?: unknown;
  start_date?: unknown;
  due_date?: unknown;
  priority?: unknown;
  status?: unknown;
  ready_to_do?: unknown;
  event_date?: unknown;
  location?: unknown;
  cost_usd?: unknown;
  link_url?: unknown;
  rationale?: unknown;
  hypothesis?: unknown;
  success_criteria?: unknown;
  review_date?: unknown;
  supports?: unknown;
  children?: unknown;
}

function cost(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 10_000_000) throw new ToolError('cost_usd must be a dollar amount like 95 or 129.99.');
  return Math.round(n * 100) / 100;
}

function link(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const u = cleanLink(v);
  if (u === null) throw new ToolError('link_url must be a full web address like https://runsignup.com/...');
  return u;
}

function pageRow(p: PageInput) {
  const type = p.type as NodeType;
  if (!NODE_TYPES.includes(type)) throw new ToolError(`type must be one of: ${NODE_TYPES.join(', ')}.`);
  const title = str(p.title, 300, 'title', true)!;
  const effort = p.effort_minutes === undefined || p.effort_minutes === null ? null : Number(p.effort_minutes);
  if (effort !== null && !(Number.isInteger(effort) && effort > 0 && effort <= 100000)) throw new ToolError('effort_minutes must be a whole number of minutes.');
  const priority = p.priority === undefined || p.priority === null ? null : Number(p.priority);
  if (priority !== null && ![1, 2, 3].includes(priority)) throw new ToolError('priority is 1 (high), 2 or 3 (low).');
  const status = (p.status ?? 'active') as NodeStatus;
  if (!STATUSES.includes(status)) throw new ToolError(`status must be one of: ${STATUSES.join(', ')}.`);
  const start = date(p.start_date, 'start_date') ?? null;
  const due = date(p.due_date, 'due_date') ?? null;
  if (PERIOD_TYPES.includes(type) && !start) throw new ToolError(`"${title}": a ${NODE_KINDS[type].label} needs a start_date (and usually a due_date).`);
  if (start && due && start > due) throw new ToolError(`"${title}": start_date is after due_date.`);
  const done = str(p.done_criteria, 600, 'done_criteria') ?? '';
  const rationale = str(p.rationale, 5000, 'rationale') ?? '';
  const hypothesis = str(p.hypothesis, 2000, 'hypothesis') ?? '';
  const success = str(p.success_criteria, 2000, 'success_criteria') ?? '';
  const review = date(p.review_date, 'review_date') ?? null;
  if (type === 'strategy' && !rationale) throw new ToolError(`"${title}": a Strategy needs a rationale, the reason it should move the goal.`);
  if (type === 'experiment') {
    if (!hypothesis) throw new ToolError(`"${title}": an Experiment needs a hypothesis ("If I do X for N weeks, Y will change by Z").`);
    if (!success) throw new ToolError(`"${title}": an Experiment needs success_criteria to judge it by.`);
    if (!due) throw new ToolError(`"${title}": an Experiment needs a due_date, the end of its trial window.`);
  }
  const leaf = type === 'action' || type === 'task';
  const ready = p.ready_to_do === undefined ? leaf && Boolean(done) : Boolean(p.ready_to_do);
  return {
    type,
    title,
    body: str(p.body, 5000, 'body') ?? '',
    done_criteria: done,
    effort_minutes: effort,
    cadence: str(p.cadence, 120, 'cadence') ?? '',
    start_date: start,
    due_date: due,
    priority,
    status,
    actionable: ready,
    brain_state: ready ? 'actionable' : 'untouched',
    event_date: date(p.event_date, 'event_date') ?? null,
    location: str(p.location, 200, 'location') ?? '',
    cost: cost(p.cost_usd) ?? null,
    link_url: link(p.link_url) ?? '',
    rationale,
    hypothesis,
    success_criteria: success,
    review_date: review ?? (type === 'experiment' && due ? addDaysISO(due, 1) : null),
  };
}

function countPages(list: PageInput[], depth = 0): number {
  if (depth > 7) throw new ToolError('Pages can nest at most 8 levels in one call.');
  return list.reduce((n, p) => n + 1 + (Array.isArray(p.children) ? countPages(p.children as PageInput[], depth + 1) : 0), 0);
}

async function createPages(a: Args, ctx: Ctx) {
  const pages = a.pages as PageInput[];
  if (!Array.isArray(pages) || !pages.length) throw new ToolError('pages must be a non-empty list.');
  const total = countPages(pages);
  if (total > 80) throw new ToolError(`That is ${total} pages; create at most 80 per call.`);
  // Validate everything before writing anything.
  const check = (list: PageInput[]) => list.forEach((p) => (pageRow(p), Array.isArray(p.children) && check(p.children as PageInput[])));
  check(pages);

  let parentId: string | null = null;
  let sectorId: string | null = null;
  if (a.parent_id) {
    const parent = await nodeById(a.parent_id);
    if (parent.archived) throw new ToolError('That parent page is archived. Restore it first.');
    parentId = parent.id;
  } else if (a.sector_slug) {
    sectorId = (await sectorBySlug(a.sector_slug)).id;
  } else {
    throw new ToolError('Give parent_id (to put pages under a page) or sector_slug (for the top of a sector or area).');
  }

  const since = new Date().toISOString();
  const created: unknown[] = [];
  async function insertLevel(list: PageInput[], parent: string | null, sector: string | null, out: unknown[]) {
    let q = db().from('align_nodes').select('sort').eq('archived', false).order('sort', { ascending: false }).limit(1);
    q = parent ? q.eq('parent_id', parent) : q.is('parent_id', null).eq('sector_id', sector!);
    const { data: last } = await q;
    let sort = Number(last?.[0]?.sort ?? 0);
    for (const p of list) {
      const row = pageRow(p);
      const { data, error } = await db()
        .from('align_nodes')
        .insert({ ...row, parent_id: parent, sector_id: parent ? null : sector, sort: ++sort })
        .select('id')
        .single();
      if (error || !data) throw new ToolError(`Could not create "${row.title}".`);
      const entry: Record<string, unknown> = { id: data.id, kind: NODE_KINDS[row.type].label, title: row.title, ready_to_do: row.actionable, url: url(ctx, 'node', data.id as string) };
      out.push(entry);
      if (Array.isArray(p.children) && p.children.length) {
        entry.children = [];
        await insertLevel(p.children as PageInput[], data.id as string, null, entry.children as unknown[]);
        await db().from('align_nodes').update({ brain_state: 'broken_down' }).eq('id', data.id);
      }
    }
  }
  // Never create the same page twice in the same place.
  {
    let q = db().from('align_nodes').select('id, title, type').eq('archived', false).neq('status', 'abandoned').limit(500);
    q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null).eq('sector_id', sectorId!);
    const { data: here } = await q;
    for (const p of pages) {
      const t = String(p.title ?? '').trim().toLowerCase();
      const hit = ((here ?? []) as { id: string; title: string; type: string }[]).find((x) => x.title.trim().toLowerCase() === t && x.type === p.type);
      if (hit) throw new ToolError(`"${hit.title}" already exists here (id ${hit.id}). Update or link it instead of creating it again.`);
    }
  }
  await insertLevel(pages, parentId, sectorId, created);
  if (parentId) await db().from('align_nodes').update({ brain_state: 'broken_down' }).eq('id', parentId);

  // Cross-links: one activity can support goals in several sectors.
  const linked: string[] = [];
  const linkFailures: string[] = [];
  async function linkSupports(list: PageInput[], out: unknown[]) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const entry = out[i] as { id: string; title: string; children?: unknown[] };
      if (Array.isArray(p.supports)) {
        for (const t of p.supports.slice(0, 12)) {
          try {
            const to = await resolveTarget(t);
            const { error } = await db().from('align_links').insert({ from_type: 'node', from_id: entry.id, to_type: to.type, to_id: to.id, relation: 'supports' });
            if (error && error.code !== '23505') throw new Error();
            linked.push(`${entry.title} supports ${to.title}`);
          } catch {
            linkFailures.push(`${entry.title}: could not link to ${JSON.stringify(t)}`);
          }
        }
      }
      if (Array.isArray(p.children) && entry.children) await linkSupports(p.children as PageInput[], entry.children);
    }
  }
  await linkSupports(pages, created);

  // Similar active pages elsewhere: probably the same activity planned twice.
  const flat: { title: string; type: string }[] = [];
  const walk = (list: PageInput[]) => list.forEach((p) => (flat.push({ title: String(p.title), type: String(p.type) }), Array.isArray(p.children) && walk(p.children as PageInput[])));
  walk(pages);
  const createdIds = new Set<string>();
  const collect = (list: unknown[]) => list.forEach((e) => { const x = e as { id: string; children?: unknown[] }; createdIds.add(x.id); if (x.children) collect(x.children); });
  collect(created);
  const warnings = await similarPages(flat.filter((f) => ['commitment', 'strategy', 'experiment', 'objective', 'project', 'micro_goal'].includes(f.type)), createdIds, ctx);

  await tagVia(since);
  return {
    created_count: total,
    created,
    ...(linked.length ? { linked } : {}),
    ...(linkFailures.length ? { link_failures: linkFailures } : {}),
    ...(warnings.length ? { possible_duplicates: warnings, note: 'These look like the same activity planned elsewhere. Ask Gibson whether to keep one and link it to both goals.' } : {}),
  };
}

const STOPWORDS = new Set('a an the and or of to for in on at with my your by from into per each every week weekly day daily times time minutes min do get go'.split(' '));
const titleWords = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)));

async function similarPages(list: { title: string; type: string }[], exclude: Set<string>, ctx: Ctx) {
  if (!list.length) return [];
  const { data } = await db()
    .from('align_nodes')
    .select('id, title, type, sector_id')
    .eq('archived', false)
    .in('status', ['active', 'planned', 'paused'])
    .in('type', ['commitment', 'strategy', 'experiment', 'objective', 'project', 'micro_goal', 'milestone'])
    .limit(800);
  const out: { new_title: string; existing: { id: string; title: string; kind: string; url: string } }[] = [];
  for (const p of list) {
    const w = titleWords(p.title);
    for (const n of (data ?? []) as { id: string; title: string; type: NodeType }[]) {
      if (exclude.has(n.id)) continue;
      const x = titleWords(n.title);
      let shared = 0;
      for (const k of w) if (x.has(k)) shared++;
      const union = w.size + x.size - shared;
      if (shared >= 2 && union && shared / union >= 0.5) out.push({ new_title: p.title, existing: { id: n.id, title: n.title, kind: NODE_KINDS[n.type]?.label, url: url(ctx, 'node', n.id) } });
    }
  }
  return out.slice(0, 20);
}

async function updatePage(a: Args, ctx: Ctx) {
  const n = await nodeById(a.id);
  const row: Record<string, unknown> = {};
  if (a.title !== undefined) row.title = str(a.title, 300, 'title', true);
  if (a.body !== undefined) row.body = str(a.body, 50000, 'body') ?? '';
  if (a.done_criteria !== undefined) row.done_criteria = str(a.done_criteria, 600, 'done_criteria') ?? '';
  if (a.cadence !== undefined) row.cadence = str(a.cadence, 120, 'cadence') ?? '';
  if (a.status !== undefined) {
    if (!STATUSES.includes(a.status as NodeStatus)) throw new ToolError(`status must be one of: ${STATUSES.join(', ')}.`);
    row.status = a.status;
  }
  if (a.type !== undefined) {
    if (!NODE_TYPES.includes(a.type as NodeType)) throw new ToolError(`type must be one of: ${NODE_TYPES.join(', ')}.`);
    row.type = a.type;
  }
  if (a.priority !== undefined) {
    if (a.priority !== null && ![1, 2, 3].includes(Number(a.priority))) throw new ToolError('priority is 1, 2, 3 or null.');
    row.priority = a.priority === null ? null : Number(a.priority);
  }
  if (a.effort_minutes !== undefined) {
    const e = a.effort_minutes === null ? null : Number(a.effort_minutes);
    if (e !== null && !(Number.isInteger(e) && e > 0 && e <= 100000)) throw new ToolError('effort_minutes must be whole minutes or null.');
    row.effort_minutes = e;
  }
  const s = date(a.start_date, 'start_date');
  const d = date(a.due_date, 'due_date');
  if (s !== undefined) row.start_date = s;
  if (d !== undefined) row.due_date = d;
  // Moving the start of a Month or Week moves its end with it.
  if (s && d === undefined && PERIOD_TYPES.includes((row.type ?? n.type) as NodeType)) row.due_date = null;
  const ev = date(a.event_date, 'event_date');
  if (ev !== undefined) row.event_date = ev;
  if (a.location !== undefined) row.location = str(a.location, 200, 'location') ?? '';
  const c = cost(a.cost_usd);
  if (c !== undefined) row.cost = c;
  const l = link(a.link_url);
  if (l !== undefined) row.link_url = l;
  if (a.rationale !== undefined) row.rationale = str(a.rationale, 5000, 'rationale') ?? '';
  if (a.hypothesis !== undefined) row.hypothesis = str(a.hypothesis, 2000, 'hypothesis') ?? '';
  if (a.success_criteria !== undefined) row.success_criteria = str(a.success_criteria, 2000, 'success_criteria') ?? '';
  const rv = date(a.review_date, 'review_date');
  if (rv !== undefined) row.review_date = rv;
  const start = (row.start_date !== undefined ? row.start_date : n.start_date) as string | null;
  const due = (row.due_date !== undefined ? row.due_date : n.due_date) as string | null;
  if (start && due && start > due) throw new ToolError('start_date is after due_date.');
  if (a.ready_to_do !== undefined) {
    row.actionable = Boolean(a.ready_to_do);
    if (row.actionable) row.brain_state = 'actionable';
  }
  if (!Object.keys(row).length) throw new ToolError('Nothing to change.');
  const since = new Date().toISOString();
  const { error } = await db().from('align_nodes').update(row).eq('id', n.id);
  if (error) throw new ToolError('Could not save the change.');
  await tagVia(since);
  const fresh = await nodeById(n.id);
  return { updated: nodeSummary(fresh, ctx) };
}

async function movePage(a: Args, ctx: Ctx) {
  const n = await nodeById(a.id);
  let parent: string | null = null;
  let sector: string | null = null;
  if (a.new_parent_id) parent = (await nodeById(a.new_parent_id)).id;
  else if (a.sector_slug) sector = (await sectorBySlug(a.sector_slug)).id;
  else throw new ToolError('Give new_parent_id or sector_slug.');
  const since = new Date().toISOString();
  const { error } = await db().rpc('align_move_node', { p_id: n.id, p_parent: parent, p_sector: sector });
  if (error) throw new ToolError(error.message?.includes('own pages') ? 'A page cannot go under one of its own pages.' : 'Could not move it.');
  await tagVia(since);
  return { moved: { id: n.id, title: n.title, url: url(ctx, 'node', n.id) } };
}

async function archivePage(a: Args) {
  const n = await nodeById(a.id);
  const restore = a.restore === true;
  const since = new Date().toISOString();
  const { data, error } = await db().rpc('align_archive_node', { p_id: n.id, p_archived: !restore });
  if (error) throw new ToolError('Could not change it.');
  await tagVia(since);
  return { [restore ? 'restored' : 'archived']: n.title, pages_affected: data };
}

async function resolveTarget(t: unknown): Promise<{ type: 'node' | 'sector'; id: string; title: string }> {
  const o = (t ?? {}) as { id?: unknown; sector_slug?: unknown };
  if (o.sector_slug) {
    const s = await sectorBySlug(o.sector_slug);
    return { type: 'sector', id: s.id, title: s.name };
  }
  const n = await nodeById(o.id);
  return { type: 'node', id: n.id, title: n.title };
}

async function linkPages(a: Args) {
  const from = await resolveTarget(a.from);
  const to = await resolveTarget(a.to);
  const relation = (a.relation ?? 'related') as Relation;
  if (!RELATIONS.includes(relation)) throw new ToolError(`relation must be one of: ${RELATIONS.join(', ')}.`);
  if (from.type === to.type && from.id === to.id) throw new ToolError('A page cannot link to itself.');
  const since = new Date().toISOString();
  const { error } = await db().from('align_links').insert({ from_type: from.type, from_id: from.id, to_type: to.type, to_id: to.id, relation });
  if (error) throw new ToolError(error.code === '23505' ? 'They are already linked.' : 'Could not link them.');
  await tagVia(since);
  return { linked: `${from.title} ${relation.replace('_', ' ')} ${to.title}` };
}

async function addNote(a: Args) {
  const t = await resolveTarget(a);
  const body = str(a.body, 20000, 'body', true)!;
  const since = new Date().toISOString();
  const { error } = await db().from('align_notes').insert({ attached_type: t.type, attached_id: t.id, body });
  if (error) throw new ToolError('Could not save the note.');
  await tagVia(since);
  return { note_added_to: t.title };
}

type FactInput = { fact?: unknown; kind?: unknown; confirmed?: unknown; temporary?: unknown; valid_until?: unknown; sensitive?: unknown; sector_slug?: unknown; page_id?: unknown; replaces_id?: unknown };

async function factRow(item: unknown, defaultSector: string | null) {
  const o: FactInput = typeof item === 'string' ? { fact: item } : ((item ?? {}) as FactInput);
  const fact = cleanText(String(o.fact ?? ''), 500);
  if (!fact) throw new ToolError('Every fact needs text.');
  const kind = (o.kind ?? 'fact') as FactKind;
  if (!FACT_KIND_VALUES.includes(kind)) throw new ToolError(`kind must be one of: ${FACT_KIND_VALUES.join(', ')}.`);
  const until = date(o.valid_until, 'valid_until') ?? null;
  const temporary = o.temporary === true || Boolean(until);
  const verified = kind === 'assumption' ? false : o.confirmed !== false;
  const sectorId = o.sector_slug ? (await sectorBySlug(o.sector_slug)).id : defaultSector;
  const nodeId = o.page_id ? (await nodeById(o.page_id)).id : null;
  return {
    row: {
      fact,
      kind,
      verified,
      durability: temporary ? 'temporary' : 'durable',
      valid_until: until,
      sensitive: o.sensitive === true,
      sector_id: sectorId,
      node_id: nodeId,
      source: 'chatgpt',
      confirmed_at: verified ? new Date().toISOString() : null,
    },
    replaces: isId(o.replaces_id) ? (o.replaces_id as string) : null,
  };
}

async function saveFacts(a: Args) {
  const items = Array.isArray(a.facts) ? (a.facts as unknown[]) : [];
  if (!items.length) throw new ToolError('facts must be a list: plain statements, or objects with fact, kind, confirmed, temporary, valid_until, sensitive.');
  if (items.length > 60) throw new ToolError('Save at most 60 facts per call.');
  const defaultSector = a.sector_slug ? (await sectorBySlug(a.sector_slug)).id : null;
  const rows = [];
  for (const it of items) rows.push(await factRow(it, defaultSector));
  const { data: known } = await db().from('align_facts').select('id, fact').eq('archived', false).limit(3000);
  const have = new Map(((known ?? []) as { id: string; fact: string }[]).map((f) => [f.fact.toLowerCase().trim(), f.id]));
  const since = new Date().toISOString();
  let saved = 0;
  let replaced = 0;
  const already: string[] = [];
  for (const { row, replaces } of rows) {
    const dup = have.get(row.fact.toLowerCase().trim());
    if (dup && !replaces) {
      // Saying it again confirms it.
      if (row.verified) await db().from('align_facts').update({ confirmed_at: new Date().toISOString(), verified: true }).eq('id', dup);
      already.push(row.fact);
      continue;
    }
    const { data, error } = await db().from('align_facts').insert({ ...row, supersedes: replaces }).select('id').single();
    if (error || !data) throw new ToolError(`Could not save "${row.fact}".`);
    if (replaces) {
      await db().from('align_facts').update({ archived: true }).eq('id', replaces);
      replaced++;
    }
    have.set(row.fact.toLowerCase().trim(), data.id as string);
    saved++;
  }
  await tagVia(since);
  return { saved, replaced, already_known_and_reconfirmed: already.length };
}

async function updateFacts(a: Args) {
  const list = Array.isArray(a.updates) ? (a.updates as Record<string, unknown>[]) : [];
  if (!list.length) throw new ToolError('updates must be a list of { id, ... }.');
  if (list.length > 100) throw new ToolError('At most 100 per call.');
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const u of list) {
    try {
      if (!isId(u.id)) throw new ToolError('id is required.');
      if (u.archive === true) {
        const { error } = await db().from('align_facts').update({ archived: true }).eq('id', u.id);
        if (error) throw new ToolError('Could not archive it.');
        results.push({ id: u.id, ok: true });
        continue;
      }
      const row: Record<string, unknown> = {};
      if (u.fact !== undefined) {
        const f = cleanText(String(u.fact ?? ''), 500);
        if (!f) throw new ToolError('fact cannot be empty.');
        row.fact = f;
      }
      if (u.kind !== undefined) {
        if (!FACT_KIND_VALUES.includes(u.kind as FactKind)) throw new ToolError(`kind must be one of: ${FACT_KIND_VALUES.join(', ')}.`);
        row.kind = u.kind;
      }
      if (u.confirmed !== undefined) {
        row.verified = u.confirmed === true;
        if (u.confirmed === true) {
          row.confirmed_at = new Date().toISOString();
          if (u.kind === undefined) {
            const { data: cur } = await db().from('align_facts').select('kind').eq('id', u.id).maybeSingle();
            if (cur?.kind === 'assumption') row.kind = 'fact';
          }
        }
      }
      if (u.temporary !== undefined) row.durability = u.temporary === true ? 'temporary' : 'durable';
      const vu = date(u.valid_until, 'valid_until');
      if (vu !== undefined) {
        row.valid_until = vu;
        if (vu) row.durability = 'temporary';
      }
      if (u.sensitive !== undefined) row.sensitive = u.sensitive === true;
      if (u.sector_slug !== undefined) row.sector_id = u.sector_slug ? (await sectorBySlug(u.sector_slug)).id : null;
      if (!Object.keys(row).length) throw new ToolError('Nothing to change.');
      const { error } = await db().from('align_facts').update(row).eq('id', u.id);
      if (error) throw new ToolError('Could not save.');
      results.push({ id: u.id, ok: true });
    } catch (e) {
      results.push({ id: String(u.id), ok: false, error: e instanceof ToolError ? e.message : 'Failed.' });
    }
  }
  return { updated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
}

async function setLifestyle(a: Args) {
  const cur = await getLifestyle();
  const next = { ...cur };
  if (a.vision !== undefined) next.vision = cleanBody(String(a.vision ?? ''), 8000);
  if (a.non_negotiables !== undefined) {
    if (!Array.isArray(a.non_negotiables)) throw new ToolError('non_negotiables is a list of short statements.');
    next.non_negotiables = (a.non_negotiables as unknown[]).map((x) => cleanText(String(x ?? ''), 200)).filter(Boolean).slice(0, 30);
  }
  if (a.ideal_week !== undefined) {
    if (!Array.isArray(a.ideal_week)) throw new ToolError('ideal_week is a list of { day, start, end, label, sector_slug }.');
    const all = await sectors();
    const slots = (a.ideal_week as Record<string, unknown>[]).map((x, i) => {
      const day = typeof x.day === 'number' ? x.day : DAY_KEYS[String(x.day ?? '').slice(0, 3).toLowerCase()];
      const start = parseClock(x.start);
      const end = parseClock(x.end);
      if (!day || start === null || end === null || end <= start) throw new ToolError(`ideal_week[${i}] needs day (mon to sun), start and end like "06:00" and "07:00".`);
      const sector = x.sector_slug ? all.find((s) => s.slug === String(x.sector_slug)) : null;
      if (x.sector_slug && !sector) throw new ToolError(`ideal_week[${i}]: no sector "${x.sector_slug}".`);
      return { day, start, end, label: cleanText(String(x.label ?? ''), 80), sector_id: sector?.id ?? null };
    });
    next.ideal_week = cleanSlots(slots);
  }
  const since = new Date().toISOString();
  await saveLifestyle(next);
  await tagVia(since);
  return { saved: true, ideal_week_blocks: next.ideal_week.length, non_negotiables: next.non_negotiables.length };
}

async function setCapacity(a: Args) {
  const cur = await getCapacity();
  const next: Capacity = { ...cur };
  const numIn = (v: unknown, f: string, lo: number, hi: number) => {
    if (v === null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new ToolError(`${f} must be between ${lo} and ${hi}.`);
    return n;
  };
  if (a.work_hours_per_week !== undefined) next.work_hours_per_week = numIn(a.work_hours_per_week, 'work_hours_per_week', 0, 120);
  if (a.buffer_percent !== undefined) next.buffer_percent = numIn(a.buffer_percent, 'buffer_percent', 0, 90) ?? 25;
  if (a.max_day_hours !== undefined) next.max_day_hours = numIn(a.max_day_hours, 'max_day_hours', 1, 18) ?? 10;
  if (a.monthly_discretionary_usd !== undefined) next.monthly_discretionary_usd = numIn(a.monthly_discretionary_usd, 'monthly_discretionary_usd', 0, 10_000_000);
  if (a.peak_energy !== undefined) next.peak_energy = cleanText(String(a.peak_energy ?? ''), 200);
  if (a.energy_notes !== undefined) next.energy_notes = cleanBody(String(a.energy_notes ?? ''), 2000);
  await saveCapacity(next);
  const h = plannableHours(next);
  return { saved: next, free_hours_per_week: Math.round(h.free), plannable_hours_per_week: Math.round(h.plannable) };
}

async function checkPlan(a: Args, ctx: Ctx) {
  const anchor = (date(a.week_of, 'week_of') ?? todayISO()) as string;
  const h = await planHealth(anchor);
  return {
    week_of: h.weekOf,
    capacity_set: h.configured,
    hours: Object.fromEntries(Object.entries(h.hours).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    by_day: h.byDay.map((d) => ({ date: d.date, planned_hours: Math.round((d.minutes / 60) * 10) / 10, blocks: d.blocks })),
    by_sector: h.bySector.filter((s) => s.minutes || s.budget_hours !== null).map((s) => ({ sector: s.name, planned_hours: Math.round((s.minutes / 60) * 10) / 10, budget_hours: s.budget_hours, mode: s.mode })),
    money_this_month: h.money,
    issues: h.issues.map((i) => ({ ...i, ...(i.page_ids ? { urls: i.page_ids.map((id) => url(ctx, 'node', id)) } : {}) })),
    ...(!h.configured ? { note: 'Work hours are not set, so free time is overstated. Ask Gibson and call set_capacity.' } : {}),
  };
}

async function discoveryBrief(_a: Args, ctx: Ctx) {
  const [all, facts, life, capacity, counts, roots] = await Promise.all([
    sectors(),
    getFacts(),
    getLifestyle(),
    getCapacity(),
    db().rpc('align_sector_counts'),
    db().from('align_nodes').select('sector_id, type, status').is('parent_id', null).eq('archived', false).limit(1000),
  ]);
  const c = new Map(((counts.data ?? []) as { sector_id: string; pages: number }[]).map((r) => [r.sector_id, Number(r.pages ?? 0)]));
  const rootRows = (roots.data ?? []) as { sector_id: string | null; type: NodeType; status: string }[];
  const tops = all.filter((s) => !s.parent_id);
  const sectorsOut = tops
    .map((s) => {
      const has = (t: NodeType) => rootRows.some((r) => r.sector_id === s.id && r.type === t && r.status !== 'abandoned');
      const gaps: string[] = [];
      if (!s.importance || !s.satisfaction) gaps.push('not rated');
      if (!s.current_state) gaps.push('current state unknown');
      if (!s.desired_state) gaps.push('desired state unknown');
      if (!has('vision')) gaps.push('no five-year vision');
      if (!has('objective') && !has('milestone')) gaps.push('no milestone or objective');
      return {
        slug: s.slug,
        name: s.name,
        importance: s.importance,
        satisfaction: s.satisfaction,
        gap_score: s.importance && s.satisfaction ? s.importance - s.satisfaction : null,
        facts_known: facts.filter((f) => f.sector_id === s.id).length,
        pages: c.get(s.id) ?? 0,
        missing: gaps,
        url: url(ctx, 'sector', s.slug),
      };
    })
    .sort((x, y) => (y.gap_score ?? -99) - (x.gap_score ?? -99) || y.missing.length - x.missing.length);
  const kinds = Object.fromEntries(FACT_KIND_VALUES.map((k) => [k, facts.filter((f) => (f.kind ?? 'fact') === k).length]));
  const profile_gaps: string[] = [];
  if (!life.vision) profile_gaps.push('No lifestyle vision: what an ordinary great week looks like in 3 to 5 years.');
  if (!life.ideal_week.length) profile_gaps.push('No ideal week laid out.');
  if (capacity.work_hours_per_week === null) profile_gaps.push('Work hours per week unknown, so capacity cannot be checked.');
  if (!capacity.peak_energy) profile_gaps.push('Peak energy time unknown.');
  if (capacity.monthly_discretionary_usd === null) profile_gaps.push('Monthly discretionary money unknown.');
  for (const k of ['value', 'constraint', 'resource', 'environment', 'community', 'routine'] as const) if (!kinds[k]) profile_gaps.push(`No ${k} facts yet.`);
  return {
    how_to_use:
      'Ask adaptive questions one or two at a time, starting where the gap between importance and satisfaction is largest and where the profile is thinnest. Look for overlooked goals, problems and opportunities, not only what he already said he wants. Save answers with save_facts (marking kind, and whether confirmed or temporary), update_sector for current and desired state, set_lifestyle and set_capacity.',
    sectors_by_gap: sectorsOut,
    profile_gaps,
    facts_by_kind: kinds,
    facts_to_confirm: facts.filter((f) => factState(f) !== 'confirmed').slice(0, 30).map((f) => ({ id: f.id, fact: f.fact, status: factState(f) })),
  };
}

async function getReviewEvidence(a: Args, ctx: Ctx) {
  const n = await nodeById(a.page_id);
  const ev = await reviewEvidence(n.id, (date(a.from, 'from') ?? null) as string | null, (date(a.to, 'to') ?? null) as string | null);
  return { ...ev, url: url(ctx, 'node', n.id) };
}

async function recordReview(a: Args, ctx: Ctx) {
  const n = await nodeById(a.page_id);
  const verdict = String(a.verdict ?? '');
  if (!VERDICTS.includes(verdict as (typeof VERDICTS)[number])) throw new ToolError(`verdict is one of: ${VERDICTS.join(', ')}.`);
  const effective = a.effective === undefined ? 'unclear' : String(a.effective);
  if (!['yes', 'partly', 'no', 'unclear'].includes(effective)) throw new ToolError('effective is yes, partly, no or unclear.');
  const summary = str(a.summary, 5000, 'body', true)!;
  const next = date(a.next_review_date, 'next_review_date');
  if (verdict === 'replace' && !a.replacement) throw new ToolError('A replace verdict needs replacement: the new strategy or experiment page (same shape as create_pages).');
  if (a.replacement) pageRow(a.replacement as PageInput);
  const ev = await reviewEvidence(n.id, (date(a.from, 'from') ?? null) as string | null, (date(a.to, 'to') ?? null) as string | null);
  const since = new Date().toISOString();
  const { data, error } = await db()
    .from('align_reviews')
    .insert({
      node_id: n.id,
      period_start: ev.period.from,
      period_end: ev.period.to,
      execution: ev.execution,
      effective,
      verdict,
      summary,
      changes: str(a.changes, 5000, 'body') ?? '',
      evidence: { actions: ev.actions, calendar: ev.calendar, habits: ev.habits, measures: ev.measures, diagnosis: ev.diagnosis },
      source: 'chatgpt',
    })
    .select('id')
    .single();
  if (error || !data) throw new ToolError('Could not save the review.');
  const out: Record<string, unknown> = { review_id: data.id, verdict, execution: ev.execution, diagnosis: ev.diagnosis };
  if (verdict === 'continue' || verdict === 'modify') {
    if (next !== undefined) await db().from('align_nodes').update({ review_date: next }).eq('id', n.id);
  } else {
    // Stopped or replaced: the page and its reasoning stay, marked abandoned, open work under it is paused.
    await db().from('align_nodes').update({ status: 'abandoned', review_date: null }).eq('id', n.id);
    const { data: kids } = await db().from('align_nodes').select('id').eq('parent_id', n.id).in('status', ['active', 'planned', 'inbox']).eq('archived', false);
    const ids = ((kids ?? []) as { id: string }[]).map((k) => k.id);
    if (ids.length && a.keep_children_running !== true) await db().from('align_nodes').update({ status: 'paused' }).in('id', ids);
    out.paused_under_it = a.keep_children_running === true ? 0 : ids.length;
  }
  if (verdict === 'replace' && a.replacement) {
    const res = (await createPages({ parent_id: n.parent_id ?? undefined, sector_slug: n.parent_id ? undefined : (await sectors()).find((s) => s.id === n.sector_id)?.slug, pages: [a.replacement] }, ctx)) as { created: { id: string }[] };
    const newId = res.created[0]?.id;
    if (newId) await db().from('align_links').insert({ from_type: 'node', from_id: newId, to_type: 'node', to_id: n.id, relation: 'related' });
    out.replacement = res.created[0];
  }
  await tagVia(since);
  return { ...out, url: url(ctx, 'node', n.id) };
}

async function updateMeasureTool(a: Args, ctx: Ctx) {
  const measures = await getMeasures();
  const m = measures.find((x) => x.id === a.measure_id) ?? (a.name && !a.measure_id ? measures.find((x) => x.name.toLowerCase() === String(a.name).toLowerCase()) : undefined);
  if (!m) throw new ToolError('No measure found. Pass measure_id (see get_progress).');
  const row: Record<string, unknown> = { ...modelFields(a) };
  if (a.new_name !== undefined) row.name = str(a.new_name, 120, 'name', true);
  if (a.unit !== undefined) row.unit = str(a.unit, 24, 'unit') ?? '';
  for (const k of ['start_value', 'target_value'] as const) {
    if (a[k] === undefined) continue;
    if (a[k] === null) row[k] = null;
    else if (!Number.isFinite(Number(a[k]))) throw new ToolError(`${k} must be a number.`);
    else row[k] = Number(a[k]);
  }
  const td = date(a.target_date, 'target_date');
  if (td !== undefined) row.target_date = td;
  if (a.better !== undefined) row.direction = a.better === 'lower' ? 'down' : 'up';
  if (a.page_id !== undefined) row.node_id = a.page_id ? (await nodeById(a.page_id)).id : null;
  if (a.archive === true) row.archived = true;
  if (!Object.keys(row).length) throw new ToolError('Nothing to change.');
  const since = new Date().toISOString();
  const { error } = await db().from('align_measures').update(row).eq('id', m.id);
  if (error) throw new ToolError('Could not save the measure.');
  await tagVia(since);
  const [fresh] = (await getMeasures()).filter((x) => x.id === m.id);
  return { measure: fresh ? measureOut(fresh, ctx) : { archived: true } };
}

// The model behind a target: baseline, curve, assumptions, scenarios, method.
function modelFields(a: Args): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const bd = date(a.baseline_date, 'baseline_date');
  if (bd !== undefined) row.baseline_date = bd;
  if (a.curve !== undefined) {
    if (!['linear', 'front_loaded', 'back_loaded', 'compound'].includes(String(a.curve))) throw new ToolError('curve is linear, front_loaded, back_loaded or compound.');
    row.curve = a.curve;
  }
  if (a.assumptions !== undefined) {
    if (!Array.isArray(a.assumptions)) throw new ToolError('assumptions is a list of { text, confirmed }.');
    row.assumptions = (a.assumptions as unknown[]).slice(0, 20).map((x) => {
      const o = typeof x === 'string' ? { text: x, confirmed: false } : (x as { text?: unknown; confirmed?: unknown });
      return { text: cleanText(String(o.text ?? ''), 300), confirmed: o.confirmed === true };
    }).filter((x) => x.text);
  }
  if (a.scenarios !== undefined) {
    if (!a.scenarios || typeof a.scenarios !== 'object') throw new ToolError('scenarios is { conservative, realistic, ambitious }, each { value, note }.');
    const out: Record<string, { value: number | null; note: string }> = {};
    for (const k of ['conservative', 'realistic', 'ambitious']) {
      const v = (a.scenarios as Record<string, { value?: unknown; note?: unknown }>)[k];
      if (!v) continue;
      const val = v.value === null || v.value === undefined ? null : Number(v.value);
      if (val !== null && !Number.isFinite(val)) throw new ToolError(`scenarios.${k}.value must be a number.`);
      out[k] = { value: val, note: cleanText(String(v.note ?? ''), 400) };
    }
    row.scenarios = out;
  }
  if (a.method !== undefined) row.method = cleanBody(String(a.method ?? ''), 5000);
  return row;
}

async function updateSector(a: Args, ctx: Ctx) {
  const s = await sectorBySlug(a.sector_slug);
  const row: Record<string, unknown> = {};
  if (a.summary !== undefined) row.summary = cleanBody(String(a.summary ?? ''), 5000);
  for (const k of ['importance', 'satisfaction', 'attention_needed'] as const) {
    if (a[k] === undefined) continue;
    const v = a[k] === null ? null : Number(a[k]);
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 10)) throw new ToolError(`${k} is 1 to 10 or null.`);
    row[k] = v;
  }
  if (a.mode !== undefined) {
    if (a.mode !== null && !['priority', 'maintain'].includes(a.mode as string)) throw new ToolError('mode is "priority", "maintain" or null.');
    row.mode = a.mode;
  }
  if (a.current_state !== undefined) row.current_state = cleanBody(String(a.current_state ?? ''), 5000);
  if (a.desired_state !== undefined) row.desired_state = cleanBody(String(a.desired_state ?? ''), 5000);
  if (a.weekly_hours !== undefined) {
    const v = a.weekly_hours === null ? null : Number(a.weekly_hours);
    if (v !== null && !(Number.isFinite(v) && v >= 0 && v <= 168)) throw new ToolError('weekly_hours is 0 to 168 or null.');
    row.weekly_hours = v;
  }
  if (a.monthly_budget_usd !== undefined) {
    const v = a.monthly_budget_usd === null ? null : Number(a.monthly_budget_usd);
    if (v !== null && !(Number.isFinite(v) && v >= 0)) throw new ToolError('monthly_budget_usd is a dollar amount or null.');
    row.monthly_budget = v;
  }
  if (!Object.keys(row).length) throw new ToolError('Nothing to change.');
  const since = new Date().toISOString();
  const { error } = await db().from('align_sectors').update(row).eq('id', s.id);
  if (error) throw new ToolError('Could not save.');
  await tagVia(since);
  return { updated: s.name, url: url(ctx, 'sector', s.slug) };
}

async function createArea(a: Args, ctx: Ctx) {
  const parent = await sectorBySlug(a.sector_slug);
  if (parent.parent_id) throw new ToolError('Areas go under a top-level sector, not under another area.');
  const name = str(a.name, 80, 'name', true)!;
  const base = `${parent.slug}-${slugify(name) || 'area'}`.slice(0, 64).replace(/-+$/, '');
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const { data } = await db().from('align_sectors').select('id').eq('slug', slug).maybeSingle();
    if (!data) break;
    slug = `${base}-${i}`;
  }
  const since = new Date().toISOString();
  const { error } = await db().from('align_sectors').insert({ slug, name, parent_id: parent.id, colour: parent.colour, sort: 100 });
  if (error) throw new ToolError('Could not add the area.');
  await tagVia(since);
  return { created_area: { slug, name, url: url(ctx, 'sector', slug) } };
}

// ---------------------------------------------------------------------------
// Schedule and bulk tools
// ---------------------------------------------------------------------------

async function getSchedule(a: Args, ctx: Ctx) {
  const today = todayISO();
  const from = (date(a.from, 'from') ?? today) as string;
  const to = (date(a.to, 'to') ?? addDaysISO(from, 13)) as string;
  if (to < from) throw new ToolError('to is before from.');
  if (addDaysISO(from, 92) < to) throw new ToolError('Ask for at most 93 days at a time.');
  const open = ['active', 'planned', 'inbox', 'paused'];
  const statuses = a.include_done === true ? [...open, 'done'] : open;
  const [dated, periods, events, overdue] = await Promise.all([
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).in('status', statuses).not('type', 'in', '(month,week)').gte('due_date', from).lte('due_date', to).order('due_date').order('sort').limit(400),
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).in('status', statuses).in('type', PERIOD_TYPES).lte('start_date', to).gte('due_date', from).order('start_date').limit(100),
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).gte('event_date', from).lte('event_date', to).order('event_date').limit(100),
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).in('status', open).not('type', 'in', '(month,week)').lt('due_date', today).order('due_date').limit(60),
  ]);
  if (dated.error || periods.error || events.error || overdue.error) throw new ToolError('Could not load the schedule.');
  const timed = await blocksBetween(from, to);
  const rows = [...(dated.data ?? []), ...(periods.data ?? []), ...(events.data ?? []), ...(overdue.data ?? [])] as Record<string, unknown>[];
  // What each item serves, so the schedule reads in context.
  const parentIds = [...new Set(rows.map((r) => r.parent_id as string | null).filter(Boolean))] as string[];
  const parents = new Map<string, { title: string; type: NodeType }>();
  if (parentIds.length) {
    const { data } = await db().from('align_nodes').select('id, title, type').in('id', parentIds.slice(0, 500));
    for (const p of (data ?? []) as { id: string; title: string; type: NodeType }[]) parents.set(p.id, p);
  }
  const all = await sectors();
  const sectorName = (id: unknown) => {
    const s = all.find((x) => x.id === id);
    const top = s?.parent_id ? all.find((x) => x.id === s.parent_id) : s;
    return top ? (s && s.id !== top.id ? `${top.name} / ${s.name}` : top.name) : null;
  };
  const shape = (r: Record<string, unknown>) => {
    const parent = r.parent_id ? parents.get(r.parent_id as string) : undefined;
    return { ...nodeSummary(r, ctx), sector: sectorName(r.sector_id), ...(parent ? { part_of: `${NODE_KINDS[parent.type]?.label}: ${parent.title}` } : {}) };
  };
  const days: { date: string; weekday: string; items: ReturnType<typeof shape>[]; timed: ReturnType<typeof blockOut>[]; events: ReturnType<typeof shape>[] }[] = [];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    days.push({
      date: d,
      weekday: new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      items: ((dated.data ?? []) as Record<string, unknown>[]).filter((r) => r.due_date === d).map(shape),
      timed: timed.filter((b) => utcToZoned(b.start_at).date === d).map((b) => blockOut(b, ctx)),
      events: ((events.data ?? []) as Record<string, unknown>[]).filter((r) => r.event_date === d).map(shape),
    });
  }
  return {
    today,
    from,
    to,
    overdue: ((overdue.data ?? []) as Record<string, unknown>[]).map(shape),
    months_and_weeks: ((periods.data ?? []) as Record<string, unknown>[]).map(shape),
    days: days.map((d) => ({ ...d, planned_minutes: d.items.reduce((m, i) => m + (Number(i.effort_minutes) || 0), 0) })),
    note: 'items are pages dated by due_date; timed are blocks on the calendar with exact times (America/New_York).',
  };
}

async function updatePages(a: Args, ctx: Ctx) {
  const list = a.updates as Args[];
  if (!Array.isArray(list) || !list.length) throw new ToolError('updates must be a non-empty list of { id, ...fields }.');
  if (list.length > 100) throw new ToolError('Update at most 100 pages per call.');
  const updated: unknown[] = [];
  const failed: { id: unknown; error: string }[] = [];
  for (const u of list) {
    try {
      const res = (await updatePage(u ?? {}, ctx)) as { updated: { id: string; title: string; status: string } };
      updated.push({ id: res.updated.id, title: res.updated.title, status: res.updated.status });
    } catch (e) {
      failed.push({ id: u?.id, error: e instanceof ToolError ? e.message : 'Could not save.' });
    }
  }
  return { updated_count: updated.length, updated, ...(failed.length ? { failed } : {}) };
}

async function shiftDates(a: Args) {
  const ids = (Array.isArray(a.ids) ? a.ids : a.id ? [a.id] : []) as unknown[];
  if (!ids.length) throw new ToolError('Give id or ids of the pages to shift.');
  if (ids.length > 100) throw new ToolError('Shift at most 100 pages per call (children come along automatically).');
  for (const id of ids) if (!isId(id)) throw new ToolError(`${String(id)} is not a valid page id.`);
  const days = Number(a.days);
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 730) throw new ToolError('days is a whole number from -730 to 730, not 0.');
  const since = new Date().toISOString();
  const { data, error } = await db().rpc('align_shift_dates', {
    p_ids: ids,
    p_days: days,
    p_with_children: a.include_children !== false,
    p_open_only: a.include_done !== true,
  });
  if (error) throw new ToolError('Could not shift the dates.');
  await tagVia(since);
  return { pages_shifted: Number(data ?? 0), by_days: days, note: 'Event dates are never moved.' };
}

// ---------------------------------------------------------------------------
// Calendar tools. Times are wall-clock "HH:MM" in Gibson's time zone (America/New_York).
// ---------------------------------------------------------------------------

const BLOCK_SELECT = 'id, node_id, sector_id, title, notes, start_at, end_at, status, source';
type BlockRow = { id: string; node_id: string | null; sector_id: string | null; title: string; notes: string; start_at: string; end_at: string; status: string; source: string };

async function blocksBetween(from: string, to: string): Promise<(BlockRow & { page_title?: string; page_type?: NodeType; sector_name?: string })[]> {
  const { data, error } = await db()
    .from('align_blocks')
    .select(BLOCK_SELECT)
    .lt('start_at', zonedToUtc(addDaysISO(to, 1), 0).toISOString())
    .gt('end_at', zonedToUtc(from, 0).toISOString())
    .order('start_at')
    .limit(1000);
  if (error) throw new ToolError('Could not load the calendar.');
  const rows = (data ?? []) as (BlockRow & { page_title?: string; page_type?: NodeType; sector_name?: string })[];
  if (rows.some((r) => r.sector_id)) {
    const all = await sectors();
    for (const r of rows) {
      const s = all.find((x) => x.id === r.sector_id);
      const p = s?.parent_id ? all.find((x) => x.id === s.parent_id) : null;
      if (s) r.sector_name = p ? `${p.name} / ${s.name}` : s.name;
    }
  }
  const ids = [...new Set(rows.map((r) => r.node_id).filter(Boolean))] as string[];
  if (ids.length) {
    const { data: nodes } = await db().from('align_nodes').select('id, title, type').in('id', ids);
    const map = new Map(((nodes ?? []) as { id: string; title: string; type: NodeType }[]).map((n) => [n.id, n]));
    for (const r of rows) {
      const n = r.node_id ? map.get(r.node_id) : undefined;
      if (n) {
        r.page_title = n.title;
        r.page_type = n.type;
      }
    }
  }
  return rows;
}

function blockOut(b: BlockRow & { page_title?: string; page_type?: NodeType; sector_name?: string }, ctx: Ctx) {
  const a = utcToZoned(b.start_at);
  const z = utcToZoned(b.end_at);
  const minutes = Math.round((new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000);
  return {
    id: b.id,
    title: b.title || b.page_title || 'Untitled',
    date: a.date,
    start: hhmm(a.minutes),
    end: z.date === a.date ? hhmm(z.minutes) : `${z.date} ${hhmm(z.minutes)}`,
    minutes,
    status: b.status,
    ...(b.sector_name ? { sector: b.sector_name } : {}),
    ...(b.node_id ? { page_id: b.node_id, page_kind: b.page_type ? NODE_KINDS[b.page_type]?.label : undefined, page_url: url(ctx, 'node', b.node_id) } : {}),
    ...(b.notes ? { notes: b.notes } : {}),
  };
}

// Wall-clock pieces of each block, per day, for finding gaps.
function busyByDay(rows: BlockRow[]): Map<string, [number, number][]> {
  const m = new Map<string, [number, number][]>();
  for (const b of rows) {
    if (b.status === 'skipped') continue;
    const a = utcToZoned(b.start_at);
    const z = utcToZoned(b.end_at);
    for (let d = a.date; d <= z.date; d = addDaysISO(d, 1)) {
      const s = d === a.date ? a.minutes : 0;
      const e = d === z.date ? z.minutes : 1440;
      if (e > s) m.set(d, [...(m.get(d) ?? []), [s, e]]);
    }
  }
  return m;
}

function gaps(busy: [number, number][], dayStart: number, dayEnd: number) {
  const out: { start: string; end: string; minutes: number }[] = [];
  let cur = dayStart;
  for (const [s, e] of [...busy].sort((x, y) => x[0] - y[0])) {
    if (e <= cur) continue;
    if (s >= dayEnd) break;
    if (s > cur && s - cur >= 15) out.push({ start: hhmm(cur), end: hhmm(Math.min(s, dayEnd)), minutes: Math.min(s, dayEnd) - cur });
    cur = Math.max(cur, e);
  }
  if (dayEnd - cur >= 15) out.push({ start: hhmm(cur), end: hhmm(dayEnd), minutes: dayEnd - cur });
  return out;
}

async function getCalendarTool(a: Args, ctx: Ctx) {
  const today = todayISO();
  const from = (date(a.from, 'from') ?? today) as string;
  const to = (date(a.to, 'to') ?? addDaysISO(from, 6)) as string;
  if (to < from) throw new ToolError('to is before from.');
  if (addDaysISO(from, 30) < to) throw new ToolError('Ask for at most 31 days at a time.');
  const dayStart = a.day_start === undefined ? 5 * 60 : parseClock(a.day_start);
  const dayEnd = a.day_end === undefined ? 23 * 60 : parseClock(a.day_end);
  if (dayStart === null || dayEnd === null || dayEnd <= dayStart) throw new ToolError('day_start and day_end are times like "06:00" and "22:00".');
  const rows = await blocksBetween(from, to);
  const busy = busyByDay(rows);
  const days = [];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    const list = rows.filter((b) => utcToZoned(b.start_at).date === d);
    days.push({
      date: d,
      weekday: new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      blocks: list.map((b) => blockOut(b, ctx)),
      booked_minutes: (busy.get(d) ?? []).reduce((m, [s, e]) => m + (e - s), 0),
      free: gaps(busy.get(d) ?? [], dayStart, dayEnd),
    });
  }
  return { time_zone: TZ, today, from, to, free_window: `${hhmm(dayStart)} to ${hhmm(dayEnd)}`, days };
}

interface BlockInput {
  page_id?: unknown;
  title?: unknown;
  sector_slug?: unknown;
  date?: unknown;
  start?: unknown;
  end?: unknown;
  minutes?: unknown;
  notes?: unknown;
}

function blockSpan(b: BlockInput, label: string): { date: string; s: number; e: number } {
  if (!isISODate(b.date)) throw new ToolError(`${label}: date must be like 2026-12-01.`);
  const s = parseClock(b.start);
  if (s === null || s >= 1440) throw new ToolError(`${label}: start must be a time like "07:30".`);
  let e: number | null = null;
  if (b.end !== undefined) e = parseClock(b.end);
  else if (b.minutes !== undefined) {
    const m = Number(b.minutes);
    if (!Number.isInteger(m) || m < 5 || m > 1440) throw new ToolError(`${label}: minutes must be a whole number from 5 to 1440.`);
    e = s + m;
  }
  if (e === null) throw new ToolError(`${label}: give end ("08:15") or minutes.`);
  if (e <= s || e > 1440) throw new ToolError(`${label}: the end has to be after the start and on the same day.`);
  return { date: b.date as string, s, e };
}

async function scheduleBlocks(a: Args, ctx: Ctx) {
  const list = a.blocks as BlockInput[];
  if (!Array.isArray(list) || !list.length) throw new ToolError('blocks must be a non-empty list.');
  if (list.length > 60) throw new ToolError('Schedule at most 60 blocks per call.');
  const rows: {
    node_id: string | null;
    sector_id?: string | null;
    sector_auto?: boolean;
    title: string;
    notes: string;
    start_at: string;
    end_at: string;
    source: string;
    span: { date: string; s: number; e: number };
    label: string;
  }[] = [];
  const pageIds = list.map((b) => b.page_id).filter((x) => x !== undefined && x !== null);
  for (const id of pageIds) if (!isId(id)) throw new ToolError(`${String(id)} is not a valid page id.`);
  const { data: pages } = pageIds.length ? await db().from('align_nodes').select('id, title, archived').in('id', pageIds as string[]) : { data: [] };
  const pageMap = new Map(((pages ?? []) as { id: string; title: string; archived: boolean }[]).map((p) => [p.id, p]));
  list.forEach((b, i) => {
    const label = `Block ${i + 1}`;
    const span = blockSpan(b, label);
    const node = b.page_id ? pageMap.get(b.page_id as string) : undefined;
    if (b.page_id && (!node || node.archived)) throw new ToolError(`${label}: no page with id ${String(b.page_id)}.`);
    const title = str(b.title, 300, 'title') ?? '';
    if (!node && !title) throw new ToolError(`${label}: give a page_id or a title.`);
    rows.push({
      node_id: node?.id ?? null,
      title,
      notes: str(b.notes, 5000, 'notes') ?? '',
      start_at: zonedToUtc(span.date, span.s).toISOString(),
      end_at: zonedToUtc(span.date, span.e).toISOString(),
      source: 'chatgpt',
      span,
      label: `${label} (${title || node?.title})`,
    });
  });
  // Standalone blocks get a sector: the one asked for, or one guessed from the words.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.node_id) continue;
    const slug = list[i].sector_slug;
    if (slug) {
      r.sector_id = (await sectorBySlug(slug)).id;
      r.sector_auto = false;
    } else {
      const g = await guessSector(r.title, r.notes, { allowAi: true }).catch(() => null);
      if (g && g.confidence !== 'low') {
        r.sector_id = g.sectorId;
        r.sector_auto = true;
      }
    }
  }
  // Double-booking check, against the calendar and within this batch.
  if (a.allow_overlap !== true) {
    const dates = rows.map((r) => r.span.date).sort();
    const existing = busyByDay(await blocksBetween(dates[0], dates[dates.length - 1]));
    const conflicts: string[] = [];
    rows.forEach((r, i) => {
      const taken = existing.get(r.span.date) ?? [];
      if (taken.some(([s, e]) => r.span.s < e && r.span.e > s)) conflicts.push(`${r.label} on ${r.span.date} ${hhmm(r.span.s)} overlaps something already on the calendar`);
      rows.forEach((o, j) => {
        if (j > i && o.span.date === r.span.date && r.span.s < o.span.e && r.span.e > o.span.s) conflicts.push(`${r.label} overlaps ${o.label}`);
      });
    });
    if (conflicts.length) throw new ToolError(`Nothing was scheduled. Conflicts: ${conflicts.slice(0, 10).join('; ')}. Call get_calendar for free time, or pass allow_overlap: true.`);
  }
  const since = new Date().toISOString();
  const { data, error } = await db()
    .from('align_blocks')
    .insert(rows.map(({ span: _s, label: _l, ...r }) => r))
    .select(BLOCK_SELECT);
  if (error) throw new ToolError('Could not save the blocks.');
  await tagVia(since);
  const created = ((data ?? []) as BlockRow[]).map((b) => blockOut({ ...b, page_title: b.node_id ? pageMap.get(b.node_id)?.title : undefined }, ctx));
  return { scheduled_count: created.length, scheduled: created, calendar_url: `${ctx.origin}/calendar?view=week&date=${rows[0].span.date}` };
}

async function updateBlockTool(a: Args, ctx: Ctx) {
  if (!isId(a.id)) throw new ToolError('A valid block id is required.');
  const { data: cur } = await db().from('align_blocks').select(BLOCK_SELECT).eq('id', a.id).maybeSingle();
  if (!cur) throw new ToolError(`No block with id ${String(a.id)}.`);
  const b = cur as BlockRow;
  const row: Record<string, unknown> = {};
  if (a.date !== undefined || a.start !== undefined || a.end !== undefined || a.minutes !== undefined) {
    const s0 = utcToZoned(b.start_at);
    const len = Math.round((new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000);
    const span = blockSpan(
      {
        date: a.date ?? s0.date,
        start: a.start ?? hhmm(s0.minutes),
        end: a.end,
        minutes: a.end === undefined ? (a.minutes ?? len) : undefined,
      },
      'Block',
    );
    row.start_at = zonedToUtc(span.date, span.s).toISOString();
    row.end_at = zonedToUtc(span.date, span.e).toISOString();
  }
  if (a.title !== undefined) row.title = str(a.title, 300, 'title') ?? '';
  if (a.notes !== undefined) row.notes = str(a.notes, 5000, 'notes') ?? '';
  if (a.status !== undefined) {
    if (!['planned', 'done', 'skipped'].includes(a.status as string)) throw new ToolError('status is planned, done or skipped.');
    row.status = a.status;
  }
  if (a.page_id !== undefined) {
    if (a.page_id === null) row.node_id = null;
    else row.node_id = (await nodeById(a.page_id)).id;
  }
  if (!Object.keys(row).length) throw new ToolError('Nothing to change.');
  if ((row.node_id === null || (row.node_id === undefined && !b.node_id)) && !(row.title ?? b.title)) throw new ToolError('A block without a page needs a title.');
  const since = new Date().toISOString();
  const { data, error } = await db().from('align_blocks').update(row).eq('id', b.id).select(BLOCK_SELECT).single();
  if (error || !data) throw new ToolError('Could not save the block.');
  await tagVia(since);
  const [out] = await blocksBetween(utcToZoned((data as BlockRow).start_at).date, utcToZoned((data as BlockRow).start_at).date).then((r) => r.filter((x) => x.id === b.id));
  return { updated: blockOut(out ?? (data as BlockRow), ctx) };
}

async function deleteBlockTool(a: Args) {
  if (!isId(a.id)) throw new ToolError('A valid block id is required.');
  const since = new Date().toISOString();
  const { data, error } = await db().from('align_blocks').delete().eq('id', a.id).select('id');
  if (error) throw new ToolError('Could not remove it.');
  if (!data?.length) throw new ToolError(`No block with id ${String(a.id)}.`);
  await tagVia(since);
  return { removed: a.id };
}

// ---------------------------------------------------------------------------
// Habits and measures
// ---------------------------------------------------------------------------

function habitOut(h: HabitRow, ctx: Ctx) {
  return {
    habit_id: h.id,
    page_id: h.node_id,
    title: h.node.title,
    schedule: scheduleLabel(h),
    ...(h.window_start !== null ? { window: `${hhmm(h.window_start)} to ${hhmm(h.window_end ?? 1440)}` } : {}),
    paused: h.paused,
    this_week: `${h.stat.weekDone} of ${h.stat.weekTarget}`,
    due_today: h.stat.dueToday,
    done_today: h.stat.doneToday,
    streak: `${h.stat.streak} ${h.stat.streakUnit}${h.stat.streak === 1 ? '' : 's'}`,
    ...(h.stat.rate !== null ? { last_4_weeks: `${Math.round(h.stat.rate * 100)}%` } : {}),
    last_14_days: Array.from({ length: 14 }, (_, i) => addDaysISO(todayISO(), -13 + i)).map((d) => {
      const l = h.logs.find((x) => x.day === d);
      return `${d}:${l ? l.status : '-'}`;
    }),
    url: url(ctx, 'node', h.node_id),
  };
}

function measureOut(m: MeasureRow, ctx: Ctx) {
  const recent = [...m.logs].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 12);
  return {
    measure_id: m.id,
    name: m.name,
    unit: m.unit,
    kind: m.kind,
    ...(m.kind === 'level' ? { better: m.direction === 'up' ? 'higher' : 'lower' } : { counts_per: m.period }),
    current: { label: m.stat.periodLabel, value: m.stat.current },
    ...(m.start_value !== null ? { start_value: m.start_value } : {}),
    ...(m.target_value !== null ? { target_value: m.target_value } : {}),
    ...(m.target_date ? { target_date: m.target_date } : {}),
    ...(m.stat.progress !== null ? { progress: `${Math.round(m.stat.progress * 100)}%` } : {}),
    ...(m.stat.onTrack !== null ? { on_track: m.stat.onTrack } : {}),
    ...(m.node ? { page_id: m.node.id, page: m.node.title, url: url(ctx, 'node', m.node.id) } : {}),
    ...(m.model && m.model.status !== 'no_target'
      ? {
          model: {
            status: MODEL_STATUS_LABEL[m.model.status],
            curve: CURVE_LABEL[m.model.curve],
            baseline: m.model.baseline,
            baseline_date: m.model.baselineDate,
            expected_by_today: m.model.expected === null ? null : Math.round(m.model.expected * 100) / 100,
            recent_pace_per_week: m.model.ratePerWeek === null ? null : Math.round(m.model.ratePerWeek * 100) / 100,
            required_pace_per_week: m.model.requiredPerWeek === null ? null : Math.round(m.model.requiredPerWeek * 100) / 100,
            projected_at_target_date: m.model.projected === null ? null : Math.round(m.model.projected * 100) / 100,
            weeks_left: m.model.weeksLeft === null ? null : Math.round(m.model.weeksLeft * 10) / 10,
            needs_recalculation: m.model.needsRecalc,
            scenarios: m.model.scenarios,
          },
        }
      : {}),
    ...(m.assumptions?.length ? { assumptions: m.assumptions } : {}),
    ...(m.method ? { method: m.method } : {}),
    recent_entries: recent.map((l) => ({ day: l.day, value: l.value, ...(l.note ? { note: l.note } : {}) })),
  };
}

async function getProgressTool(a: Args, ctx: Ctx) {
  const [habits, measures] = await Promise.all([getHabits(), getMeasures()]);
  const forPage = a.page_id ? String(a.page_id) : null;
  return {
    today: todayISO(),
    habits: habits.filter((h) => !forPage || h.node_id === forPage).map((h) => habitOut(h, ctx)),
    measures: measures.filter((m) => !forPage || m.node_id === forPage).map((m) => measureOut(m, ctx)),
  };
}

async function setHabitTool(a: Args, ctx: Ctx) {
  const n = await nodeById(a.page_id);
  const schedule = String(a.schedule ?? '');
  if (!['daily', 'days', 'per_week'].includes(schedule)) throw new ToolError('schedule is "daily", "days" (with days) or "per_week" (with times_per_week).');
  const DAYS: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
  const days = Array.isArray(a.days) ? (a.days as unknown[]).map((d) => (typeof d === 'number' ? d : DAYS[String(d).slice(0, 3).toLowerCase()])).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : [];
  if (schedule === 'days' && !days.length) throw new ToolError('days needs at least one day, like ["mon", "wed", "fri"].');
  const per = a.times_per_week === undefined ? null : Number(a.times_per_week);
  if (schedule === 'per_week' && !(per && Number.isInteger(per) && per >= 1 && per <= 7)) throw new ToolError('times_per_week is 1 to 7.');
  const minutes = a.minutes === undefined || a.minutes === null ? null : Number(a.minutes);
  if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 5 && minutes <= 600)) throw new ToolError('minutes is 5 to 600.');
  const ws = a.earliest === undefined || a.earliest === null ? null : parseClock(a.earliest);
  const we = a.latest_end === undefined || a.latest_end === null ? null : parseClock(a.latest_end);
  if ((a.earliest && ws === null) || (a.latest_end && we === null)) throw new ToolError('earliest and latest_end are times like "06:00" and "09:00".');
  if (ws !== null && we !== null && we <= ws) throw new ToolError('latest_end has to be after earliest.');
  const since = new Date().toISOString();
  const { error } = await db()
    .from('align_habits')
    .upsert(
      {
        node_id: n.id,
        schedule,
        days: schedule === 'days' ? [...new Set(days)].sort() : [],
        per_week: schedule === 'per_week' ? per : null,
        minutes,
        window_start: ws,
        window_end: we,
        auto_place: a.place_on_calendar === true,
        paused: a.paused === true,
      },
      { onConflict: 'node_id' },
    );
  if (error) throw new ToolError('Could not save the habit.');
  await db().from('align_nodes').update({ actionable: true, brain_state: 'actionable' }).eq('id', n.id);
  await tagVia(since);
  const [h] = (await getHabits()).filter((x) => x.node_id === n.id);
  return { habit: h ? habitOut(h, ctx) : { page_id: n.id } };
}

async function checkInTool(a: Args, ctx: Ctx) {
  const habits = await getHabits();
  const h = habits.find((x) => x.id === a.habit_id || x.node_id === a.page_id);
  if (!h) throw new ToolError('No habit found. Pass habit_id or the page_id of a page that is a habit (see get_progress).');
  const day = (date(a.day, 'day') ?? todayISO()) as string;
  if (day > todayISO()) throw new ToolError('You can only check in for today or earlier.');
  const status = a.status === undefined ? 'done' : String(a.status);
  const since = new Date().toISOString();
  if (status === 'clear') {
    await db().from('align_habit_logs').delete().eq('habit_id', h.id).eq('day', day);
  } else {
    if (!['done', 'skipped'].includes(status)) throw new ToolError('status is done, skipped or clear.');
    const amount = a.amount === undefined || a.amount === null ? null : Number(a.amount);
    if (amount !== null && !Number.isFinite(amount)) throw new ToolError('amount must be a number.');
    const { error } = await db()
      .from('align_habit_logs')
      .upsert({ habit_id: h.id, day, status, amount, note: str(a.note, 2000, 'note') ?? '', source: 'chatgpt' }, { onConflict: 'habit_id,day' });
    if (error) throw new ToolError('Could not check in.');
  }
  await tagVia(since);
  const [fresh] = (await getHabits()).filter((x) => x.id === h.id);
  return { habit: habitOut(fresh ?? h, ctx) };
}

async function createMeasureTool(a: Args, ctx: Ctx) {
  const name = str(a.name, 120, 'name', true)!;
  const kind = a.kind === 'total' ? 'total' : 'level';
  const period = kind === 'total' ? (['week', 'month', 'all'].includes(String(a.counts_per)) ? String(a.counts_per) : 'week') : 'all';
  const n = a.page_id ? await nodeById(a.page_id) : null;
  const sector = !n && a.sector_slug ? await sectorBySlug(a.sector_slug) : null;
  const numOrNull = (v: unknown, f: string) => {
    if (v === undefined || v === null || v === '') return null;
    const x = Number(v);
    if (!Number.isFinite(x)) throw new ToolError(`${f} must be a number.`);
    return x;
  };
  const row = {
    name,
    unit: str(a.unit, 24, 'unit') ?? '',
    kind,
    direction: a.better === 'lower' ? 'down' : 'up',
    period,
    start_value: kind === 'level' ? numOrNull(a.start_value, 'start_value') : null,
    target_value: numOrNull(a.target_value, 'target_value'),
    target_date: date(a.target_date, 'target_date') ?? null,
    node_id: n?.id ?? null,
    sector_id: sector?.id ?? null,
    archived: false,
    ...modelFields(a),
  };
  const since = new Date().toISOString();
  const { data, error } = await db().from('align_measures').insert(row).select('id').single();
  if (error || !data) throw new ToolError('Could not add the measure.');
  if (Array.isArray(a.entries) && a.entries.length) {
    const entries = (a.entries as { day?: unknown; value?: unknown; note?: unknown }[]).slice(0, 200).map((e, i) => {
      if (!isISODate(e.day) || !Number.isFinite(Number(e.value))) throw new ToolError(`entries[${i}] needs a day (YYYY-MM-DD) and a numeric value.`);
      return { measure_id: data.id, day: e.day, value: Number(e.value), note: str(e.note, 2000, 'note') ?? '', source: 'chatgpt' };
    });
    await db().from('align_measure_logs').insert(entries);
  }
  await tagVia(since);
  const [m] = (await getMeasures()).filter((x) => x.id === data.id);
  return { measure: m ? measureOut(m, ctx) : { measure_id: data.id } };
}

async function logMeasureTool(a: Args, ctx: Ctx) {
  const measures = await getMeasures();
  const m = measures.find((x) => x.id === a.measure_id) ?? (a.name ? measures.find((x) => x.name.toLowerCase() === String(a.name).toLowerCase()) : undefined);
  if (!m) throw new ToolError(`No measure found. Pass measure_id or the exact name. Existing: ${measures.map((x) => x.name).join(', ') || 'none'}.`);
  const value = Number(a.value);
  if (!Number.isFinite(value)) throw new ToolError('value must be a number.');
  const day = (date(a.day, 'day') ?? todayISO()) as string;
  const since = new Date().toISOString();
  const { error } = await db().from('align_measure_logs').insert({ measure_id: m.id, day, value, note: str(a.note, 2000, 'note') ?? '', source: 'chatgpt' });
  if (error) throw new ToolError('Could not log it.');
  await tagVia(since);
  const [fresh] = (await getMeasures()).filter((x) => x.id === m.id);
  return { measure: measureOut(fresh ?? m, ctx) };
}

async function placeHabitsTool(a: Args) {
  const week = (date(a.week_of, 'week_of') ?? todayISO()) as string;
  const ids = Array.isArray(a.habit_ids) ? (a.habit_ids as unknown[]).filter(isId) as string[] : undefined;
  const since = new Date().toISOString();
  const res = await placeHabitSessions(week, ids, 'chatgpt');
  await tagVia(since);
  return {
    placed: res.placed.map((p) => ({ habit: p.habit, date: p.date, start: hhmm(p.start), end: hhmm(p.end), block_id: p.blockId })),
    not_placed: res.skipped,
  };
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const pageSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: NODE_TYPES,
      description:
        'vision (5 years), milestone (12 months), objective (90 days), strategy (one route to a goal, needs rationale), experiment (a strategy on trial, needs hypothesis, success_criteria and due_date), month (one dated month of a plan), week (one dated week of a plan), commitment (a recurring routine), action (daily), project, phase, task, micro_goal',
    },
    title: { type: 'string', description: 'Short, specific, sentence case. Actions start with a verb and name the exact thing.' },
    body: { type: 'string', description: 'What it looks like when it is real, and why it matters.' },
    done_criteria: { type: 'string', description: 'The measurable finish line. Required for actions and tasks to count as ready to do.' },
    effort_minutes: { type: 'integer', description: 'For actions and tasks: minutes in one sitting (90 or less).' },
    cadence: { type: 'string', description: 'For weekly commitments, e.g. "4 times a week, 20 minutes".' },
    start_date: { type: 'string', description: 'YYYY-MM-DD. Required for month and week (weeks start on a Monday).' },
    due_date: { type: 'string', description: 'YYYY-MM-DD. For an action, the day to do it. Filled in automatically for month and week if left out.' },
    priority: { type: 'integer', enum: [1, 2, 3] },
    event_date: { type: 'string', description: 'YYYY-MM-DD, the day a real-world event happens (race day, trip departure, exam).' },
    location: { type: 'string', description: 'City, venue or address of the event.' },
    cost_usd: { type: 'number', description: 'Price in US dollars, e.g. 95.' },
    link_url: { type: 'string', description: 'Full https link to the sign-up or info page.' },
    rationale: { type: 'string', description: 'Strategy: why this should move the goal (the mechanism), and what it costs.' },
    hypothesis: { type: 'string', description: 'Experiment: "If I do X for N weeks, Y will change by Z".' },
    success_criteria: { type: 'string', description: 'Experiment: exactly how it will be judged at the end.' },
    review_date: { type: 'string', description: 'YYYY-MM-DD to judge a strategy or experiment. Defaults to the day after an experiment ends.' },
    supports: {
      type: 'array',
      description: 'Other goals this page also serves, in any sector: [{ id }] or [{ sector_slug }]. Use this instead of creating the same activity twice.',
      items: { type: 'object', properties: { id: { type: 'string' }, sector_slug: { type: 'string' } } },
    },
    status: { type: 'string', enum: STATUSES },
    ready_to_do: { type: 'boolean', description: 'Defaults to true for actions and tasks that have a done_criteria.' },
    children: { type: 'array', description: 'Pages to create directly under this one (same shape, nests).', items: { type: 'object' } },
  },
  required: ['type', 'title'],
};

const target = {
  type: 'object',
  properties: { id: { type: 'string', description: 'Page id' }, sector_slug: { type: 'string', description: 'Or a sector or area slug' } },
};

const MODEL_PROPS: Record<string, unknown> = {
  baseline_date: { type: 'string', description: 'YYYY-MM-DD the baseline (start_value) was true' },
  curve: { type: 'string', enum: ['linear', 'front_loaded', 'back_loaded', 'compound'] },
  assumptions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['text'] } },
  scenarios: {
    type: 'object',
    description: 'Outcomes by the target date under different assumptions',
    properties: Object.fromEntries(
      ['conservative', 'realistic', 'ambitious'].map((k) => [k, { type: 'object', properties: { value: { type: 'number' }, note: { type: 'string' } } }]),
    ),
  },
  method: { type: 'string', description: 'The math: the variables, the required rate, allowances for attrition and uncertainty' },
};

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const TOOLS: {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  run: (a: Args, ctx: Ctx) => Promise<unknown>;
}[] = [
  {
    name: 'get_life_overview',
    title: 'Life overview',
    description: "Gibson's whole life map in Align: every sector and area with its slug, summary, ratings, mode, page counts and top-level pages. Call this first in any conversation about his goals, and before creating pages, so you use the right sector and do not duplicate what exists.",
    inputSchema: { type: 'object', properties: {} },
    annotations: READ,
    run: getLifeOverview,
  },
  {
    name: 'get_profile',
    title: 'Gibson\'s profile',
    description:
      'Who Gibson is and what he is building: his lifestyle vision, non-negotiables and ideal week, his capacity (work hours, buffer, energy, money), every sector\'s ratings with current versus desired state and budgets, and all profile facts grouped by kind with their status. Read this before planning anything substantial.',
    inputSchema: { type: 'object', properties: { include_sensitive: { type: 'boolean' } } },
    annotations: READ,
    run: getProfile,
  },
  {
    name: 'get_discovery_brief',
    title: 'What to ask next',
    description:
      'Where Gibson\'s profile and plan are thinnest: sectors ordered by the gap between importance and satisfaction, what each is missing (ratings, current and desired state, vision, objectives), missing profile pieces (lifestyle vision, ideal week, capacity, values, constraints, environment, communities) and assumed or stale facts to confirm. Use it to run an intake or a goal discovery conversation.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ,
    run: discoveryBrief,
  },
  {
    name: 'check_plan',
    title: 'Check the plan fits',
    description:
      'Capacity and conflict check for a week (default this week): hours planned against plannable hours (free time after work, less the buffer kept unplanned), hours per day and per sector against budgets, money planned this month against budgets, and issues: overloads, overlapping blocks, neglected priority sectors, deadline clusters, the same activity planned twice in different sectors, reviews that are due, commitments whose time cost is unknown. Call before adding commitments or habits, and fix or raise every high and medium issue.',
    inputSchema: { type: 'object', properties: { week_of: { type: 'string', description: 'Any date in the week, YYYY-MM-DD' } } },
    annotations: READ,
    run: checkPlan,
  },
  {
    name: 'get_review_evidence',
    title: 'Evidence for a review',
    description:
      'For a strategy, experiment or goal over a period (default since the last review): actions planned and done, calendar blocks done and skipped, habit check-ins against target, how each related measure moved, an execution rate, an effectiveness signal and a plain diagnosis that separates "not done" from "done but not working". Read it before recommending continue, modify, replace or stop.',
    inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['page_id'] },
    annotations: READ,
    run: getReviewEvidence,
  },
  {
    name: 'record_review',
    title: 'Record a review',
    description:
      'Save the verdict on a strategy, experiment or goal after reviewing the evidence with Gibson: continue, modify (say what changes and update the pages), replace (give the replacement page; the old one is kept as abandoned with its reasoning and linked to the new one) or stop. Stop and replace pause the open work under it unless keep_children_running. The evidence is stored with the review. Set next_review_date when continuing or modifying.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string' },
        verdict: { type: 'string', enum: ['continue', 'modify', 'replace', 'stop'] },
        effective: { type: 'string', enum: ['yes', 'partly', 'no', 'unclear'] },
        summary: { type: 'string', description: 'What happened and why this verdict' },
        changes: { type: 'string', description: 'For modify: what changes' },
        next_review_date: { type: 'string' },
        replacement: pageSchema,
        keep_children_running: { type: 'boolean' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['page_id', 'verdict', 'summary'],
    },
    annotations: WRITE,
    run: recordReview,
  },
  {
    name: 'update_facts',
    title: 'Update profile facts',
    description:
      'Edit, confirm, re-classify, mark temporary (valid_until) or sensitive, or archive facts by id (see list_facts). confirmed: true marks a fact checked today and turns an assumption into a fact. Archive rather than delete; to change a fact\'s meaning, prefer save_facts with replaces_id so the old version stays on record.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              fact: { type: 'string' },
              kind: { type: 'string', enum: FACT_KIND_VALUES },
              confirmed: { type: 'boolean' },
              temporary: { type: 'boolean' },
              valid_until: { type: ['string', 'null'] },
              sensitive: { type: 'boolean' },
              sector_slug: { type: ['string', 'null'] },
              archive: { type: 'boolean' },
            },
            required: ['id'],
          },
        },
      },
      required: ['updates'],
    },
    annotations: WRITE,
    run: updateFacts,
  },
  {
    name: 'set_lifestyle',
    title: 'Set the lifestyle vision',
    description:
      'Save the life Gibson is building overall: vision (what an ordinary great week and year feel like, in his words), non_negotiables (things every plan must protect, like Sunday with family or 8 hours of sleep), and ideal_week as blocks [{ day: "mon", start: "06:00", end: "07:00", label, sector_slug }] covering work, training, relationships, leisure and unstructured time. Only the fields given change.',
    inputSchema: {
      type: 'object',
      properties: {
        vision: { type: 'string' },
        non_negotiables: { type: 'array', items: { type: 'string' } },
        ideal_week: {
          type: 'array',
          items: { type: 'object', properties: { day: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, label: { type: 'string' }, sector_slug: { type: 'string' } }, required: ['day', 'start', 'end'] },
        },
      },
    },
    annotations: WRITE,
    run: setLifestyle,
  },
  {
    name: 'set_capacity',
    title: 'Set capacity',
    description:
      'Save what Gibson really has to give: work_hours_per_week (time outside his own plan; leave work out of it if work is booked on the calendar), buffer_percent of free time kept unplanned (default 25), max_day_hours of planned time before a day counts as overloaded (default 10), monthly_discretionary_usd, peak_energy (when he is sharpest) and energy_notes. Used by check_plan and the Align brain.',
    inputSchema: {
      type: 'object',
      properties: {
        work_hours_per_week: { type: ['number', 'null'] },
        buffer_percent: { type: 'number' },
        max_day_hours: { type: 'number' },
        monthly_discretionary_usd: { type: ['number', 'null'] },
        peak_energy: { type: 'string' },
        energy_notes: { type: 'string' },
      },
    },
    annotations: WRITE,
    run: setCapacity,
  },
  {
    name: 'update_measure',
    title: 'Update a measure',
    description:
      'Change a measure: new_name, unit, start_value, target_value, target_date, better, page_id, or its model (baseline_date, curve, assumptions, scenarios, method). Recalculate here when the model says the plan needs recalculating and Gibson agrees to a new target or date. archive: true retires it; its entries stay.',
    inputSchema: {
      type: 'object',
      properties: {
        measure_id: { type: 'string' },
        new_name: { type: 'string' },
        unit: { type: 'string' },
        start_value: { type: ['number', 'null'] },
        target_value: { type: ['number', 'null'] },
        target_date: { type: ['string', 'null'] },
        better: { type: 'string', enum: ['higher', 'lower'] },
        page_id: { type: ['string', 'null'] },
        archive: { type: 'boolean' },
        ...MODEL_PROPS,
      },
      required: ['measure_id'],
    },
    annotations: WRITE,
    run: updateMeasureTool,
  },
  {
    name: 'get_page',
    title: 'Open a page',
    description: 'Full detail of one page (by id) or one sector or area (by sector_slug): its fields, the path above it, the pages directly under it, links, notes and the last assessment from the Align brain.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, sector_slug: { type: 'string' } } },
    annotations: READ,
    run: getPage,
  },
  {
    name: 'get_tree',
    title: 'Get the tree',
    description: 'Everything nested under a page or a whole sector, as an outline down to the given depth (default 4, max 8). Use it to see how far a goal has been broken down and where it still stops short of something actionable.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, sector_slug: { type: 'string' }, depth: { type: 'integer', minimum: 1, maximum: 8 }, include_done: { type: 'boolean' } } },
    annotations: READ,
    run: getTree,
  },
  {
    name: 'search_pages',
    title: 'Search',
    description: 'Search every sector, area, page and note by words.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'] },
    annotations: READ,
    run: searchPages,
  },
  {
    name: 'get_due',
    title: 'What is due',
    description: 'Overdue pages, pages due in the next N days (default 14), actions that are ready to do, active 90-day objectives and upcoming events.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 120 } } },
    annotations: READ,
    run: getDue,
  },
  {
    name: 'get_schedule',
    title: 'Get the schedule',
    description:
      'Day by day view of a date range (default the next 14 days, at most 93): pages dated each day with their minutes and what they are part of, timed blocks on the calendar, events, the months and weeks of plans that overlap the range, and everything overdue. Use it before planning or dating new actions, to spread the load and avoid stacking days.',
    inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD, default today' }, to: { type: 'string', description: 'YYYY-MM-DD' }, include_done: { type: 'boolean' } } },
    annotations: READ,
    run: getSchedule,
  },
  {
    name: 'get_calendar',
    title: 'Get the calendar',
    description:
      'Exact time blocks on Gibson\'s calendar for a date range (default 7 days from today, at most 31), with each block\'s page and sector, and the free gaps per day inside Gibson\'s day (default 05:00 to 23:00, set day_start and day_end to narrow it). Times are "HH:MM" in America/New_York. Call it before scheduling so new blocks land in real free time.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD, default today' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        day_start: { type: 'string', description: 'HH:MM, default 05:00' },
        day_end: { type: 'string', description: 'HH:MM, default 23:00' },
      },
    },
    annotations: READ,
    run: getCalendarTool,
  },
  {
    name: 'schedule_blocks',
    title: 'Schedule time',
    description:
      'Put up to 60 blocks of time on the calendar, each for a page (page_id) or a standalone title, on a date with a start and either an end or minutes, in America/New_York. Use it to give actions real time slots: runs, practice sessions, work blocks. By default it refuses anything that overlaps the calendar or another block in the same call and writes nothing; check get_calendar first, or pass allow_overlap: true.',
    inputSchema: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          minItems: 1,
          maxItems: 60,
          items: {
            type: 'object',
            properties: {
              page_id: { type: 'string', description: 'The page this time is for (usually a daily action or task)' },
              title: { type: 'string', description: 'Required when there is no page_id; optional label otherwise' },
              sector_slug: { type: 'string', description: 'For a standalone block: its sector or area. Left out, it is guessed from the title and notes.' },
              date: { type: 'string', description: 'YYYY-MM-DD' },
              start: { type: 'string', description: 'HH:MM, 24-hour' },
              end: { type: 'string', description: 'HH:MM, 24-hour, same day' },
              minutes: { type: 'integer', description: 'Length, instead of end' },
              notes: { type: 'string' },
            },
            required: ['date', 'start'],
          },
        },
        allow_overlap: { type: 'boolean' },
      },
      required: ['blocks'],
    },
    annotations: WRITE,
    run: scheduleBlocks,
  },
  {
    name: 'update_block',
    title: 'Change a block',
    description:
      'Move, resize, retitle or finish a calendar block: date, start, end or minutes (times HH:MM in America/New_York), title, notes, status (planned, done, skipped), or page_id (null to unlink). Marking a block done also marks its action or task done.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        date: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        minutes: { type: 'integer' },
        title: { type: 'string' },
        notes: { type: 'string' },
        status: { type: 'string', enum: ['planned', 'done', 'skipped'] },
        page_id: { type: ['string', 'null'] },
      },
      required: ['id'],
    },
    annotations: WRITE,
    run: updateBlockTool,
  },
  {
    name: 'get_progress',
    title: 'Habits and measures',
    description:
      'Every habit (schedule, this week done vs target, due and done today, streak, 4-week rate, last 14 days) and every measure (current value, start, target, progress, on track, recent entries). Pass page_id for one page only. Call it before answering how Gibson is doing, and before adjusting a plan.',
    inputSchema: { type: 'object', properties: { page_id: { type: 'string' } } },
    annotations: READ,
    run: getProgressTool,
  },
  {
    name: 'set_habit',
    title: 'Make a page a habit',
    description:
      'Turn a page (usually a weekly commitment) into a habit with a schedule, or change its schedule: "daily", "days" with days like ["mon","wed","fri"], or "per_week" with times_per_week. Optional minutes per session, a time window (earliest, latest_end as HH:MM), place_on_calendar, paused.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'string' },
        schedule: { type: 'string', enum: ['daily', 'days', 'per_week'] },
        days: { type: 'array', items: { type: 'string' } },
        times_per_week: { type: 'integer', minimum: 1, maximum: 7 },
        minutes: { type: 'integer', minimum: 5, maximum: 600 },
        earliest: { type: 'string', description: 'HH:MM' },
        latest_end: { type: 'string', description: 'HH:MM' },
        place_on_calendar: { type: 'boolean' },
        paused: { type: 'boolean' },
      },
      required: ['page_id', 'schedule'],
    },
    annotations: WRITE,
    run: setHabitTool,
  },
  {
    name: 'check_in',
    title: 'Check in a habit',
    description: 'Record a habit for a day (default today): status "done" (default), "skipped", or "clear" to undo. Optional amount (e.g. minutes or reps) and note. Use habit_id or the habit page_id.',
    inputSchema: {
      type: 'object',
      properties: {
        habit_id: { type: 'string' },
        page_id: { type: 'string' },
        day: { type: 'string', description: 'YYYY-MM-DD, default today' },
        status: { type: 'string', enum: ['done', 'skipped', 'clear'] },
        amount: { type: 'number' },
        note: { type: 'string' },
      },
    },
    annotations: WRITE,
    run: checkInTool,
  },
  {
    name: 'create_measure',
    title: 'Add a measure',
    description:
      'Start tracking a number. kind "level" when the latest value is what matters (body weight, savings balance, mile pace; set better to "higher" or "lower"), or "total" when entries add up (miles run, hours practiced; set counts_per to week, month or all). Attach it to a goal page with page_id so the goal shows progress, or to a sector with sector_slug. Optional start_value, target_value, target_date and past entries [{day, value, note}]. For a target, also give the model: baseline_date, curve (linear; front_loaded when early gains come fast, like weight loss; back_loaded when it builds slowly, like a new skill or audience; compound for growth that multiplies, like savings with returns or followers), assumptions, scenarios and method. Align then tracks expected versus actual pace and flags when the plan needs recalculating.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        unit: { type: 'string', description: 'lb, mi, min/mi, $, songs' },
        kind: { type: 'string', enum: ['level', 'total'] },
        better: { type: 'string', enum: ['higher', 'lower'] },
        counts_per: { type: 'string', enum: ['week', 'month', 'all'] },
        start_value: { type: 'number' },
        target_value: { type: 'number' },
        target_date: { type: 'string' },
        page_id: { type: 'string' },
        sector_slug: { type: 'string' },
        entries: { type: 'array', items: { type: 'object' } },
        ...MODEL_PROPS,
      },
      required: ['name', 'kind'],
    },
    annotations: WRITE,
    run: createMeasureTool,
  },
  {
    name: 'log_measure',
    title: 'Log a measure',
    description: 'Add an entry to a measure (by measure_id or exact name): a value for a day (default today) with an optional note. For "did my run, 3.2 miles", log 3.2 to the miles measure and check in the run habit.',
    inputSchema: {
      type: 'object',
      properties: { measure_id: { type: 'string' }, name: { type: 'string' }, value: { type: 'number' }, day: { type: 'string' }, note: { type: 'string' } },
      required: ['value'],
    },
    annotations: WRITE,
    run: logMeasureTool,
  },
  {
    name: 'place_habits',
    title: 'Place habit sessions',
    description:
      'Put each habit\'s remaining sessions for a week (week_of any date in it, default this week) into free calendar time inside the habit\'s time window, spread across the week, never on top of other blocks. Optionally only some habit_ids. Returns what was placed and what could not fit.',
    inputSchema: { type: 'object', properties: { week_of: { type: 'string' }, habit_ids: { type: 'array', items: { type: 'string' } } } },
    annotations: WRITE,
    run: placeHabitsTool,
  },
  {
    name: 'delete_block',
    title: 'Remove a block',
    description: 'Take a block off the calendar. The page it was for stays. Only when Gibson asks, or when replacing it with a better time.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { ...WRITE, destructiveHint: true },
    run: deleteBlockTool,
  },
  {
    name: 'list_facts',
    title: 'Facts about Gibson',
    description:
      'The facts in Gibson\'s profile with their kind and status (confirmed, assumed, stale when not confirmed in 6 months, expired when a temporary fact has ended). Filter by sector_slug or kind, or needs_attention for the ones to re-check. Sensitive facts only with include_sensitive.',
    inputSchema: {
      type: 'object',
      properties: { sector_slug: { type: 'string' }, kind: { type: 'string', enum: FACT_KIND_VALUES }, needs_attention: { type: 'boolean' }, include_sensitive: { type: 'boolean' } },
    },
    annotations: READ,
    run: listFacts,
  },
  {
    name: 'create_pages',
    title: 'Create pages',
    description:
      'Create one or more pages, optionally with nested children, either under a page (parent_id) or at the top of a sector or area (sector_slug). Use it to lay down a whole chain at once, from vision to milestone to objective to weekly commitment to daily actions. Up to 80 pages per call. Every action or task should have a done_criteria and effort_minutes.',
    inputSchema: {
      type: 'object',
      properties: { parent_id: { type: 'string' }, sector_slug: { type: 'string' }, pages: { type: 'array', items: pageSchema, minItems: 1 } },
      required: ['pages'],
    },
    annotations: WRITE,
    run: createPages,
  },
  {
    name: 'update_page',
    title: 'Update a page',
    description:
      'Change any field of a page: title, description, status (mark done with status "done"), kind, priority, dates, done criteria, effort, cadence, ready to do, event details (event_date, location, cost_usd, link_url), and for strategies and experiments the rationale, hypothesis, success_criteria and review_date. Use null to clear a date, priority, effort or cost, and "" to clear text. Earlier versions of rationale and hypothesis are kept in the page history. To judge a strategy, use record_review instead of editing it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        status: { type: 'string', enum: STATUSES },
        type: { type: 'string', enum: NODE_TYPES },
        priority: { type: ['integer', 'null'] },
        start_date: { type: ['string', 'null'] },
        due_date: { type: ['string', 'null'] },
        done_criteria: { type: 'string' },
        effort_minutes: { type: ['integer', 'null'] },
        cadence: { type: 'string' },
        ready_to_do: { type: 'boolean' },
        event_date: { type: ['string', 'null'] },
        location: { type: 'string' },
        cost_usd: { type: ['number', 'null'] },
        link_url: { type: 'string' },
        rationale: { type: 'string' },
        hypothesis: { type: 'string' },
        success_criteria: { type: 'string' },
        review_date: { type: ['string', 'null'] },
      },
      required: ['id'],
    },
    annotations: WRITE,
    run: updatePage,
  },
  {
    name: 'update_pages',
    title: 'Update many pages',
    description:
      'Apply update_page to up to 100 pages in one call, each as { id, ...fields }. Use it to mark a batch done, re-date a week of actions, or reprioritise. Pages that fail are listed with the reason; the rest still save.',
    inputSchema: { type: 'object', properties: { updates: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } } }, required: ['updates'] },
    annotations: WRITE,
    run: updatePages,
  },
  {
    name: 'shift_dates',
    title: 'Shift dates',
    description:
      'Move the start and due dates of pages forward (positive days) or back (negative), by default with everything under them and only pages not yet done. Use it when life slips, for example pushing the rest of a training block back a week. Event dates never move.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' } },
        days: { type: 'integer', minimum: -730, maximum: 730 },
        include_children: { type: 'boolean', description: 'Default true' },
        include_done: { type: 'boolean', description: 'Also move pages already done. Default false' },
      },
      required: ['days'],
    },
    annotations: WRITE,
    run: shiftDates,
  },
  {
    name: 'move_page',
    title: 'Move a page',
    description: 'Move a page and everything under it, under another page (new_parent_id) or to the top of a sector or area (sector_slug).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, new_parent_id: { type: 'string' }, sector_slug: { type: 'string' } }, required: ['id'] },
    annotations: WRITE,
    run: movePage,
  },
  {
    name: 'archive_page',
    title: 'Archive or restore a page',
    description: 'Archive a page and everything under it (nothing is deleted; links and history stay), or restore it with restore: true. Only do this when Gibson asks.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, restore: { type: 'boolean' } }, required: ['id'] },
    annotations: { ...WRITE, destructiveHint: true },
    run: archivePage,
  },
  {
    name: 'link_pages',
    title: 'Link two pages',
    description: 'Connect any two pages, sectors or areas sideways: "supports" (a habit or action supports a goal), "depends_on", or "related".',
    inputSchema: { type: 'object', properties: { from: target, to: target, relation: { type: 'string', enum: RELATIONS } }, required: ['from', 'to'] },
    annotations: WRITE,
    run: linkPages,
  },
  {
    name: 'add_note',
    title: 'Add a note',
    description: 'Add a note or reflection to a page (id) or a sector or area (sector_slug).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, sector_slug: { type: 'string' }, body: { type: 'string' } }, required: ['body'] },
    annotations: WRITE,
    run: addNote,
  },
  {
    name: 'save_facts',
    title: 'Save facts about Gibson',
    description:
      'Save facts to Gibson\'s profile so Align always knows them. Each item is a plain statement or an object: fact, kind (fact, preference, constraint, resource, value, environment, community, routine, assumption), confirmed (false when you are inferring it and he has not said it), temporary with valid_until (YYYY-MM-DD) for circumstances that will change, sensitive (true for anything private he would not want surfaced casually), sector_slug, page_id, and replaces_id to supersede an older fact (the old one is archived, not lost). Saving a fact that already exists re-confirms it.',
    inputSchema: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          minItems: 1,
          items: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  fact: { type: 'string' },
                  kind: { type: 'string', enum: FACT_KIND_VALUES },
                  confirmed: { type: 'boolean' },
                  temporary: { type: 'boolean' },
                  valid_until: { type: 'string' },
                  sensitive: { type: 'boolean' },
                  sector_slug: { type: 'string' },
                  page_id: { type: 'string' },
                  replaces_id: { type: 'string' },
                },
                required: ['fact'],
              },
            ],
          },
        },
        sector_slug: { type: 'string', description: 'Default sector for items that do not give one' },
      },
      required: ['facts'],
    },
    annotations: WRITE,
    run: saveFacts,
  },
  {
    name: 'update_sector',
    title: 'Update a sector',
    description:
      'Set a sector or area summary (what it means to Gibson), its ratings 1 to 10 (importance, satisfaction, attention_needed), mode ("priority" or "maintain"), current_state versus desired_state (the gap the plan exists to close), and its weekly_hours and monthly_budget_usd.',
    inputSchema: {
      type: 'object',
      properties: {
        sector_slug: { type: 'string' },
        summary: { type: 'string' },
        importance: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
        satisfaction: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
        attention_needed: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
        mode: { type: ['string', 'null'], enum: ['priority', 'maintain', null] },
        current_state: { type: 'string', description: 'Honest description of how this part of life is right now.' },
        desired_state: { type: 'string', description: 'How he wants it to be, concretely.' },
        weekly_hours: { type: ['number', 'null'], description: 'Hours a week he is willing to give this sector.' },
        monthly_budget_usd: { type: ['number', 'null'], description: 'Dollars a month he is willing to spend on it.' },
      },
      required: ['sector_slug'],
    },
    annotations: WRITE,
    run: updateSector,
  },
  {
    name: 'create_area',
    title: 'Add an area',
    description: 'Add a custom area (subcategory) under a top-level sector.',
    inputSchema: { type: 'object', properties: { sector_slug: { type: 'string' }, name: { type: 'string' } }, required: ['sector_slug', 'name'] },
    annotations: WRITE,
    run: createArea,
  },
];

export const INSTRUCTIONS = `Align is Gibson's personal life operating system. Every part of his life, from the lifestyle he is building down to today's action, is a page that links to everything it touches. Act as his strategic life architect, not a task generator. The purpose is a fulfilling life: productivity, money and goal achievement are means, not the measure of his worth. Protect time for leisure, relationships, exploration, rest and unstructured enjoyment.

THE WORKFLOW: Understand, Discover, Diagnose, Strategize, Calculate, Validate, Plan, Execute, Evaluate, Adapt.

1. Understand. Start with get_life_overview and get_profile. Before planning in an area, read it with get_tree or get_page, and get_progress for its numbers. Use what you know from your own memory too. Separate confirmed facts from assumptions: profile facts carry a status (confirmed, assumed, stale, expired). When a missing or assumed fact would change the recommendation, ask instead of guessing.

2. Discover. Do not rely only on what he has already said he wants. Use get_discovery_brief to find where satisfaction lags importance, which sectors have no current or desired state, and what the profile lacks. Ask adaptive, specific questions, one or two at a time, that surface overlooked goals, problems, opportunities and the gap between how he lives now and how he wants to live. Record each sector's current_state and desired_state with update_sector.

3. Diagnose. Never accept the proposed method as the best one by default. Find the real underlying objective; ask whether the method attacks the root problem; weigh alternatives, opportunity costs, obstacles, dependencies and required resources; look for a simpler or more enjoyable route. Challenge assumptions plainly and constructively.

4. Strategize. Keep the layers separate: Five-Year Vision, 12-Month Milestone, 90-Day Objective, then Strategy (one route to the objective, with a rationale for why it should work), then the work under it (Weekly Commitments, Months and Weeks, Daily Actions, Tasks). Offer two or three real strategies when routes genuinely differ and explain why each should move the outcome. When the best route is uncertain, make it an Experiment: hypothesis, a fixed window (start_date to due_date, usually 2 to 6 weeks), success_criteria and a review_date. Strategies stay replaceable: replacing one never restructures the goal. Favor environmental design and routines that make the behavior part of his normal life over plans that rely on motivation and discipline: change the setting, the defaults, the people, the cues.

5. Calculate. For a quantitative goal, reverse-engineer it: baseline (and its date), target, the variables that drive it, the required rate, and allowances for attrition, uncertainty, compounding and nonlinear growth. Never split an annual number into equal weekly slices by default. State the assumptions, and give conservative, realistic and ambitious scenarios when useful. Store it: create_measure (or update_measure) with start_value, target_value, target_date, baseline_date, curve, assumptions, scenarios and method. Align then tracks expected versus actual pace; when a measure says needs_recalculation, raise it with Gibson and recalculate. For a qualitative goal, plan controllable behaviors and a periodic evaluation instead of fake numbers.

6. Validate. Before adding commitments, habits or a batch of actions, call check_plan. Plans that are each reasonable must still fit together: total hours against plannable hours, hours per day, sector budgets, money, and the buffer kept free for recovery and the unexpected. If it does not fit, propose the trade-off (drop, defer, shrink, or merge) rather than adding load. If capacity is not set, ask for it and call set_capacity.

7. Plan. Look for one activity that serves several sectors (a run club serves fitness, friendship and community) and create it once with supports links to each goal instead of duplicating it. If create_pages reports possible_duplicates, ask him which to keep. Every action or task: starts with a verb, names the exact object and the method or tool when it matters, fits one sitting (90 minutes or less), has a measurable done_criteria, effort_minutes, any dependency stated, sits under the objective or strategy it serves, and has a sensible date. Never "get better at networking" or "work on business". Use Weekly Commitments and habits for recurring work instead of generating a daily action for every day. Plans with a deadline work backward from it: Months, then Weeks with exact dates, then dated Daily Actions; check get_schedule so actions do not stack on full days.

8. Execute. Dates say which day; the calendar says when. His day runs 5 AM to 11 PM, times are America/New_York. Use get_calendar for free gaps and schedule_blocks with each action's page_id, placed where they fit his life and energy (his peak_energy is in the profile), never on top of existing blocks, rest kept free. Recurring commitments become habits (set_habit, then place_habits). When he reports something done, mark the block done with update_block or the page with update_page; check_in habits; log_measure numbers.

9. Evaluate. Judge both execution and effectiveness. get_due lists reviews_due; for each, read get_review_evidence. If he did the work and the numbers did not move, the strategy is probably the problem, not his effort. If he did not do the work, look at fit, timing, environment and capacity before judging the strategy.

10. Adapt. Record every verdict with record_review: continue, modify, replace (with the replacement page) or stop. Never answer poor progress by simply piling on more work. When life slips, re-date with shift_dates or update_pages rather than leaving things overdue.

Research. For anything in the real world (races, classes, clubs, venues, products, prices, schedules), search the web first and show real options with dates, prices and links; let him choose, then write it in with event details. Never invent venues, events, prices, schedules or facts.

Profile and privacy. Save durable facts with save_facts, with the right kind (fact, preference, constraint, resource, value, environment, community, routine, assumption). Mark inferences confirmed: false, circumstances that will change temporary with valid_until, and anything private sensitive: true. When a fact changes, save the new one with replaces_id so the history stays. Record the overall lifestyle vision, non-negotiables and ideal week with set_lifestyle. Sensitive facts stay out of reads unless he asks.

Integrity. Never silently overwrite a goal, duplicate a commitment, or schedule a substantial obligation without his approval; say what you are about to write and why. Archive instead of deleting; completed work and past decisions stay on record. After writing, share the page links so he can open them in Align.

Style for anything written into Align: plain and specific, sentence case titles, no em dashes, never the words "tackle" or "tackling".`;
