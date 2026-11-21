import 'server-only';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { addDaysISO, todayISO } from '@/lib/format';
import type { Activity, AlignNode, ChildRow, Crumb, LinkRow, Note, ObjectRef, ObjectType, Sector } from '@/lib/types';

const SECTOR_COLS =
  'id, slug, name, parent_id, colour, icon, summary, importance, satisfaction, attention_needed, mode, sort, archived, created_at, updated_at';
const NODE_COLS =
  'id, type, title, body, sector_id, parent_id, status, priority, start_date, due_date, done_at, sort, archived, created_at, updated_at';
const OBJECT_COLS = 'object_type, id, title, kind, sector_id, status, slug';

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Could not load ${what}${error ? `: ${error.message}` : ''}`);
}

// ---------------------------------------------------------------------------
// Sectors
// ---------------------------------------------------------------------------

export async function getSectors(): Promise<Sector[]> {
  await requireSession();
  const { data, error } = await db().from('align_sectors').select(SECTOR_COLS).eq('archived', false).order('sort').order('name');
  if (error) fail('sectors', error);
  return (data ?? []) as Sector[];
}

export interface SectorSummary extends Sector {
  areas: number;
  pages: number;
  active: number;
  done: number;
  overdue: number;
}

// The nine (and any custom) sectors with counts that include their areas.
export async function getLifeOverview(): Promise<SectorSummary[]> {
  await requireSession();
  const [sectors, counts] = await Promise.all([
    getSectors(),
    db().rpc('align_sector_counts'),
  ]);
  if (counts.error) fail('sector counts', counts.error);
  const byId = new Map<string, { pages: number; active: number; done: number; overdue: number }>();
  for (const r of (counts.data ?? []) as { sector_id: string; pages: number; active: number; done: number; overdue: number }[]) {
    byId.set(r.sector_id, r);
  }
  return sectors
    .filter((s) => !s.parent_id)
    .map((s) => {
      const c = byId.get(s.id);
      return {
        ...s,
        areas: sectors.filter((a) => a.parent_id === s.id).length,
        pages: Number(c?.pages ?? 0),
        active: Number(c?.active ?? 0),
        done: Number(c?.done ?? 0),
        overdue: Number(c?.overdue ?? 0),
      };
    });
}

export interface SectorPage {
  sector: Sector;
  path: Crumb[];
  areas: (Sector & { pages: number })[];
  roots: ChildRow[];
  links: LinkRow[];
  notes: Note[];
  activity: (Activity & { other?: ObjectRef | null })[];
  pinned: boolean;
  allSectors: Sector[];
}

export async function getSectorPage(slug: string): Promise<SectorPage | null> {
  await requireSession();
  const { data: sector, error } = await db().from('align_sectors').select(SECTOR_COLS).eq('slug', slug).maybeSingle();
  if (error) fail('this sector', error);
  if (!sector || sector.archived) return null;
  const s = sector as Sector;

  const [path, roots, links, notes, activity, pinned, allSectors, counts] = await Promise.all([
    db().rpc('align_sector_path', { p_id: s.id }),
    db().rpc('align_children', { p_parent: null, p_sector: s.id }),
    getLinks('sector', s.id),
    getNotes('sector', s.id),
    getActivity('sector', s.id),
    isPinned('sector', s.id),
    getSectors(),
    db().rpc('align_sector_counts'),
  ]);
  if (path.error) fail('the path', path.error);
  if (roots.error) fail('pages', roots.error);
  const pageCount = new Map<string, number>();
  for (const r of (counts.data ?? []) as { sector_id: string; own_pages: number }[]) pageCount.set(r.sector_id, Number(r.own_pages ?? 0));

  return {
    sector: s,
    path: path.data as Crumb[],
    areas: allSectors.filter((a) => a.parent_id === s.id).map((a) => ({ ...a, pages: pageCount.get(a.id) ?? 0 })),
    roots: roots.data as ChildRow[],
    links,
    notes,
    activity,
    pinned,
    allSectors,
  };
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface NodePage {
  node: AlignNode;
  path: Crumb[];
  sector: Sector | null;
  children: ChildRow[];
  links: LinkRow[];
  notes: Note[];
  activity: (Activity & { other?: ObjectRef | null })[];
  pinned: boolean;
  allSectors: Sector[];
}

export async function getNodePage(id: string): Promise<NodePage | null> {
  await requireSession();
  const { data: node, error } = await db().from('align_nodes').select(NODE_COLS).eq('id', id).maybeSingle();
  if (error) fail('this page', error);
  if (!node) return null;
  const n = node as AlignNode;

  const [path, children, links, notes, activity, pinned, allSectors] = await Promise.all([
    db().rpc('align_node_path', { p_id: n.id }),
    db().rpc('align_children', { p_parent: n.id }),
    getLinks('node', n.id),
    getNotes('node', n.id),
    getActivity('node', n.id),
    isPinned('node', n.id),
    getSectors(),
  ]);
  if (path.error) fail('the path', path.error);
  if (children.error) fail('the pages under this one', children.error);

  return {
    node: n,
    path: path.data as Crumb[],
    sector: allSectors.find((s) => s.id === n.sector_id) ?? null,
    children: children.data as ChildRow[],
    links,
    notes,
    activity,
    pinned,
    allSectors,
  };
}

// ---------------------------------------------------------------------------
// Shared sections
// ---------------------------------------------------------------------------

export async function getLinks(type: ObjectType, id: string): Promise<LinkRow[]> {
  const { data, error } = await db().rpc('align_links_for', { p_type: type, p_id: id });
  if (error) fail('linked items', error);
  return (data ?? []) as LinkRow[];
}

export async function getNotes(type: ObjectType, id: string): Promise<Note[]> {
  const { data, error } = await db()
    .from('align_notes')
    .select('id, body, created_at, updated_at')
    .eq('attached_type', type)
    .eq('attached_id', id)
    .eq('archived', false)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) fail('notes', error);
  return (data ?? []) as Note[];
}

export async function getActivity(type: ObjectType, id: string, limit = 60): Promise<(Activity & { other?: ObjectRef | null })[]> {
  const { data, error } = await db()
    .from('align_activity')
    .select('id, action, detail, at')
    .eq('object_type', type)
    .eq('object_id', id)
    .order('at', { ascending: false })
    .limit(limit);
  if (error) fail('history', error);
  const rows = (data ?? []) as Activity[];

  // Name the other side of links and moves, so the history reads in words.
  const wanted: { object_type: ObjectType; id: string }[] = [];
  for (const r of rows) {
    const d = r.detail as Record<string, string | null>;
    if ((r.action === 'linked' || r.action === 'unlinked') && d.other_id) wanted.push({ object_type: d.other_type as ObjectType, id: d.other_id });
    if (r.action === 'child_added' && d.child_id) wanted.push({ object_type: 'node', id: d.child_id });
    if (r.action === 'moved' && d.to) wanted.push({ object_type: 'node', id: d.to });
  }
  const refs = await resolveRefs(wanted);
  return rows.map((r) => {
    const d = r.detail as Record<string, string | null>;
    const key =
      r.action === 'linked' || r.action === 'unlinked'
        ? `${d.other_type}:${d.other_id}`
        : r.action === 'child_added'
          ? `node:${d.child_id}`
          : r.action === 'moved'
            ? `node:${d.to}`
            : '';
    return { ...r, other: key ? refs.get(key) ?? null : undefined };
  });
}

async function isPinned(type: ObjectType, id: string): Promise<boolean> {
  const { data } = await db().from('align_pins').select('object_id').eq('object_type', type).eq('object_id', id).maybeSingle();
  return Boolean(data);
}

// Looks up titles for a mixed list of objects. Keyed "type:id".
export async function resolveRefs(list: { object_type: ObjectType; id: string }[]): Promise<Map<string, ObjectRef>> {
  const out = new Map<string, ObjectRef>();
  const ids = [...new Set(list.map((r) => r.id))];
  if (!ids.length) return out;
  const { data, error } = await db().from('align_objects').select(`${OBJECT_COLS}, archived`).in('id', ids);
  if (error) return out;
  for (const r of (data ?? []) as (ObjectRef & { archived: boolean })[]) {
    if (!r.archived) out.set(`${r.object_type}:${r.id}`, r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recently viewed and pinned
// ---------------------------------------------------------------------------

export async function recordView(type: ObjectType, id: string): Promise<void> {
  // Best effort: a missed recent entry never breaks the page.
  await db().from('align_recent').upsert({ object_type: type, object_id: id, viewed_at: new Date().toISOString() });
}

export async function getRecent(limit = 8): Promise<ObjectRef[]> {
  await requireSession();
  const { data } = await db().from('align_recent').select('object_type, object_id').order('viewed_at', { ascending: false }).limit(limit + 10);
  const rows = (data ?? []) as { object_type: ObjectType; object_id: string }[];
  const refs = await resolveRefs(rows.map((r) => ({ object_type: r.object_type, id: r.object_id })));
  return rows.map((r) => refs.get(`${r.object_type}:${r.object_id}`)).filter((r): r is ObjectRef => Boolean(r)).slice(0, limit);
}

export async function getPinned(): Promise<ObjectRef[]> {
  await requireSession();
  const { data } = await db().from('align_pins').select('object_type, object_id').order('pinned_at', { ascending: false }).limit(40);
  const rows = (data ?? []) as { object_type: ObjectType; object_id: string }[];
  const refs = await resolveRefs(rows.map((r) => ({ object_type: r.object_type, id: r.object_id })));
  return rows.map((r) => refs.get(`${r.object_type}:${r.object_id}`)).filter((r): r is ObjectRef => Boolean(r));
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export interface TodayData {
  pinned: ObjectRef[];
  recent: ObjectRef[];
  due: (AlignNode & { sector: Sector | null })[];
  overdue: (AlignNode & { sector: Sector | null })[];
  objectives: (AlignNode & { sector: Sector | null })[];
  inbox: number;
  sectors: Sector[];
}

export async function getToday(): Promise<TodayData> {
  await requireSession();
  const today = todayISO();
  const open = ['active', 'planned', 'inbox', 'paused'];
  const [pinned, recent, due, overdue, objectives, inbox, sectors] = await Promise.all([
    getPinned(),
    getRecent(6),
    db()
      .from('align_nodes')
      .select(NODE_COLS)
      .eq('archived', false)
      .in('status', open)
      .gte('due_date', today)
      .lte('due_date', addDaysISO(today, 14))
      .order('due_date')
      .limit(20),
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).in('status', open).lt('due_date', today).order('due_date').limit(20),
    db().from('align_nodes').select(NODE_COLS).eq('archived', false).eq('type', 'objective').eq('status', 'active').order('due_date', { nullsFirst: false }).limit(12),
    db().from('align_nodes').select('id', { count: 'exact', head: true }).eq('archived', false).eq('status', 'inbox'),
    getSectors(),
  ]);
  if (due.error) fail('what is due', due.error);
  if (overdue.error) fail('what is overdue', overdue.error);
  if (objectives.error) fail('objectives', objectives.error);
  const withSector = (rows: AlignNode[]) => rows.map((n) => ({ ...n, sector: topSector(sectors, n.sector_id) }));
  return {
    pinned,
    recent,
    due: withSector((due.data ?? []) as AlignNode[]),
    overdue: withSector((overdue.data ?? []) as AlignNode[]),
    objectives: withSector((objectives.data ?? []) as AlignNode[]),
    inbox: inbox.count ?? 0,
    sectors,
  };
}

// The top-level sector for any sector or area id.
export function topSector(sectors: Sector[], id: string | null): Sector | null {
  let s = sectors.find((x) => x.id === id) ?? null;
  let guard = 0;
  while (s?.parent_id && guard++ < 16) s = sectors.find((x) => x.id === s!.parent_id) ?? s;
  return s;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// Pages waiting to be filed (Clyde's captures land here once voice moves in).
export async function getInbox(): Promise<ObjectRef[]> {
  await requireSession();
  const { data, error } = await db()
    .from('align_nodes')
    .select('id, title, type, sector_id, status')
    .eq('archived', false)
    .eq('status', 'inbox')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) fail('the inbox', error);
  return ((data ?? []) as { id: string; title: string; type: string; sector_id: string | null; status: string }[]).map((n) => ({
    object_type: 'node',
    id: n.id,
    title: n.title,
    kind: n.type,
    sector_id: n.sector_id,
    status: n.status,
    slug: null,
  }));
}

export async function searchEverything(q: string, limit = 40): Promise<ObjectRef[]> {
  await requireSession();
  const query = q.trim().slice(0, 120);
  if (!query) return [];
  const { data, error } = await db().rpc('align_search', { p_q: query, p_limit: limit });
  if (error) fail('search results', error);
  return (data ?? []) as ObjectRef[];
}
