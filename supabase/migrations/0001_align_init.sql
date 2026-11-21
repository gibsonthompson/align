-- Align, phase 1: the skeleton of a life.
-- Lives in the shared Detail Pro database, so every object is prefixed align_.
-- RLS is on everywhere with deny-all policies: only the app's server (service role)
-- ever reads or writes. Functions and the view run as the caller, never as owner.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Settings and the PIN gate
-- ---------------------------------------------------------------------------

create table if not exists public.align_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.align_pin_attempts (
  id bigint generated always as identity primary key,
  attempted_at timestamptz not null default now(),
  success boolean not null default false,
  ip text
);
create index if not exists align_pin_attempts_at_idx on public.align_pin_attempts (attempted_at desc);

-- Checks the lockout and records the attempt in one locked step, so parallel guesses are counted one by one.
create or replace function public.align_pin_try(p_ip text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_last_success timestamptz; v_until timestamptz; v_f15 int; v_f24 int; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('align_pin_try'));
  select max(attempted_at) into v_last_success from public.align_pin_attempts where success is true;
  v_until := null;
  select s.attempted_at + interval '24 hours' into v_until from (
    select attempted_at from public.align_pin_attempts
    where success is not true and attempted_at > now() - interval '24 hours'
      and (v_last_success is null or attempted_at > v_last_success)
    order by attempted_at desc offset 9 limit 1) s;
  if v_until is not null and v_until > now() then return jsonb_build_object('allowed', false, 'until', v_until); end if;
  v_until := null;
  select s.attempted_at + interval '15 minutes' into v_until from (
    select attempted_at from public.align_pin_attempts
    where success is not true and attempted_at > now() - interval '15 minutes'
      and (v_last_success is null or attempted_at > v_last_success)
    order by attempted_at desc offset 4 limit 1) s;
  if v_until is not null and v_until > now() then return jsonb_build_object('allowed', false, 'until', v_until); end if;
  insert into public.align_pin_attempts (attempted_at, success, ip) values (now(), false, left(p_ip, 64)) returning id into v_id;
  select count(*) filter (where attempted_at > now() - interval '15 minutes'), count(*) into v_f15, v_f24
  from public.align_pin_attempts
  where success is not true and attempted_at > now() - interval '24 hours'
    and (v_last_success is null or attempted_at > v_last_success);
  return jsonb_build_object('allowed', true, 'attempt_id', v_id, 'failures_15m', v_f15, 'failures_24h', v_f24);
end; $$;

create or replace function public.align_pin_succeeded(p_id bigint)
returns void language sql set search_path = '' as $$
  update public.align_pin_attempts set success = true where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.align_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- Sectors (the nine defaults, custom ones, and subcategories via parent_id)
-- ---------------------------------------------------------------------------

create table if not exists public.align_sectors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 80),
  parent_id uuid references public.align_sectors(id),
  colour text not null default '#8a8a8a' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  icon text not null default 'circle',
  summary text not null default '',
  cover_image_id uuid,
  importance smallint check (importance between 1 and 10),
  satisfaction smallint check (satisfaction between 1 and 10),
  attention_needed smallint check (attention_needed between 1 and 10),
  mode text check (mode in ('priority', 'maintain')),
  sort double precision not null default 0,
  archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index if not exists align_sectors_parent_idx on public.align_sectors (parent_id);
drop trigger if exists align_sectors_touch on public.align_sectors;
create trigger align_sectors_touch before update on public.align_sectors
  for each row execute function public.align_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Nodes: every goal-shaped object. parent_id builds the tree, no depth limit.
-- ---------------------------------------------------------------------------

create table if not exists public.align_nodes (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('vision', 'milestone', 'objective', 'commitment', 'action', 'micro_goal', 'project', 'phase', 'task')),
  title text not null check (char_length(title) between 1 and 300),
  body text not null default '',
  sector_id uuid references public.align_sectors(id),
  parent_id uuid references public.align_nodes(id),
  status text not null default 'active' check (status in ('inbox', 'planned', 'active', 'done', 'paused', 'abandoned')),
  priority smallint check (priority between 1 and 3),
  start_date date,
  due_date date,
  done_at timestamptz,
  sort double precision not null default 0,
  cover_image_id uuid,
  archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored,
  check (parent_id is null or parent_id <> id)
);
create index if not exists align_nodes_parent_idx on public.align_nodes (parent_id, sort) where not archived;
create index if not exists align_nodes_sector_idx on public.align_nodes (sector_id) where not archived;
create index if not exists align_nodes_type_idx on public.align_nodes (type, status) where not archived;
create index if not exists align_nodes_due_idx on public.align_nodes (due_date) where not archived and due_date is not null;
create index if not exists align_nodes_search_idx on public.align_nodes using gin (search);
create index if not exists align_nodes_title_trgm on public.align_nodes using gin (title extensions.gin_trgm_ops);

