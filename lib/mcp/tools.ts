import 'server-only';
import { db } from '@/lib/db';
import { isId, cleanBody, cleanLink, cleanText, slugify } from '@/lib/ids';
import { isISODate, todayISO, addDaysISO } from '@/lib/format';
import { NODE_KINDS, PERIOD_TYPES } from '@/lib/kinds';
import type { NodeType, NodeStatus, Relation, Sector } from '@/lib/types';

// The tools ChatGPT gets in Align. Read tools are marked read-only; everything
// else is a write and ChatGPT asks Gibson to confirm it.

const NODE_TYPES = Object.keys(NODE_KINDS) as NodeType[];
const STATUSES: NodeStatus[] = ['inbox', 'planned', 'active', 'done', 'paused', 'abandoned'];
const RELATIONS: Relation[] = ['supports', 'depends_on', 'related'];
const NODE_COLS =
  'id, type, title, body, sector_id, parent_id, status, priority, start_date, due_date, done_at, done_criteria, effort_minutes, cadence, actionable, archived, sort, updated_at, event_date, link_url, location, cost';
const SECTOR_COLS = 'id, slug, name, parent_id, colour, summary, importance, satisfaction, attention_needed, mode, sort, archived';

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
      sector: { slug: s.slug, name: s.name, summary: s.summary, importance: s.importance, satisfaction: s.satisfaction, attention_needed: s.attention_needed, mode: s.mode, url: url(ctx, 'sector', s.slug) },
      top_pages: ((roots.data ?? []) as Record<string, unknown>[]).map((n) => ({ ...nodeSummary(n, ctx), pages_under: n.child_count })),
      links: links.data ?? [],
      notes: notes.data ?? [],
      last_brain_assessment: (brain.data?.[0]?.data as { assessment?: string } | undefined)?.assessment ?? null,
    };
  }
  const n = await nodeById(a.id);
  const [path, kids, links, notes, brain] = await Promise.all([
    db().rpc('align_node_path', { p_id: n.id }),
    db().rpc('align_children', { p_parent: n.id }),
    db().rpc('align_links_for', { p_type: 'node', p_id: n.id }),
    db().from('align_notes').select('body, created_at').eq('attached_type', 'node').eq('attached_id', n.id).eq('archived', false).order('created_at', { ascending: false }).limit(20),
    db().from('align_brain_messages').select('data').eq('object_type', 'node').eq('object_id', n.id).eq('role', 'brain').order('created_at', { ascending: false }).limit(1),
  ]);
  return {
    page: { ...nodeSummary(n, ctx), archived: n.archived },
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
  return { today, window_days: days, overdue: map(overdue), due: map(due), ready_to_do: map(ready), active_90_day_objectives: map(objectives), upcoming_events: map(events) };
}

