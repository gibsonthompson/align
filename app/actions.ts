'use server';

import { createHash, timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { hasSession } from '@/lib/auth';
import { missingEnvNames } from '@/lib/env';
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import { cleanBody, cleanText, isId, slugify } from '@/lib/ids';
import { isISODate } from '@/lib/format';
import { NODE_KINDS, SECTOR_ICON_NAMES } from '@/lib/kinds';
import type { ActionResult, NodeStatus, NodeType, ObjectRef, ObjectType, Relation } from '@/lib/types';

const NODE_TYPES = Object.keys(NODE_KINDS) as NodeType[];
const STATUSES: NodeStatus[] = ['inbox', 'planned', 'active', 'done', 'paused', 'abandoned'];
const OBJECT_TYPES: ObjectType[] = ['sector', 'node'];
const RELATIONS: Relation[] = ['supports', 'depends_on', 'pictured_in', 'scheduled_as', 'reviewed_in', 'related'];

function err<T = undefined>(error: string): ActionResult<T> {
  return { ok: false, error };
}

const SIGNED_OUT = 'You were signed out. Reload to enter your PIN.';

function refresh() {
  revalidatePath('/', 'layout');
}

// Database messages are mapped to plain sentences; anything unexpected gets a generic one.
function dbError(error: { code?: string; message?: string } | null, fallback: string): string {
  if (!error) return fallback;
  if (error.code === '23514' && error.message?.includes('own pages')) return 'A page cannot go under one of its own pages.';
  if (error.code === '23505') return 'These are already linked.';
  if (error.code === '23503') return 'One of those pages no longer exists.';
  if (error.code === 'P0002') return 'That page no longer exists.';
  return fallback;
}

// ---------------------------------------------------------------------------
// PIN lock
// ---------------------------------------------------------------------------

const MAX_FAILURES = 5; // in 15 minutes, then a 15 minute lock
const MAX_DAILY_FAILURES = 10; // in 24 hours, then a 24 hour lock

function sameSecret(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export type UnlockResult = { ok: true } | { ok: false; error: string; lockedForMinutes?: number };

function lockedMessage(untilMs: number): UnlockResult {
  const minutes = Math.max(1, Math.ceil((untilMs - Date.now()) / 60000));
  const label = minutes >= 90 ? `${Math.ceil(minutes / 60)} hours` : `${minutes} min`;
  return { ok: false, error: `Too many wrong PINs. Try again in ${label}.`, lockedForMinutes: minutes };
}

export async function unlock(pinInput: string): Promise<UnlockResult> {
  const missing = missingEnvNames();
  if (missing.length) return { ok: false, error: `Setup is not finished. Missing in Vercel: ${missing.join(', ')}` };
  const pin = String(pinInput ?? '').replace(/\D/g, '').slice(0, 12);

  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 64);
  const { data, error } = await db().rpc('align_pin_try', { p_ip: ip });
  if (error || !data) return { ok: false, error: 'Could not check the PIN right now. Try again in a moment.' };
  const gate = data as { allowed: boolean; until?: string; attempt_id?: number; failures_15m?: number; failures_24h?: number };
  if (!gate.allowed) return lockedMessage(new Date(gate.until ?? Date.now() + 15 * 60_000).getTime());

  const success = pin.length > 0 && sameSecret(pin, process.env.ALIGN_PIN!);
  if (!success) {
    const f15 = Number(gate.failures_15m ?? 1);
    const f24 = Number(gate.failures_24h ?? 1);
    const left = Math.min(MAX_FAILURES - f15, MAX_DAILY_FAILURES - f24);
    if (left > 0) return { ok: false, error: `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.` };
    return f24 >= MAX_DAILY_FAILURES ? lockedMessage(Date.now() + 24 * 60 * 60 * 1000) : lockedMessage(Date.now() + 15 * 60 * 1000);
  }

  if (gate.attempt_id) await db().rpc('align_pin_succeeded', { p_id: gate.attempt_id });
  const value = await createSession();
  if (!value) return { ok: false, error: 'Setup is not finished.' };
  const store = await cookies();
  store.set(SESSION_COOKIE, value, sessionCookieOptions());

  // Keep the attempts log small.
  await db().from('align_pin_attempts').delete().lt('attempted_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  return { ok: true };
}

export async function lockNow() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/lock');
}

// ---------------------------------------------------------------------------
// Pages (nodes)
// ---------------------------------------------------------------------------

export async function createNode(input: {
  type: string;
  title: string;
  parentId?: string | null;
  sectorId?: string | null;
  status?: string;
}): Promise<ActionResult<{ id: string }>> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  const type = input.type as NodeType;
  if (!NODE_TYPES.includes(type)) return err('Pick what kind of page this is.');
  const title = cleanText(input.title, 300);
  if (!title) return err('Give it a title.');
  const parentId = input.parentId && isId(input.parentId) ? input.parentId : null;
  const sectorId = input.sectorId && isId(input.sectorId) ? input.sectorId : null;
  const status = STATUSES.includes(input.status as NodeStatus) ? (input.status as NodeStatus) : 'active';

  let sort = 1;
  let q = db().from('align_nodes').select('sort').eq('archived', false).order('sort', { ascending: false }).limit(1);
  q = parentId ? q.eq('parent_id', parentId) : sectorId ? q.is('parent_id', null).eq('sector_id', sectorId) : q.is('parent_id', null).is('sector_id', null);
  const { data: last } = await q;
  if (last?.[0]) sort = Number(last[0].sort) + 1;

  const { data, error } = await db()
    .from('align_nodes')
    .insert({ type, title, parent_id: parentId, sector_id: parentId ? null : sectorId, status, sort })
    .select('id')
    .single();
  if (error || !data) return err(dbError(error, 'Could not create the page. Try again.'));
  refresh();
  return { ok: true, data: { id: data.id as string } };
}