-- Keeps the tree a tree (no node under its own descendant), fills done_at,
-- and inherits the sector from the parent when none is given.
create or replace function public.align_nodes_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_hit boolean;
begin
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    with recursive up as (
      select id, parent_id, 0 as d from public.align_nodes where id = new.parent_id
      union all
      select n.id, n.parent_id, up.d + 1 from public.align_nodes n join up on n.id = up.parent_id where up.d < 256
    )
    select exists (select 1 from up where id = new.id) into v_hit;
    if v_hit then raise exception 'A page cannot sit under one of its own pages' using errcode = '23514'; end if;
    if new.sector_id is null then
      select sector_id into new.sector_id from public.align_nodes where id = new.parent_id;
    end if;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then new.done_at := coalesce(new.done_at, now()); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  if new.archived and (tg_op = 'INSERT' or not old.archived) then new.archived_at := now(); end if;
  if not new.archived then new.archived_at := null; end if;
  return new;
end; $$;
drop trigger if exists align_nodes_guard on public.align_nodes;
create trigger align_nodes_guard before insert or update on public.align_nodes
  for each row execute function public.align_nodes_guard();
drop trigger if exists align_nodes_touch on public.align_nodes;
create trigger align_nodes_touch before update on public.align_nodes
  for each row execute function public.align_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Object registry: which types exist and whether an id is real.
-- Later phases add habit, event, image, review and metric here.
-- ---------------------------------------------------------------------------

create or replace function public.align_object_exists(p_type text, p_id uuid)
returns boolean language plpgsql stable set search_path = '' as $$
begin
  case p_type
    when 'sector' then return exists (select 1 from public.align_sectors where id = p_id);
    when 'node' then return exists (select 1 from public.align_nodes where id = p_id);
    else return false;
  end case;
end; $$;

-- ---------------------------------------------------------------------------
-- Links: any object to any other, read in both directions.
-- ---------------------------------------------------------------------------

create table if not exists public.align_links (
  id uuid primary key default gen_random_uuid(),
  from_type text not null,
  from_id uuid not null,
  to_type text not null,
  to_id uuid not null,
  relation text not null default 'related' check (relation in ('supports', 'depends_on', 'pictured_in', 'scheduled_as', 'reviewed_in', 'related')),
  created_at timestamptz not null default now(),
  unique (from_type, from_id, to_type, to_id, relation),
  check (not (from_type = to_type and from_id = to_id))
);
create index if not exists align_links_from_idx on public.align_links (from_type, from_id);
create index if not exists align_links_to_idx on public.align_links (to_type, to_id);

create or replace function public.align_links_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.align_object_exists(new.from_type, new.from_id) then
    raise exception 'Link start does not exist' using errcode = '23503';
  end if;
  if not public.align_object_exists(new.to_type, new.to_id) then
    raise exception 'Link target does not exist' using errcode = '23503';
  end if;
  -- "related" is symmetric: one row covers both directions.
  if new.relation = 'related' and exists (
    select 1 from public.align_links
    where relation = 'related' and from_type = new.to_type and from_id = new.to_id and to_type = new.from_type and to_id = new.from_id
  ) then
    raise exception 'These are already linked' using errcode = '23505';
  end if;
  return new;
end; $$;
drop trigger if exists align_links_guard on public.align_links;
create trigger align_links_guard before insert or update on public.align_links
  for each row execute function public.align_links_guard();

-- ---------------------------------------------------------------------------
-- Notes on any page
-- ---------------------------------------------------------------------------

