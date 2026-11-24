-- Align 0006: the calendar.
--
-- A block is a slot of time on the calendar. It can belong to a page (an action,
-- a task, a week, anything) or stand on its own (a meeting, an errand). Pages
-- keep their dates (start, due, event); blocks are when the work actually happens.
-- Times are stored as instants; the app shows them in America/New_York.

create table if not exists public.align_blocks (
  id uuid primary key default gen_random_uuid(),
  node_id uuid references public.align_nodes (id) on delete cascade,
  sector_id uuid references public.align_sectors (id) on delete set null,
  title text not null default '' check (char_length(title) <= 300),
  notes text not null default '' check (char_length(notes) <= 5000),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped')),
  source text not null default 'align' check (source in ('align', 'chatgpt', 'google')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check (end_at - start_at <= interval '24 hours'),
  check (node_id is not null or char_length(title) > 0)
);
create index if not exists align_blocks_time_idx on public.align_blocks (start_at, end_at);
create index if not exists align_blocks_node_idx on public.align_blocks (node_id, start_at);
create unique index if not exists align_blocks_external_idx on public.align_blocks (source, external_id) where external_id is not null;

-- A block linked to a page takes the page's sector.
create or replace function public.align_blocks_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.node_id is not null and (tg_op = 'INSERT' or new.node_id is distinct from old.node_id or new.sector_id is null) then
    select sector_id into new.sector_id from public.align_nodes where id = new.node_id;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists align_blocks_guard on public.align_blocks;
create trigger align_blocks_guard before insert or update on public.align_blocks
  for each row execute function public.align_blocks_guard();

-- History on the linked page, and finishing a block finishes a one-off action.
create or replace function public.align_blocks_log()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.node_id is not null then
      insert into public.align_activity (object_type, object_id, action, detail)
        values ('node', new.node_id, 'scheduled', jsonb_build_object('start', new.start_at, 'end', new.end_at));
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.node_id is not null then
      insert into public.align_activity (object_type, object_id, action, detail)
        values ('node', old.node_id, 'unscheduled', jsonb_build_object('start', old.start_at));
    end if;
    return old;
  end if;
  if new.node_id is not null then
    if new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at then
      -- Dragging a block around writes one entry per ten minutes, not one per drop.
      if not exists (
        select 1 from public.align_activity
        where object_type = 'node' and object_id = new.node_id and action in ('scheduled', 'rescheduled') and at > now() - interval '10 minutes'
      ) then
        insert into public.align_activity (object_type, object_id, action, detail)
          values ('node', new.node_id, 'rescheduled', jsonb_build_object('start', new.start_at, 'end', new.end_at));
      end if;
    end if;
    if new.status is distinct from old.status and new.status in ('done', 'skipped') then
      insert into public.align_activity (object_type, object_id, action, detail)
        values ('node', new.node_id, case when new.status = 'done' then 'session_done' else 'session_skipped' end, jsonb_build_object('start', new.start_at));
      if new.status = 'done' then
        update public.align_nodes set status = 'done'
         where id = new.node_id and type in ('action', 'task') and status <> 'done';
      end if;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists align_blocks_log on public.align_blocks;
create trigger align_blocks_log after insert or update or delete on public.align_blocks
  for each row execute function public.align_blocks_log();

-- Locked down like every other align_ table.
alter table public.align_blocks enable row level security;
drop policy if exists align_deny_public on public.align_blocks;
create policy align_deny_public on public.align_blocks for all to anon, authenticated using (false) with check (false);
revoke all on public.align_blocks from anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('align_blocks_guard', 'align_blocks_log')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
