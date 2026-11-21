-- Align, phase 1: tree operations and sector counts.

-- Page counts per sector. own_pages counts pages filed directly on the sector or area;
-- pages, active, done and overdue roll areas up into their top-level sector.
create or replace function public.align_sector_counts()
returns table (sector_id uuid, own_pages bigint, pages bigint, active bigint, done bigint, overdue bigint)
language sql stable set search_path = '' as $$
  with n as (
    select n.sector_id, n.status, n.due_date from public.align_nodes n where not n.archived
  ),
  own as (select n.sector_id, count(*) as c from n group by 1),
  rolled as (
    select coalesce(s.parent_id, s.id) as top, n.status, n.due_date
    from n join public.align_sectors s on s.id = n.sector_id
  ),
  tops as (
    select top,
      count(*) as pages,
      count(*) filter (where status = 'active') as active,
      count(*) filter (where status = 'done') as done,
      count(*) filter (where due_date < (now() at time zone 'America/New_York')::date
                        and status in ('active', 'planned', 'inbox', 'paused')) as overdue
    from rolled group by top
  )
  select s.id, coalesce(own.c, 0), coalesce(t.pages, 0), coalesce(t.active, 0), coalesce(t.done, 0), coalesce(t.overdue, 0)
  from public.align_sectors s
  left join own on own.sector_id = s.id
  left join tops t on t.top = s.id
  where not s.archived;
$$;

-- Archives a page and everything under it, or restores it along with the pages
-- that were archived with it (pages archived separately before stay archived).
create or replace function public.align_archive_node(p_id uuid, p_archived boolean)
returns integer language plpgsql set search_path = '' as $$
declare v_at timestamptz; v_count integer;
begin
  select archived_at into v_at from public.align_nodes where id = p_id;
  if not found then raise exception 'Page not found' using errcode = 'P0002'; end if;
  if p_archived then
    with recursive sub as (
      select id, 0 as d from public.align_nodes where id = p_id
      union all
      select n.id, sub.d + 1 from public.align_nodes n join sub on n.parent_id = sub.id where sub.d < 256
    )
    update public.align_nodes set archived = true where id in (select id from sub) and not archived;
  else
    with recursive sub as (
      select id, 0 as d from public.align_nodes where id = p_id
      union all
      select n.id, sub.d + 1 from public.align_nodes n join sub on n.parent_id = sub.id where sub.d < 256
    )
    update public.align_nodes set archived = false
    where id in (select id from sub) and archived
      and (id = p_id or (v_at is not null and archived_at >= v_at - interval '5 seconds'));
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Moves a page under a new parent (or to the top of a sector) and carries its
-- whole branch into the new sector. The tree guard refuses a move under itself.
create or replace function public.align_move_node(p_id uuid, p_parent uuid, p_sector uuid)
returns void language plpgsql set search_path = '' as $$
declare v_sector uuid; v_sort double precision;
begin
  if p_parent is not null then
    select sector_id into v_sector from public.align_nodes where id = p_parent;
    if not found then raise exception 'That page no longer exists' using errcode = 'P0002'; end if;
    select coalesce(max(sort), 0) + 1 into v_sort from public.align_nodes where parent_id = p_parent and not archived;
  else
    v_sector := p_sector;
    select coalesce(max(sort), 0) + 1 into v_sort from public.align_nodes
      where parent_id is null and sector_id is not distinct from p_sector and not archived;
  end if;
  update public.align_nodes set parent_id = p_parent, sort = v_sort where id = p_id;
  if not found then raise exception 'Page not found' using errcode = 'P0002'; end if;
  with recursive sub as (
    select id, 0 as d from public.align_nodes where id = p_id
    union all
    select n.id, sub.d + 1 from public.align_nodes n join sub on n.parent_id = sub.id where sub.d < 256
  )
  update public.align_nodes set sector_id = v_sector
  where id in (select id from sub) and sector_id is distinct from v_sector;
end; $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('align_sector_counts', 'align_archive_node', 'align_move_node')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