create table if not exists public.align_notes (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 1 and 20000),
  attached_type text not null,
  attached_id uuid not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('english', coalesce(body, ''))) stored
);
create index if not exists align_notes_attached_idx on public.align_notes (attached_type, attached_id, created_at desc) where not archived;
create index if not exists align_notes_search_idx on public.align_notes using gin (search);
drop trigger if exists align_notes_touch on public.align_notes;
create trigger align_notes_touch before update on public.align_notes
  for each row execute function public.align_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Activity: the history timeline on every page. Written by triggers so every
-- change is recorded, whether it came from the app or later from Clyde.
-- ---------------------------------------------------------------------------

create table if not exists public.align_activity (
  id bigint generated always as identity primary key,
  object_type text not null,
  object_id uuid not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists align_activity_object_idx on public.align_activity (object_type, object_id, at desc);
create index if not exists align_activity_at_idx on public.align_activity (at desc);

create or replace function public.align_log_node()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, 'created', jsonb_build_object('title', new.title, 'type', new.type));
    if new.parent_id is not null then
      insert into public.align_activity (object_type, object_id, action, detail)
        values ('node', new.parent_id, 'child_added', jsonb_build_object('child_id', new.id, 'title', new.title, 'type', new.type));
    end if;
    return new;
  end if;
  if new.title is distinct from old.title then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, 'renamed', jsonb_build_object('from', old.title, 'to', new.title));
  end if;
  if new.status is distinct from old.status then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, case when new.status = 'done' then 'completed' else 'status' end, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.archived is distinct from old.archived then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, case when new.archived then 'archived' else 'restored' end, '{}'::jsonb);
  end if;
  if new.parent_id is distinct from old.parent_id then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, 'moved', jsonb_build_object('from', old.parent_id, 'to', new.parent_id));
  end if;
  if new.due_date is distinct from old.due_date or new.start_date is distinct from old.start_date then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, 'dates', jsonb_build_object('start', new.start_date, 'due', new.due_date));
  end if;
  if new.body is distinct from old.body and new.title is not distinct from old.title then
    -- Collapse rapid body edits into one entry per ten minutes.
    if not exists (
      select 1 from public.align_activity
      where object_type = 'node' and object_id = new.id and action = 'edited' and at > now() - interval '10 minutes'
    ) then
      insert into public.align_activity (object_type, object_id, action, detail) values ('node', new.id, 'edited', '{}'::jsonb);
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists align_nodes_log on public.align_nodes;
create trigger align_nodes_log after insert or update on public.align_nodes
  for each row execute function public.align_log_node();