export async function updateNode(
  id: string,
  patch: {
    title?: string;
    body?: string;
    status?: string;
    type?: string;
    priority?: number | null;
    start_date?: string | null;
    due_date?: string | null;
  },
): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That page no longer exists.');
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = cleanText(patch.title, 300);
    if (!t) return err('The title cannot be empty.');
    row.title = t;
  }
  if (patch.body !== undefined) row.body = cleanBody(patch.body, 50_000);
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status as NodeStatus)) return err('Unknown status.');
    row.status = patch.status;
  }
  if (patch.type !== undefined) {
    if (!NODE_TYPES.includes(patch.type as NodeType)) return err('Unknown page type.');
    row.type = patch.type;
  }
  if (patch.priority !== undefined) {
    if (patch.priority !== null && ![1, 2, 3].includes(patch.priority)) return err('Unknown priority.');
    row.priority = patch.priority;
  }
  for (const key of ['start_date', 'due_date'] as const) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v !== null && v !== '' && !isISODate(v)) return err('That date is not valid.');
    row[key] = v || null;
  }
  const start = (row.start_date ?? undefined) as string | undefined;
  const due = (row.due_date ?? undefined) as string | undefined;
  if (start && due && start > due) return err('The start date is after the due date.');
  if (!Object.keys(row).length) return { ok: true };

  const { error } = await db().from('align_nodes').update(row).eq('id', id);
  if (error) return err(dbError(error, 'Could not save. Try again.'));
  refresh();
  return { ok: true };
}

export async function archiveNode(id: string, archived: boolean): Promise<ActionResult<{ count: number }>> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That page no longer exists.');
  const { data, error } = await db().rpc('align_archive_node', { p_id: id, p_archived: archived });
  if (error) return err(dbError(error, archived ? 'Could not archive it. Try again.' : 'Could not restore it. Try again.'));
  refresh();
  return { ok: true, data: { count: Number(data ?? 0) } };
}

export async function moveNode(id: string, target: { parentId?: string | null; sectorId?: string | null }): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That page no longer exists.');
  const parentId = target.parentId && isId(target.parentId) ? target.parentId : null;
  const sectorId = target.sectorId && isId(target.sectorId) ? target.sectorId : null;
  if (parentId === id) return err('A page cannot go under itself.');
  const { error } = await db().rpc('align_move_node', { p_id: id, p_parent: parentId, p_sector: parentId ? null : sectorId });
  if (error) return err(dbError(error, 'Could not move it. Try again.'));
  refresh();
  return { ok: true };
}

