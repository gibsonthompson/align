-- Align 0007: habits and measures.
--
-- A habit is a page (usually a Weekly Commitment) with a schedule: every day,
-- certain weekdays, or a number of times a week. Each day it gets a check-in.
-- Finishing a calendar block for a habit's page checks it in.
--
-- A measure is a number tracked over time: weight, miles, savings, songs learned.
-- "level" measures care about the latest value (weight); "total" measures add up
-- (miles this week). Either can have a start, a target and a target date, and can
-- belong to a goal page so the goal shows real progress.

create table if not exists public.align_habits (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null unique references public.align_nodes (id) on delete cascade,
  schedule text not null default 'per_week' check (schedule in ('daily', 'days', 'per_week')),
  days smallint[] not null default '{}' check (days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  per_week smallint check (per_week between 1 and 7),
  minutes integer check (minutes between 5 and 600),
  window_start smallint check (window_start between 0 and 1439),
  window_end smallint check (window_end between 1 and 1440),
  auto_place boolean not null default false,
  paused boolean not null default false,
  started_on date not null default ((now() at time zone 'America/New_York')::date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (schedule <> 'days' or cardinality(days) > 0),
  check (schedule <> 'per_week' or per_week is not null),
  check (window_start is null or window_end is null or window_end > window_start)
);

create table if not exists public.align_habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.align_habits (id) on delete cascade,
  day date not null,
  status text not null default 'done' check (status in ('done', 'skipped')),
  amount numeric(12, 2),
  note text not null default '' check (char_length(note) <= 2000),
  source text not null default 'align' check (source in ('align', 'chatgpt', 'calendar')),
  created_at timestamptz not null default now(),
  unique (habit_id, day)
);
create index if not exists align_habit_logs_day_idx on public.align_habit_logs (habit_id, day desc);

create table if not exists public.align_measures (
  id uuid primary key default gen_random_uuid(),
  node_id uuid references public.align_nodes (id) on delete set null,
  sector_id uuid references public.align_sectors (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  unit text not null default '' check (char_length(unit) <= 24),
  kind text not null default 'level' check (kind in ('level', 'total')),
  direction text not null default 'up' check (direction in ('up', 'down')),
  period text not null default 'all' check (period in ('week', 'month', 'all')),
  start_value numeric(14, 3),
  target_value numeric(14, 3),
  target_date date,
  archived boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists align_measures_node_idx on public.align_measures (node_id) where not archived;

create table if not exists public.align_measure_logs (
  id uuid primary key default gen_random_uuid(),
  measure_id uuid not null references public.align_measures (id) on delete cascade,
  day date not null,
  value numeric(14, 3) not null,
  note text not null default '' check (char_length(note) <= 2000),
  source text not null default 'align' check (source in ('align', 'chatgpt', 'calendar', 'import')),
  created_at timestamptz not null default now()
);
create index if not exists align_measure_logs_day_idx on public.align_measure_logs (measure_id, day desc);

-- Updated-at and sector inheritance.
create or replace function public.align_habits_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists align_habits_touch on public.align_habits;
create trigger align_habits_touch before update on public.align_habits
  for each row execute function public.align_habits_touch();

create or replace function public.align_measures_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.node_id is not null and (tg_op = 'INSERT' or new.node_id is distinct from old.node_id) then
    select sector_id into new.sector_id from public.align_nodes where id = new.node_id;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists align_measures_guard on public.align_measures;
create trigger align_measures_guard before insert or update on public.align_measures
  for each row execute function public.align_measures_guard();

-- History on the page a habit or measure belongs to.
create or replace function public.align_habit_logs_log()
returns trigger language plpgsql set search_path = '' as $$
declare v_node uuid;
begin
  select node_id into v_node from public.align_habits where id = coalesce(new.habit_id, old.habit_id);
  if v_node is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', v_node, 'habit_cleared', jsonb_build_object('day', old.day));
    return old;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', v_node, case when new.status = 'done' then 'habit_done' else 'habit_skipped' end, jsonb_build_object('day', new.day, 'amount', new.amount));
  end if;
  return new;
end; $$;
drop trigger if exists align_habit_logs_log on public.align_habit_logs;
create trigger align_habit_logs_log after insert or update or delete on public.align_habit_logs
  for each row execute function public.align_habit_logs_log();

create or replace function public.align_measure_logs_log()
returns trigger language plpgsql set search_path = '' as $$
declare v_node uuid; v_name text; v_unit text;
begin
  if tg_op <> 'INSERT' then return new; end if;
  select node_id, name, unit into v_node, v_name, v_unit from public.align_measures where id = new.measure_id;
  if v_node is not null then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', v_node, 'measured', jsonb_build_object('name', v_name, 'unit', v_unit, 'value', new.value, 'day', new.day));
  end if;
  return new;
end; $$;
drop trigger if exists align_measure_logs_log on public.align_measure_logs;
create trigger align_measure_logs_log after insert on public.align_measure_logs
  for each row execute function public.align_measure_logs_log();

-- Finishing a calendar block for a habit's page checks the habit in for that day.
create or replace function public.align_blocks_habit()
returns trigger language plpgsql set search_path = '' as $$
declare v_habit uuid; v_day date;
begin
  if new.node_id is null then return new; end if;
  select id into v_habit from public.align_habits where node_id = new.node_id;
  if v_habit is null then return new; end if;
  v_day := (new.start_at at time zone 'America/New_York')::date;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    insert into public.align_habit_logs (habit_id, day, status, source)
      values (v_habit, v_day, 'done', 'calendar')
      on conflict (habit_id, day) do update set status = 'done';
  elsif tg_op = 'UPDATE' and old.status = 'done' and new.status <> 'done' then
    delete from public.align_habit_logs where habit_id = v_habit and day = v_day and source = 'calendar';
  end if;
  return new;
end; $$;
drop trigger if exists align_blocks_habit on public.align_blocks;
create trigger align_blocks_habit after insert or update on public.align_blocks
  for each row execute function public.align_blocks_habit();

-- Locked down like every other align_ table.
do $$
declare t text;
begin
  foreach t in array array['align_habits', 'align_habit_logs', 'align_measures', 'align_measure_logs']
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
    where n.nspname = 'public' and p.proname in ('align_habits_touch', 'align_measures_guard', 'align_habit_logs_log', 'align_measure_logs_log', 'align_blocks_habit')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
