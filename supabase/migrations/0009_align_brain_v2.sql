-- Align 0009: the brain becomes a life architect.
--
-- Strategy and Experiment pages: a goal can hold several strategies, each with
-- the reason it should work, and any one can be replaced without touching the
-- rest. An experiment is a strategy on trial: a hypothesis, a fixed window, the
-- criteria it is judged by and a review date.
--
-- Reviews record whether a strategy was carried out (execution) and whether it
-- worked (effectiveness), and the verdict: continue, modify, replace or stop.
--
-- Facts become a personal profile: each one has a kind, whether it is confirmed
-- or only assumed, whether it is durable or temporary (with an end date), when
-- it was last confirmed, whether it is sensitive, and which fact it replaced.
--
-- Sectors get the current versus desired state and a weekly time and monthly
-- money budget. Measures get the model behind the target: baseline date, the
-- shape of the expected curve, the assumptions and the scenarios.

-- ---------------------------------------------------------------------------
-- Strategy and Experiment pages
-- ---------------------------------------------------------------------------

alter table public.align_nodes drop constraint if exists align_nodes_type_check;
alter table public.align_nodes add constraint align_nodes_type_check check (
  type in ('vision', 'milestone', 'objective', 'strategy', 'experiment', 'month', 'week', 'commitment', 'action', 'micro_goal', 'project', 'phase', 'task')
);

alter table public.align_nodes
  add column if not exists rationale text not null default '',
  add column if not exists hypothesis text not null default '',
  add column if not exists success_criteria text not null default '',
  add column if not exists review_date date,
  add column if not exists verdict text not null default '',
  add column if not exists verdict_note text not null default '';

alter table public.align_nodes drop constraint if exists align_nodes_rationale_check;
alter table public.align_nodes add constraint align_nodes_rationale_check check (char_length(rationale) <= 5000);
alter table public.align_nodes drop constraint if exists align_nodes_hypothesis_check;
alter table public.align_nodes add constraint align_nodes_hypothesis_check check (char_length(hypothesis) <= 2000);
alter table public.align_nodes drop constraint if exists align_nodes_success_criteria_check;
alter table public.align_nodes add constraint align_nodes_success_criteria_check check (char_length(success_criteria) <= 2000);
alter table public.align_nodes drop constraint if exists align_nodes_verdict_check;
alter table public.align_nodes add constraint align_nodes_verdict_check check (verdict in ('', 'continue', 'modify', 'replace', 'stop'));
alter table public.align_nodes drop constraint if exists align_nodes_verdict_note_check;
alter table public.align_nodes add constraint align_nodes_verdict_note_check check (char_length(verdict_note) <= 2000);

create index if not exists align_nodes_review_idx on public.align_nodes (review_date) where not archived and review_date is not null;

-- History for the strategy fields, so earlier reasoning is never lost.
create or replace function public.align_log_node_strategy()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.verdict is distinct from old.verdict and new.verdict <> '' then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, 'verdict', jsonb_build_object('from', old.verdict, 'to', new.verdict, 'note', left(new.verdict_note, 300)));
  end if;
  if new.rationale is distinct from old.rationale and old.rationale <> '' then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, 'rationale', jsonb_build_object('before', left(old.rationale, 1000)));
  end if;
  if new.hypothesis is distinct from old.hypothesis and old.hypothesis <> '' then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, 'hypothesis', jsonb_build_object('before', left(old.hypothesis, 1000)));
  end if;
  if new.review_date is distinct from old.review_date then
    insert into public.align_activity (object_type, object_id, action, detail)
      values ('node', new.id, 'review_date', jsonb_build_object('from', old.review_date, 'to', new.review_date));
  end if;
  return new;
end; $$;
drop trigger if exists align_nodes_log_strategy on public.align_nodes;
create trigger align_nodes_log_strategy after update on public.align_nodes
  for each row execute function public.align_log_node_strategy();

-- Children carry the strategy fields too.
create or replace function public.align_children(p_parent uuid default null, p_sector uuid default null, p_include_done boolean default true)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'type', n.type, 'title', n.title, 'status', n.status, 'priority', n.priority,
      'start_date', n.start_date, 'due_date', n.due_date, 'sector_id', n.sector_id, 'sort', n.sort,
      'done_criteria', n.done_criteria, 'effort_minutes', n.effort_minutes, 'cadence', n.cadence,
      'actionable', n.actionable, 'brain_state', n.brain_state,
      'event_date', n.event_date, 'location', n.location, 'cost', n.cost, 'link_url', n.link_url,
      'review_date', n.review_date, 'verdict', n.verdict,
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

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

create table if not exists public.align_reviews (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.align_nodes (id) on delete cascade,
  period_start date,
  period_end date,
  execution numeric(4, 3) check (execution is null or (execution >= 0 and execution <= 1)),
  effective text not null default 'unclear' check (effective in ('yes', 'partly', 'no', 'unclear')),
  verdict text not null check (verdict in ('continue', 'modify', 'replace', 'stop')),
  summary text not null default '' check (char_length(summary) <= 5000),
  changes text not null default '' check (char_length(changes) <= 5000),
  evidence jsonb not null default '{}'::jsonb,
  source text not null default 'align' check (source in ('align', 'chatgpt')),
  created_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end >= period_start)
);
create index if not exists align_reviews_node_idx on public.align_reviews (node_id, created_at desc);
create index if not exists align_reviews_at_idx on public.align_reviews (created_at desc);