create or replace function public.align_log_sector()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('sector', new.id, 'created', jsonb_build_object('title', new.name));
    return new;
  end if;
  if new.name is distinct from old.name then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('sector', new.id, 'renamed', jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  if new.archived is distinct from old.archived then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('sector', new.id, case when new.archived then 'archived' else 'restored' end, '{}'::jsonb);
  end if;
  if (new.importance, new.satisfaction, new.attention_needed, new.mode) is distinct from (old.importance, old.satisfaction, old.attention_needed, old.mode) then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('sector', new.id, 'rated', jsonb_build_object('importance', new.importance, 'satisfaction', new.satisfaction, 'attention', new.attention_needed, 'mode', new.mode));
  end if;
  return new;
end; $$;
drop trigger if exists align_sectors_log on public.align_sectors;
create trigger align_sectors_log after insert or update on public.align_sectors
  for each row execute function public.align_log_sector();

create or replace function public.align_log_link()
returns trigger language plpgsql set search_path = '' as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into public.align_activity (object_type, object_id, action, detail) values
    (r.from_type, r.from_id, case when tg_op = 'DELETE' then 'unlinked' else 'linked' end,
      jsonb_build_object('relation', r.relation, 'direction', 'out', 'other_type', r.to_type, 'other_id', r.to_id)),
    (r.to_type, r.to_id, case when tg_op = 'DELETE' then 'unlinked' else 'linked' end,
      jsonb_build_object('relation', r.relation, 'direction', 'in', 'other_type', r.from_type, 'other_id', r.from_id));
  return r;
end; $$;
drop trigger if exists align_links_log on public.align_links;
create trigger align_links_log after insert or delete on public.align_links
  for each row execute function public.align_log_link();

create or replace function public.align_log_note()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.align_activity (object_type, object_id, action, detail)
      values (new.attached_type, new.attached_id, 'note_added', jsonb_build_object('note_id', new.id, 'preview', left(new.body, 140)));
  elsif new.archived and not old.archived then
    insert into public.align_activity (object_type, object_id, action, detail)
      values (new.attached_type, new.attached_id, 'note_removed', jsonb_build_object('note_id', new.id));
  end if;
  return new;
end; $$;
drop trigger if exists align_notes_log on public.align_notes;
create trigger align_notes_log after insert or update on public.align_notes
  for each row execute function public.align_log_note();

-- ---------------------------------------------------------------------------
-- Pinned and recently viewed
-- ---------------------------------------------------------------------------

create table if not exists public.align_pins (
  object_type text not null,
  object_id uuid not null,
  pinned_at timestamptz not null default now(),
  primary key (object_type, object_id)
);

create table if not exists public.align_recent (
  object_type text not null,
  object_id uuid not null,
  viewed_at timestamptz not null default now(),
  primary key (object_type, object_id)
);
create index if not exists align_recent_at_idx on public.align_recent (viewed_at desc);

-- ---------------------------------------------------------------------------
-- The object view: one list of everything, for search, links, the quick
-- switcher, pins and recents. security_invoker keeps RLS in force.
-- ---------------------------------------------------------------------------

create or replace view public.align_objects with (security_invoker = true) as
  select 'sector'::text as object_type, s.id, s.name as title,
    case when s.parent_id is null then 'sector' else 'area' end as kind,
    s.id as sector_id, null::text as status, s.archived, s.updated_at, s.slug,
    to_tsvector('english', s.name || ' ' || coalesce(s.summary, '')) as search
  from public.align_sectors s
  union all
  select 'node', n.id, n.title, n.type, n.sector_id, n.status, n.archived, n.updated_at, null, n.search
  from public.align_nodes n;

-- Breadcrumbs: the sector chain (top first), then every ancestor node, then the node itself.
create or replace function public.align_node_path(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  with recursive up as (
    select n.id, n.parent_id, n.title, n.type, n.sector_id, 0 as d from public.align_nodes n where n.id = p_id
    union all
    select p.id, p.parent_id, p.title, p.type, p.sector_id, up.d + 1
    from public.align_nodes p join up on p.id = up.parent_id where up.d < 256
  ),
  root as (select sector_id from up order by d desc limit 1),
  sec as (
    select s.id, s.parent_id, s.name, s.slug, s.colour, 0 as d from public.align_sectors s join root on s.id = root.sector_id
    union all
    select s.id, s.parent_id, s.name, s.slug, s.colour, sec.d + 1
    from public.align_sectors s join sec on s.id = sec.parent_id where sec.d < 16
  )
  select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) from (
    select 'sector' as object_type, id, name as title, 'sector' as kind, slug, colour, -100000 - d as ord from sec
    union all
    select 'node', id, title, type, null, null, -d from up
  ) x;
$$;

-- Sector breadcrumbs (for subcategory pages).
create or replace function public.align_sector_path(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  with recursive sec as (
    select s.id, s.parent_id, s.name, s.slug, s.colour, 0 as d from public.align_sectors s where s.id = p_id
    union all
    select s.id, s.parent_id, s.name, s.slug, s.colour, sec.d + 1
    from public.align_sectors s join sec on s.id = sec.parent_id where sec.d < 16
  )
  select coalesce(jsonb_agg(jsonb_build_object('object_type', 'sector', 'id', id, 'title', name, 'kind', 'sector', 'slug', slug, 'colour', colour) order by d desc), '[]'::jsonb) from sec;
$$;

-- Children of a node, or the top-level pages of a sector, each with how many
-- pages sit under it and how many links it carries.
create or replace function public.align_children(p_parent uuid default null, p_sector uuid default null, p_include_done boolean default true)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'type', n.type, 'title', n.title, 'status', n.status, 'priority', n.priority,
      'start_date', n.start_date, 'due_date', n.due_date, 'sector_id', n.sector_id, 'sort', n.sort,
      'child_count', (select count(*) from public.align_nodes c where c.parent_id = n.id and not c.archived),
      'done_count', (select count(*) from public.align_nodes c where c.parent_id = n.id and not c.archived and c.status = 'done'),
      'link_count', (select count(*) from public.align_links l
                      where (l.from_type = 'node' and l.from_id = n.id) or (l.to_type = 'node' and l.to_id = n.id))
    ) order by n.sort, n.created_at), '[]'::jsonb)
  from public.align_nodes n
  where not n.archived
    and (p_include_done or n.status <> 'done')
    and case when p_parent is not null then n.parent_id = p_parent
             else n.parent_id is null and n.sector_id = p_sector end;
