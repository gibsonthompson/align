-- Align 0005: Month and Week levels, and event details on any page.
--
-- Month and Week sit between a 90-Day Objective (or a 12-Month Milestone, or a
-- Project) and the Daily Actions, so a plan can run month, then week, then day.
-- A Weekly Commitment is a recurring habit ("run 3 times a week"); a Week is one
-- specific dated week of a plan ("Week of Dec 7: 14 miles total").
--
-- Event details let a page be a real thing in the world: the race on Nov 8 in
-- Atlanta, $95, with its sign-up link.

alter table public.align_nodes drop constraint if exists align_nodes_type_check;
alter table public.align_nodes add constraint align_nodes_type_check check (
  type in ('vision', 'milestone', 'objective', 'month', 'week', 'commitment', 'action', 'micro_goal', 'project', 'phase', 'task')
);

alter table public.align_nodes
  add column if not exists event_date date,
  add column if not exists link_url text not null default '',
  add column if not exists location text not null default '',
  add column if not exists cost numeric(12, 2);

alter table public.align_nodes drop constraint if exists align_nodes_link_url_check;
alter table public.align_nodes add constraint align_nodes_link_url_check check (link_url = '' or (link_url ~* '^https?://' and char_length(link_url) <= 2000));
alter table public.align_nodes drop constraint if exists align_nodes_location_check;
alter table public.align_nodes add constraint align_nodes_location_check check (char_length(location) <= 200);
alter table public.align_nodes drop constraint if exists align_nodes_cost_check;
alter table public.align_nodes add constraint align_nodes_cost_check check (cost is null or (cost >= 0 and cost < 10000000));

create index if not exists align_nodes_event_idx on public.align_nodes (event_date) where not archived and event_date is not null;
create index if not exists align_nodes_dates_idx on public.align_nodes (start_date, due_date) where not archived;

-- A Month or Week given a start but no end gets the natural end filled in:
-- the last day of that calendar month, or six days after the week starts.
create or replace function public.align_nodes_period()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.type in ('month', 'week') and new.start_date is not null and new.due_date is null
     and (tg_op = 'INSERT' or new.start_date is distinct from old.start_date or new.type is distinct from old.type or old.due_date is not null) then
    if new.type = 'month' then
      new.due_date := (date_trunc('month', new.start_date) + interval '1 month - 1 day')::date;
    else
      new.due_date := new.start_date + 6;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists align_nodes_period on public.align_nodes;
create trigger align_nodes_period before insert or update on public.align_nodes
  for each row execute function public.align_nodes_period();

-- History for event details.
create or replace function public.align_log_node_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.event_date is distinct from old.event_date or new.location is distinct from old.location
     or new.cost is distinct from old.cost or new.link_url is distinct from old.link_url then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, 'event', jsonb_build_object('date', new.event_date, 'location', new.location, 'cost', new.cost, 'link', new.link_url <> ''));
  end if;
  return new;
end; $$;
drop trigger if exists align_nodes_log_event on public.align_nodes;
create trigger align_nodes_log_event after update on public.align_nodes
  for each row execute function public.align_log_node_event();

-- Children now carry the event details too.
create or replace function public.align_children(p_parent uuid default null, p_sector uuid default null, p_include_done boolean default true)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'type', n.type, 'title', n.title, 'status', n.status, 'priority', n.priority,
      'start_date', n.start_date, 'due_date', n.due_date, 'sector_id', n.sector_id, 'sort', n.sort,
      'done_criteria', n.done_criteria, 'effort_minutes', n.effort_minutes, 'cadence', n.cadence,
      'actionable', n.actionable, 'brain_state', n.brain_state,
      'event_date', n.event_date, 'location', n.location, 'cost', n.cost, 'link_url', n.link_url,
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
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('align_children', 'align_nodes_period', 'align_log_node_event')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Push a plan (or part of it) forward or back: shifts start and due dates of the
-- given pages and, when asked, everything under them. Event dates never move,
-- since the race does not move because a week slipped.
create or replace function public.align_shift_dates(p_ids uuid[], p_days integer, p_with_children boolean default true, p_open_only boolean default true)
returns integer language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  if p_days is null or p_days = 0 or abs(p_days) > 730 then
    raise exception 'Shift by 1 to 730 days' using errcode = '22023';
  end if;
  with recursive tree as (
    select id, 0 as d from public.align_nodes where id = any(p_ids) and not archived
    union
    select n.id, t.d + 1 from public.align_nodes n join tree t on n.parent_id = t.id
    where p_with_children and not n.archived and t.d < 32
  )
  update public.align_nodes n
     set start_date = n.start_date + p_days,
         due_date = n.due_date + p_days
    from (select distinct id from tree) t
   where n.id = t.id
     and (n.start_date is not null or n.due_date is not null)
     and (not p_open_only or n.status not in ('done', 'abandoned'));
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.align_shift_dates(uuid[], integer, boolean, boolean) from public, anon, authenticated;
grant execute on function public.align_shift_dates(uuid[], integer, boolean, boolean) to service_role;

-- A Month or Week that has ended is just finished time, not overdue work, so
-- it no longer counts toward a sector's overdue number.
create or replace function public.align_sector_counts()
returns table(sector_id uuid, own_pages bigint, pages bigint, active bigint, done bigint, overdue bigint)
language sql stable set search_path = '' as $$
  with n as (
    select n.sector_id, n.status, n.due_date, n.type from public.align_nodes n where not n.archived
  ),
  own as (select n.sector_id, count(*) as c from n group by 1),
  rolled as (
    select coalesce(s.parent_id, s.id) as top, n.status, n.due_date, n.type
    from n join public.align_sectors s on s.id = n.sector_id
  ),
  tops as (
    select top,
      count(*) as pages,
      count(*) filter (where status = 'active') as active,
      count(*) filter (where status = 'done') as done,
      count(*) filter (where due_date < (now() at time zone 'America/New_York')::date
                        and status in ('active', 'planned', 'inbox', 'paused')
                        and type not in ('month', 'week')) as overdue
    from rolled group by top
  )
  select s.id, coalesce(own.c, 0), coalesce(t.pages, 0), coalesce(t.active, 0), coalesce(t.done, 0), coalesce(t.overdue, 0)
  from public.align_sectors s
  left join own on own.sector_id = s.id
  left join tops t on t.top = s.id
  where not s.archived;
$$;
revoke all on function public.align_sector_counts() from public, anon, authenticated;
grant execute on function public.align_sector_counts() to service_role;