-- A review writes its verdict onto the page and into the page's history.
create or replace function public.align_reviews_apply()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.align_nodes
    set verdict = new.verdict, verdict_note = left(coalesce(nullif(new.summary, ''), verdict_note), 2000)
    where id = new.node_id;
  insert into public.align_activity (object_type, object_id, action, detail)
    values ('node', new.node_id, 'reviewed', jsonb_build_object(
      'review_id', new.id, 'verdict', new.verdict, 'effective', new.effective,
      'execution', new.execution, 'summary', left(new.summary, 300)));
  return new;
end; $$;
drop trigger if exists align_reviews_apply on public.align_reviews;
create trigger align_reviews_apply after insert on public.align_reviews
  for each row execute function public.align_reviews_apply();

-- ---------------------------------------------------------------------------
-- Facts become a personal profile
-- ---------------------------------------------------------------------------

alter table public.align_facts
  add column if not exists kind text not null default 'fact',
  add column if not exists durability text not null default 'durable',
  add column if not exists verified boolean not null default true,
  add column if not exists valid_until date,
  add column if not exists sensitive boolean not null default false,
  add column if not exists confirmed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists supersedes uuid references public.align_facts (id);

update public.align_facts set confirmed_at = created_at where confirmed_at is null and verified;

alter table public.align_facts drop constraint if exists align_facts_kind_check;
alter table public.align_facts add constraint align_facts_kind_check check (
  kind in ('fact', 'preference', 'constraint', 'resource', 'value', 'environment', 'community', 'routine', 'assumption')
);
alter table public.align_facts drop constraint if exists align_facts_durability_check;
alter table public.align_facts add constraint align_facts_durability_check check (durability in ('durable', 'temporary'));
alter table public.align_facts drop constraint if exists align_facts_source_check;
alter table public.align_facts add constraint align_facts_source_check check (source in ('brain', 'gibson', 'chatgpt'));

create index if not exists align_facts_kind_idx on public.align_facts (kind) where not archived;

drop trigger if exists align_facts_touch on public.align_facts;
create trigger align_facts_touch before update on public.align_facts
  for each row execute function public.align_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Sectors: where it is, where it should be, and what it may cost
-- ---------------------------------------------------------------------------

alter table public.align_sectors
  add column if not exists current_state text not null default '',
  add column if not exists desired_state text not null default '',
  add column if not exists weekly_hours numeric(5, 1),
  add column if not exists monthly_budget numeric(12, 2);

alter table public.align_sectors drop constraint if exists align_sectors_current_state_check;
alter table public.align_sectors add constraint align_sectors_current_state_check check (char_length(current_state) <= 5000);
alter table public.align_sectors drop constraint if exists align_sectors_desired_state_check;
alter table public.align_sectors add constraint align_sectors_desired_state_check check (char_length(desired_state) <= 5000);
alter table public.align_sectors drop constraint if exists align_sectors_weekly_hours_check;
alter table public.align_sectors add constraint align_sectors_weekly_hours_check check (weekly_hours is null or (weekly_hours >= 0 and weekly_hours <= 168));
alter table public.align_sectors drop constraint if exists align_sectors_monthly_budget_check;
alter table public.align_sectors add constraint align_sectors_monthly_budget_check check (monthly_budget is null or (monthly_budget >= 0 and monthly_budget < 100000000));

-- ---------------------------------------------------------------------------
-- Measures carry the model behind the target
-- ---------------------------------------------------------------------------

alter table public.align_measures
  add column if not exists baseline_date date,
  add column if not exists curve text not null default 'linear',
  add column if not exists assumptions jsonb not null default '[]'::jsonb,
  add column if not exists scenarios jsonb not null default '{}'::jsonb,
  add column if not exists method text not null default '';

alter table public.align_measures drop constraint if exists align_measures_curve_check;
alter table public.align_measures add constraint align_measures_curve_check check (curve in ('linear', 'front_loaded', 'back_loaded', 'compound'));
alter table public.align_measures drop constraint if exists align_measures_assumptions_check;
alter table public.align_measures add constraint align_measures_assumptions_check check (jsonb_typeof(assumptions) = 'array');
alter table public.align_measures drop constraint if exists align_measures_scenarios_check;
alter table public.align_measures add constraint align_measures_scenarios_check check (jsonb_typeof(scenarios) = 'object');
alter table public.align_measures drop constraint if exists align_measures_method_check;
alter table public.align_measures add constraint align_measures_method_check check (char_length(method) <= 5000);

-- ---------------------------------------------------------------------------
-- Locked down like every other align_ table
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['align_reviews']
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
    where n.nspname = 'public' and p.proname in ('align_children', 'align_log_node_strategy', 'align_reviews_apply')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