// Swaps a page with its neighbour above or below.
export async function reorderNode(id: string, direction: 'up' | 'down'): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That page no longer exists.');
  const { data: me } = await db().from('align_nodes').select('id, parent_id, sector_id, sort').eq('id', id).maybeSingle();
  if (!me) return err('That page no longer exists.');
  let q = db().from('align_nodes').select('id, sort').eq('archived', false).neq('id', id);
  q = me.parent_id ? q.eq('parent_id', me.parent_id) : q.is('parent_id', null).eq('sector_id', me.sector_id);
  q = direction === 'up' ? q.lte('sort', me.sort).order('sort', { ascending: false }) : q.gte('sort', me.sort).order('sort', { ascending: true });
  const { data: other } = await q.limit(1);
  const n = other?.[0];
  if (!n) return { ok: true };
  const mine = Number(me.sort);
  const theirs = Number(n.sort);
  // Equal sorts (from older rows) get pulled apart so the swap is visible.
  const [a, b] = mine === theirs ? (direction === 'up' ? [theirs - 0.5, theirs] : [theirs + 0.5, theirs]) : [theirs, mine];
  const r1 = await db().from('align_nodes').update({ sort: a }).eq('id', me.id);
  const r2 = await db().from('align_nodes').update({ sort: b }).eq('id', n.id);
  if (r1.error || r2.error) return err('Could not reorder. Try again.');
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sectors and areas
// ---------------------------------------------------------------------------

export async function updateSector(
  id: string,
  patch: {
    name?: string;
    summary?: string;
    importance?: number | null;
    satisfaction?: number | null;
    attention_needed?: number | null;
    mode?: string | null;
    icon?: string;
  },
): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That sector no longer exists.');
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const n = cleanText(patch.name, 80);
    if (!n) return err('The name cannot be empty.');
    row.name = n;
  }
  if (patch.summary !== undefined) row.summary = cleanBody(patch.summary, 5000);
  for (const key of ['importance', 'satisfaction', 'attention_needed'] as const) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 10)) return err('Ratings go from 1 to 10.');
    row[key] = v;
  }
  if (patch.mode !== undefined) {
    if (patch.mode !== null && !['priority', 'maintain'].includes(patch.mode)) return err('Unknown mode.');
    row.mode = patch.mode;
  }
  if (patch.icon !== undefined) {
    if (!SECTOR_ICON_NAMES.includes(patch.icon)) return err('Unknown icon.');
    row.icon = patch.icon;
  }
  if (!Object.keys(row).length) return { ok: true };
  const { error } = await db().from('align_sectors').update(row).eq('id', id);
  if (error) return err('Could not save. Try again.');
  refresh();
  return { ok: true };
}

export async function createArea(parentId: string, name: string): Promise<ActionResult<{ slug: string }>> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(parentId)) return err('That sector no longer exists.');
  const clean = cleanText(name, 80);
  if (!clean) return err('Give the area a name.');
  const { data: parent } = await db().from('align_sectors').select('id, slug, colour, icon').eq('id', parentId).maybeSingle();
  if (!parent) return err('That sector no longer exists.');
  const base = `${parent.slug}-${slugify(clean) || 'area'}`.slice(0, 64).replace(/-+$/, '');
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const { data: taken } = await db().from('align_sectors').select('id').eq('slug', slug).maybeSingle();
    if (!taken) break;
    slug = `${base}-${i}`;
  }
  const { data: last } = await db().from('align_sectors').select('sort').eq('parent_id', parentId).order('sort', { ascending: false }).limit(1);
  const { error } = await db()
    .from('align_sectors')
    .insert({ slug, name: clean, parent_id: parentId, colour: parent.colour, icon: parent.icon, sort: Number(last?.[0]?.sort ?? 0) + 1 });
  if (error) return err('Could not add the area. Try again.');
  refresh();
  return { ok: true, data: { slug } };
}