$$;

-- Everything linked to an object, both directions, with the other side's title.
create or replace function public.align_links_for(p_type text, p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'link_id', l.link_id, 'relation', l.relation, 'direction', l.direction,
      'object_type', o.object_type, 'id', o.id, 'title', o.title, 'kind', o.kind,
      'sector_id', o.sector_id, 'status', o.status, 'slug', o.slug, 'created_at', l.created_at
    ) order by l.created_at desc), '[]'::jsonb)
  from (
    select id as link_id, relation, 'out'::text as direction, to_type as t, to_id as oid, created_at
      from public.align_links where from_type = p_type and from_id = p_id
    union all
    select id, relation, 'in', from_type, from_id, created_at
      from public.align_links where to_type = p_type and to_id = p_id
  ) l
  join public.align_objects o on o.object_type = l.t and o.id = l.oid
  where not o.archived;
$$;

-- Search across everything: titles, bodies, sector summaries and notes.
-- Short queries match titles by prefix and similarity (the quick switcher);
-- longer ones also use full text.
create or replace function public.align_search(p_q text, p_limit int default 30, p_types text[] default null)
returns jsonb language sql stable set search_path = '' as $$
  with q as (
    select trim(p_q) as raw,
      case when char_length(trim(p_q)) >= 3 then websearch_to_tsquery('english', trim(p_q)) end as tsq
  ),
  hits as (
    select o.object_type, o.id, o.title, o.kind, o.sector_id, o.status, o.slug, o.updated_at,
      greatest(
        case when lower(o.title) = lower(q.raw) then 3 else 0 end,
        case when o.title ilike q.raw || '%' then 2 else 0 end,
        case when o.title ilike '%' || q.raw || '%' then 1.2 else 0 end,
        extensions.similarity(o.title, q.raw),
        case when q.tsq is not null then ts_rank(o.search, q.tsq) * 2 else 0 end
      ) as score,
      null::text as snippet
    from public.align_objects o, q
    where not o.archived and q.raw <> ''
      and (p_types is null or o.object_type = any(p_types))
      and (o.title ilike '%' || q.raw || '%'
           or extensions.similarity(o.title, q.raw) > 0.2
           or (q.tsq is not null and o.search @@ q.tsq))
    union all
    select o.object_type, o.id, o.title, o.kind, o.sector_id, o.status, o.slug, o.updated_at,
      ts_rank(nt.search, q.tsq) as score, left(nt.body, 160)
    from public.align_notes nt, q
    join public.align_objects o on true
    where q.tsq is not null and not nt.archived and nt.search @@ q.tsq
      and o.object_type = nt.attached_type and o.id = nt.attached_id and not o.archived
      and (p_types is null or o.object_type = any(p_types))
  ),
  best as (
    select distinct on (object_type, id) * from hits order by object_type, id, score desc
  )
  select coalesce(jsonb_agg(to_jsonb(b) - 'score' order by b.score desc, b.updated_at desc), '[]'::jsonb)
  from (select * from best order by score desc, updated_at desc limit greatest(1, least(p_limit, 100))) b;
$$;