async function listFacts(a: Args) {
  let q = db().from('align_facts').select('id, fact, source, sector_id, created_at').eq('archived', false).order('created_at').limit(300);
  if (a.sector_slug) {
    const s = await sectorBySlug(a.sector_slug);
    q = q.or(`sector_id.eq.${s.id},sector_id.is.null`);
  }
  const [{ data }, all] = await Promise.all([q, sectors()]);
  return {
    facts: ((data ?? []) as { id: string; fact: string; source: string; sector_id: string | null }[]).map((f) => ({
      id: f.id,
      fact: f.fact,
      source: f.source,
      sector: all.find((s) => s.id === f.sector_id)?.slug ?? null,
    })),
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
  await insertLevel(pages, parentId, sectorId, created);
  if (parentId) await db().from('align_nodes').update({ brain_state: 'broken_down' }).eq('id', parentId);
  await tagVia(since);
  return { created_count: total, created };
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

async function saveFacts(a: Args) {
  const list = Array.isArray(a.facts) ? (a.facts as unknown[]).filter((f): f is string => typeof f === 'string').map((f) => cleanText(f, 500)).filter(Boolean) : [];
  if (!list.length) throw new ToolError('facts must be a list of plain statements about Gibson.');
  if (list.length > 60) throw new ToolError('Save at most 60 facts per call.');
  const sectorId = a.sector_slug ? (await sectorBySlug(a.sector_slug)).id : null;
  const { data: known } = await db().from('align_facts').select('fact').eq('archived', false).limit(1000);
  const have = new Set(((known ?? []) as { fact: string }[]).map((f) => f.fact.toLowerCase().trim()));
  const fresh = [...new Set(list)].filter((f) => !have.has(f.toLowerCase().trim()));
  if (fresh.length) {
    const { error } = await db().from('align_facts').insert(fresh.map((fact) => ({ fact, sector_id: sectorId, source: 'gibson' })));
    if (error) throw new ToolError('Could not save the facts.');
  }
  return { saved: fresh.length, already_known: list.length - fresh.length };
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
  const days: { date: string; weekday: string; items: ReturnType<typeof shape>[]; events: ReturnType<typeof shape>[] }[] = [];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    days.push({
      date: d,
      weekday: new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      items: ((dated.data ?? []) as Record<string, unknown>[]).filter((r) => r.due_date === d).map(shape),
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
    note: 'Items are dated by due_date. Exact time slots arrive with the calendar.',
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
// Definitions
// ---------------------------------------------------------------------------

const pageSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: NODE_TYPES,
      description:
        'vision (5 years), milestone (12 months), objective (90 days), month (one dated month of a plan), week (one dated week of a plan), commitment (a recurring weekly habit), action (daily), project, phase, task, micro_goal',
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
      'Day by day view of a date range (default the next 14 days, at most 93): what is dated each day with its minutes and what it is part of, events on each day, the months and weeks of plans that overlap the range, and everything overdue. Use it before planning or dating new actions, to spread the load and avoid stacking days.',
    inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD, default today' }, to: { type: 'string', description: 'YYYY-MM-DD' }, include_done: { type: 'boolean' } } },
    annotations: READ,
    run: getSchedule,
  },
  {
    name: 'list_facts',
    title: 'Facts about Gibson',
    description: 'The facts Align knows about Gibson (tastes, level, gear, time, constraints), optionally for one sector.',
    inputSchema: { type: 'object', properties: { sector_slug: { type: 'string' } } },
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
      'Change any field of a page: title, description, status (mark done with status "done"), kind, priority, dates, done criteria, effort, cadence, ready to do, and event details (event_date, location, cost_usd, link_url). Use null to clear a date, priority, effort or cost, and "" to clear text.',
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
      'Save durable facts about Gibson that the Align brain should always know (tastes, current level, equipment, schedule, constraints, people). Plain statements, one per item. Pass sector_slug when a fact belongs to one sector. Duplicates are skipped.',
    inputSchema: { type: 'object', properties: { facts: { type: 'array', items: { type: 'string' }, minItems: 1 }, sector_slug: { type: 'string' } }, required: ['facts'] },
    annotations: WRITE,
    run: saveFacts,
  },
  {
    name: 'update_sector',
    title: 'Update a sector',
    description: 'Set a sector or area summary (what it means to Gibson and what good looks like), its ratings 1 to 10 (importance, satisfaction, attention_needed) and mode ("priority" or "maintain").',
    inputSchema: {
      type: 'object',
      properties: {
        sector_slug: { type: 'string' },
        summary: { type: 'string' },
        importance: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
        satisfaction: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
        attention_needed: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
        mode: { type: ['string', 'null'], enum: ['priority', 'maintain', null] },
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

export const INSTRUCTIONS = `Align is Gibson's personal life operating system. Every part of his life, from the five-year vision down to today's action, is a page that links to everything it touches.

Structure: 9 life sectors (each with areas). Under a sector: Five-Year Vision, then 12-Month Milestone, then 90-Day Objective, then Month, then Week, then Daily Action, then Task. Projects split into Phases (or Months and Weeks) and Tasks. Micro Goals split into Actions or Tasks. The hierarchy is flexible: not every goal needs every level.

Months and Weeks are dated stretches of a plan ("Month 2: build to 20 miles a week", "Week 6: first 8 mile long run"). Give each a start_date (weeks start on Monday); the end fills in. A Weekly Commitment is different: a recurring habit with a cadence and no finish date. Use Months and Weeks for anything with a deadline that has to build progressively (a race, an exam, a launch, a savings target); use Weekly Commitments for steady habits.

Any page can be a real event: event_date, location, cost_usd and link_url. A race, a trip, a concert, a course: put the event on the goal page itself so the whole plan can work back from it.

How to work in Align:
- Start with get_life_overview, and use get_tree or get_page before adding to an area, so nothing is duplicated and new pages land in the right place.
- Use everything you know about Gibson from your own memory and conversations. When you learn something durable about him, save it with save_facts so Align's own brain knows it too.
- Reverse-engineer goals down to something he can do today. Each layer must be strictly more specific than the one above and must serve it. Narrow by choosing: which skill, which song, which section, which tool, which number.
- An action or task is ready to do only if it fits one sitting (90 minutes or less), starts with a verb, names the exact object, names the method or tool when it matters, and has a measurable done_criteria. "Focus on the G to C transition" is not ready. "Play bars 1 to 8 of the Wonderwall verse with a metronome at 60 BPM until 3 clean run-throughs, then raise it to 66" is.
- When the right next step depends on a choice only Gibson can make (his tastes, his level, his time, his money), ask him before creating pages.
- Prefer creating a whole chain in one create_pages call with nested children.
- For anything in the real world (races, events, classes, products, prices), search the web first, show Gibson the real options with dates, prices and links, let him pick, then write the chosen one in with its event details.
- Plans with a date work backward from it. Lay out the Months, then the Weeks inside each Month with exact dates, then date each Daily Action on a sensible day of its week (due_date). Check get_schedule first so new actions do not stack onto days that are already full.
- When something slips, use shift_dates or update_pages to re-date what is left rather than leaving it overdue.
- After writing, share the page links so he can open them in Align.
- Style for anything you write into Align: plain and specific, sentence case titles, no em dashes, never the words "tackle" or "tackling".`;