export async function archiveSector(id: string): Promise<ActionResult<{ parentSlug: string | null }>> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(id)) return err('That area no longer exists.');
  const { data: s } = await db().from('align_sectors').select('id, parent_id').eq('id', id).maybeSingle();
  if (!s) return err('That area no longer exists.');
  if (!s.parent_id) return err('Top-level sectors stay. You can set one to Maintain instead.');
  const { error } = await db().from('align_sectors').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', id);
  if (error) return err('Could not archive it. Try again.');
  const { data: parent } = await db().from('align_sectors').select('slug').eq('id', s.parent_id).maybeSingle();
  refresh();
  return { ok: true, data: { parentSlug: (parent?.slug as string) ?? null } };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export async function createLink(
  from: { type: string; id: string },
  to: { type: string; id: string },
  relation: string,
): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!OBJECT_TYPES.includes(from.type as ObjectType) || !OBJECT_TYPES.includes(to.type as ObjectType)) return err('Unknown page type.');
  if (!isId(from.id) || !isId(to.id)) return err('One of those pages no longer exists.');
  if (from.type === to.type && from.id === to.id) return err('A page cannot link to itself.');
  if (!RELATIONS.includes(relation as Relation)) return err('Pick how they connect.');
  const { error } = await db()
    .from('align_links')
    .insert({ from_type: from.type, from_id: from.id, to_type: to.type, to_id: to.id, relation });
  if (error) return err(dbError(error, 'Could not link them. Try again.'));
  refresh();
  return { ok: true };
}

export async function deleteLink(linkId: string): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(linkId)) return err('That link is already gone.');
  const { error } = await db().from('align_links').delete().eq('id', linkId);
  if (error) return err('Could not remove the link. Try again.');
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addNote(type: string, id: string, body: string): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!OBJECT_TYPES.includes(type as ObjectType) || !isId(id)) return err('That page no longer exists.');
  const text = cleanBody(body, 20_000);
  if (!text) return err('Write something first.');
  const { error } = await db().from('align_notes').insert({ attached_type: type, attached_id: id, body: text });
  if (error) return err('Could not save the note. Try again.');
  refresh();
  return { ok: true };
}

export async function updateNote(noteId: string, body: string): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(noteId)) return err('That note no longer exists.');
  const text = cleanBody(body, 20_000);
  if (!text) return err('A note cannot be empty. Remove it instead.');
  const { error } = await db().from('align_notes').update({ body: text }).eq('id', noteId);
  if (error) return err('Could not save the note. Try again.');
  refresh();
  return { ok: true };
}

export async function removeNote(noteId: string): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!isId(noteId)) return err('That note no longer exists.');
  const { error } = await db().from('align_notes').update({ archived: true }).eq('id', noteId);
  if (error) return err('Could not remove the note. Try again.');
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

export async function setPinned(type: string, id: string, pinned: boolean): Promise<ActionResult> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  if (!OBJECT_TYPES.includes(type as ObjectType) || !isId(id)) return err('That page no longer exists.');
  const { error } = pinned
    ? await db().from('align_pins').upsert({ object_type: type, object_id: id })
    : await db().from('align_pins').delete().eq('object_type', type).eq('object_id', id);
  if (error) return err('Could not update the pin. Try again.');
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Search (quick switcher and the link picker)
// ---------------------------------------------------------------------------

export async function findObjects(query: string, types?: string[]): Promise<ActionResult<ObjectRef[]>> {
  if (!(await hasSession())) return err(SIGNED_OUT);
  const q = cleanText(query, 120);
  const t = types?.filter((x) => OBJECT_TYPES.includes(x as ObjectType));
  if (!q) {
    // Empty query: recently viewed, so the switcher is useful before typing.
    const { data } = await db().from('align_recent').select('object_type, object_id').order('viewed_at', { ascending: false }).limit(20);
    const rows = (data ?? []) as { object_type: ObjectType; object_id: string }[];
    const ids = rows.map((r) => r.object_id);
    if (!ids.length) return { ok: true, data: [] };
    const { data: objs } = await db().from('align_objects').select('object_type, id, title, kind, sector_id, status, slug, archived').in('id', ids);
    const map = new Map(((objs ?? []) as (ObjectRef & { archived: boolean })[]).filter((o) => !o.archived).map((o) => [`${o.object_type}:${o.id}`, o]));
    const list = rows
      .map((r) => map.get(`${r.object_type}:${r.object_id}`))
      .filter((o): o is ObjectRef & { archived: boolean } => Boolean(o))
      .filter((o) => !t?.length || t.includes(o.object_type))
      .slice(0, 12)
      .map(({ archived: _a, ...o }) => o);
    return { ok: true, data: list };
  }
  const { data, error } = await db().rpc('align_search', { p_q: q, p_limit: 24, p_types: t?.length ? t : null });
  if (error) return err('Search is not working right now. Try again.');
  return { ok: true, data: (data ?? []) as ObjectRef[] };
}