-- ---------------------------------------------------------------------------
-- Lock everything down: RLS on with deny-all, nothing callable from the browser.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['align_settings', 'align_pin_attempts', 'align_sectors', 'align_nodes', 'align_links', 'align_notes', 'align_activity', 'align_pins', 'align_recent']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists align_deny_public on public.%I', t);
    execute format('create policy align_deny_public on public.%I for all to anon, authenticated using (false) with check (false)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on public.align_objects from anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'align\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seed: the nine default sectors and their subcategories.
-- ---------------------------------------------------------------------------

insert into public.align_sectors (slug, name, colour, icon, sort) values
  ('business', 'Business & Career', '#5b8def', 'briefcase', 1),
  ('finance', 'Financial Health & Wealth', '#3fb68b', 'wallet', 2),
  ('health', 'Physical Health & Fitness', '#ef6b5b', 'dumbbell', 3),
  ('recreation', 'Sports, Hobbies & Recreation', '#f2a13b', 'guitar', 4),
  ('relationships', 'Relationships & Social Life', '#e86fa8', 'users', 5),
  ('growth', 'Personal Development & Education', '#8f7cf0', 'graduation-cap', 6),
  ('mind', 'Mental Wellbeing & Inner Life', '#4fc1d1', 'brain', 7),
  ('environment', 'Environment & Lifestyle', '#c4a77d', 'house', 8),
  ('experiences', 'Experiences & Adventure', '#d9c34a', 'compass', 9)
on conflict (slug) do nothing;

with subs(parent_slug, slug, name, sort) as (values
  ('business', 'business-entrepreneurship', 'Entrepreneurship', 1),
  ('business', 'business-career', 'Career Progression', 2),
  ('business', 'business-professional-development', 'Professional Development', 3),
  ('business', 'business-growth', 'Business Growth', 4),
  ('business', 'business-skills', 'Skills & Opportunities', 5),
  ('finance', 'finance-income', 'Income', 1),
  ('finance', 'finance-budgeting', 'Budgeting', 2),
  ('finance', 'finance-savings', 'Savings', 3),
  ('finance', 'finance-debt', 'Debt Reduction', 4),
  ('finance', 'finance-investments', 'Investments', 5),
  ('finance', 'finance-independence', 'Net Worth & Independence', 6),
  ('health', 'health-strength', 'Strength & Muscle', 1),
  ('health', 'health-cardio', 'Cardiovascular Fitness', 2),
  ('health', 'health-sports-performance', 'Sports Performance', 3),
  ('health', 'health-nutrition', 'Nutrition', 4),
  ('health', 'health-sleep', 'Sleep & Recovery', 5),
  ('health', 'health-general', 'General Physical Health', 6),
  ('recreation', 'recreation-sports', 'Sports', 1),
  ('recreation', 'recreation-music', 'Music & Creative Pursuits', 2),
  ('recreation', 'recreation-skills', 'Skill Development', 3),
  ('recreation', 'recreation-entertainment', 'Entertainment', 4),
  ('recreation', 'recreation-activities', 'Recreational Activities', 5),
  ('relationships', 'relationships-family', 'Family', 1),
  ('relationships', 'relationships-friendships', 'Friendships', 2),
  ('relationships', 'relationships-romantic', 'Romantic Relationships', 3),
  ('relationships', 'relationships-dating', 'Dating', 4),
  ('relationships', 'relationships-community', 'Community', 5),
  ('relationships', 'relationships-social', 'Social Development', 6),
  ('growth', 'growth-reading', 'Reading', 1),
  ('growth', 'growth-learning', 'Learning', 2),
  ('growth', 'growth-communication', 'Communication', 3),
  ('growth', 'growth-intellectual', 'Intellectual Development', 4),
  ('growth', 'growth-skills', 'Professional & Personal Skills', 5),
  ('mind', 'mind-stress', 'Stress Management', 1),
  ('mind', 'mind-resilience', 'Emotional Resilience', 2),
  ('mind', 'mind-self-awareness', 'Self-Awareness', 3),
  ('mind', 'mind-confidence', 'Confidence', 4),
  ('mind', 'mind-mindfulness', 'Mindfulness', 5),
  ('mind', 'mind-fulfillment', 'Personal Fulfillment', 6),
  ('environment', 'environment-living', 'Living Arrangements', 1),
  ('environment', 'environment-home', 'Home Environment', 2),
  ('environment', 'environment-organization', 'Organization', 3),
  ('environment', 'environment-routines', 'Daily Routines', 4),
  ('environment', 'environment-lifestyle', 'Lifestyle Design', 5),
  ('environment', 'environment-surroundings', 'Quality of Surroundings', 6),
  ('experiences', 'experiences-travel', 'Travel', 1),
  ('experiences', 'experiences-exploring', 'Exploring New Places', 2),
  ('experiences', 'experiences-bucket-list', 'Bucket-List Experiences', 3),
  ('experiences', 'experiences-events', 'Events', 4),
  ('experiences', 'experiences-challenges', 'Personal Challenges', 5),
  ('experiences', 'experiences-memorable', 'Memorable Experiences', 6)
)
insert into public.align_sectors (slug, name, parent_id, colour, icon, sort)
select subs.slug, subs.name, p.id, p.colour, p.icon, subs.sort
from subs join public.align_sectors p on p.slug = subs.parent_slug
on conflict (slug) do nothing;
