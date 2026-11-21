-- Align: the brain. What makes a page actionable, the brain's conversation on
-- each page, and the facts it learns about Gibson so it never asks twice.

alter table public.align_nodes
  add column if not exists done_criteria text not null default '',
  add column if not exists effort_minutes integer check (effort_minutes is null or effort_minutes between 1 and 100000),
  add column if not exists cadence text not null default '',
  add column if not exists actionable boolean not null default false,
  add column if not exists brain_state text not null default 'untouched'
    check (brain_state in ('untouched', 'asking', 'proposed', 'broken_down', 'actionable'));

-- One row per turn: Gibson's answers or messages, and the brain's replies
-- (assessment, questions, proposals with their accept status) in data.
create table if not exists public.align_brain_messages (
  id uuid primary key default gen_random_uuid(),
  object_type text not null check (object_type in ('sector', 'node')),
  object_id uuid not null,
  role text not null check (role in ('user', 'brain')),
  content text not null default '',
  data jsonb not null default '{}'::jsonb,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists align_brain_messages_object_idx on public.align_brain_messages (object_type, object_id, created_at);

-- Durable facts about Gibson (tastes, level, gear, time, constraints).
-- Scoped to a sector, a page, or everything (both null).
create table if not exists public.align_facts (
  id uuid primary key default gen_random_uuid(),
  fact text not null check (char_length(fact) between 1 and 500),
  sector_id uuid references public.align_sectors(id),
  node_id uuid references public.align_nodes(id),
  source text not null default 'brain' check (source in ('brain', 'gibson')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists align_facts_sector_idx on public.align_facts (sector_id) where not archived;
create index if not exists align_facts_node_idx on public.align_facts (node_id) where not archived;

-- Children now carry what makes them actionable.
create or replace function public.align_children(p_parent uuid default null, p_sector uuid default null, p_include_done boolean default true)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'type', n.type, 'title', n.title, 'status', n.status, 'priority', n.priority,
      'start_date', n.start_date, 'due_date', n.due_date, 'sector_id', n.sector_id, 'sort', n.sort,
      'done_criteria', n.done_criteria, 'effort_minutes', n.effort_minutes, 'cadence', n.cadence,
      'actionable', n.actionable, 'brain_state', n.brain_state,
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

do $$
declare t text;
begin
  foreach t in array array['align_brain_messages', 'align_facts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists align_deny_public on public.%I', t);
    execute format('create policy align_deny_public on public.%I for all to anon, authenticated using (false) with check (false)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'align_children'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
