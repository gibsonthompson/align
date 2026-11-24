export type NodeType =
  | 'vision'
  | 'milestone'
  | 'objective'
  | 'strategy'
  | 'experiment'
  | 'month'
  | 'week'
  | 'commitment'
  | 'action'
  | 'micro_goal'
  | 'project'
  | 'phase'
  | 'task';

export type NodeStatus = 'inbox' | 'planned' | 'active' | 'done' | 'paused' | 'abandoned';

export type ObjectType = 'sector' | 'node';

export type Relation = 'supports' | 'depends_on' | 'pictured_in' | 'scheduled_as' | 'reviewed_in' | 'related';

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export interface Sector {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  colour: string;
  icon: string;
  summary: string;
  importance: number | null;
  satisfaction: number | null;
  attention_needed: number | null;
  mode: 'priority' | 'maintain' | null;
  current_state?: string;
  desired_state?: string;
  weekly_hours?: number | null;
  monthly_budget?: number | null;
  sort: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlignNode {
  id: string;
  type: NodeType;
  title: string;
  body: string;
  sector_id: string | null;
  parent_id: string | null;
  status: NodeStatus;
  priority: number | null;
  start_date: string | null;
  due_date: string | null;
  done_at: string | null;
  sort: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
  done_criteria: string;
  effort_minutes: number | null;
  cadence: string;
  actionable: boolean;
  brain_state: BrainState;
  event_date: string | null;
  link_url: string;
  location: string;
  cost: number | null;
  rationale: string;
  hypothesis: string;
  success_criteria: string;
  review_date: string | null;
  verdict: Verdict;
  verdict_note: string;
}

export type Verdict = '' | 'continue' | 'modify' | 'replace' | 'stop';

export type BrainState = 'untouched' | 'asking' | 'proposed' | 'broken_down' | 'actionable';

// A child row as returned by align_children.
export interface ChildRow {
  id: string;
  type: NodeType;
  title: string;
  status: NodeStatus;
  priority: number | null;
  start_date: string | null;
  due_date: string | null;
  sector_id: string | null;
  sort: number;
  done_criteria: string;
  effort_minutes: number | null;
  cadence: string;
  actionable: boolean;
  brain_state: BrainState;
  event_date: string | null;
  location: string;
  cost: number | null;
  link_url: string;
  review_date?: string | null;
  verdict?: Verdict;
  child_count: number;
  done_count: number;
  link_count: number;
}

// One crumb from align_node_path / align_sector_path.
export interface Crumb {
  object_type: ObjectType;
  id: string;
  title: string;
  kind: string;
  slug: string | null;
  colour: string | null;
}

// Any object, as the search, links, pins and recents return it.
export interface ObjectRef {
  object_type: ObjectType;
  id: string;
  title: string;
  kind: string;
  sector_id: string | null;
  status: string | null;
  slug: string | null;
  snippet?: string | null;
}

export interface LinkRow extends ObjectRef {
  link_id: string;
  relation: Relation;
  direction: 'out' | 'in';
  created_at: string;
}

export interface Note {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: number;
  action: string;
  detail: Record<string, unknown>;
  at: string;
  via?: string | null;
}

export interface BrainQuestion {
  question: string;
  why: string;
  options: string[];
}

export interface BrainProposal {
  type: NodeType;
  title: string;
  body: string;
  done_criteria: string;
  effort_minutes: number | null;
  cadence: string;
  start_date?: string | null;
  due_date?: string | null;
  rationale?: string;
  hypothesis?: string;
  success_criteria?: string;
  review_date?: string | null;
  why: string;
  // Set once Gibson decides.
  status?: 'open' | 'added' | 'skipped';
  created_id?: string | null;
}

export interface BrainReply {
  assessment: string;
  // How the approach holds up: the real objective, alternatives, costs, root cause.
  critique?: string;
  // Whether this fits the time, money and energy he actually has.
  capacity_note?: string;
  actionable: boolean;
  gap: string;
  questions: BrainQuestion[];
  proposals: BrainProposal[];
  facts_learned: string[];
}

export interface BrainMessage {
  id: string;
  role: 'user' | 'brain';
  content: string;
  data: (BrainReply & { closed?: boolean }) | { answers?: { question: string; answer: string }[] } | Record<string, never>;
  created_at: string;
}

export type FactKind = 'fact' | 'preference' | 'constraint' | 'resource' | 'value' | 'environment' | 'community' | 'routine' | 'assumption';

export interface Fact {
  id: string;
  fact: string;
  source: 'brain' | 'gibson' | 'chatgpt';
  sector_id: string | null;
  node_id: string | null;
  created_at: string;
  kind?: FactKind;
  durability?: 'durable' | 'temporary';
  verified?: boolean;
  valid_until?: string | null;
  sensitive?: boolean;
  confirmed_at?: string | null;
  updated_at?: string;
  supersedes?: string | null;
}

// A look back at a strategy, experiment or goal: was it done, did it work, what next.
export interface Review {
  id: string;
  node_id: string;
  period_start: string | null;
  period_end: string | null;
  execution: number | null;
  effective: 'yes' | 'partly' | 'no' | 'unclear';
  verdict: Exclude<Verdict, ''>;
  summary: string;
  changes: string;
  evidence: Record<string, unknown>;
  source: 'align' | 'chatgpt';
  created_at: string;
}

// One block of the ideal week.
export interface IdealSlot {
  day: number; // 1 Monday to 7 Sunday
  start: number; // minutes from midnight
  end: number;
  label: string;
  sector_id: string | null;
}

export interface Lifestyle {
  vision: string;
  non_negotiables: string[];
  ideal_week: IdealSlot[];
  updated_at?: string;
}

export interface Capacity {
  work_hours_per_week: number | null;
  buffer_percent: number; // share of free time kept unplanned
  max_day_hours: number; // most planned hours in one day before it counts as overloaded
  monthly_discretionary_usd: number | null;
  peak_energy: string; // when he has the most energy
  energy_notes: string;
  updated_at?: string;
}

// A slot of time on the calendar, optionally belonging to a page.
export type BlockStatus = 'planned' | 'done' | 'skipped';

export interface Block {
  id: string;
  node_id: string | null;
  sector_id: string | null;
  sector_auto?: boolean;
  title: string;
  notes: string;
  start_at: string;
  end_at: string;
  status: BlockStatus;
  source: 'align' | 'chatgpt' | 'google';
  // From the linked page, when there is one.
  node?: { id: string; title: string; type: NodeType; status: NodeStatus; effort_minutes: number | null; done_criteria: string } | null;
}

// A page with a schedule that gets a check-in each day it happens.
export type HabitSchedule = 'daily' | 'days' | 'per_week';

export interface Habit {
  id: string;
  node_id: string;
  schedule: HabitSchedule;
  days: number[]; // 1 Monday to 7 Sunday
  per_week: number | null;
  minutes: number | null;
  window_start: number | null;
  window_end: number | null;
  auto_place: boolean;
  paused: boolean;
  started_on: string;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  day: string;
  status: 'done' | 'skipped';
  amount: number | null;
  note: string;
  source: string;
}

// A number tracked over time, optionally for a goal page.
export interface Measure {
  id: string;
  node_id: string | null;
  sector_id: string | null;
  name: string;
  unit: string;
  kind: 'level' | 'total';
  direction: 'up' | 'down';
  period: 'week' | 'month' | 'all';
  start_value: number | null;
  target_value: number | null;
  target_date: string | null;
  archived: boolean;
  sort: number;
  created_at: string;
  baseline_date?: string | null;
  curve?: MeasureCurve;
  assumptions?: { text: string; confirmed: boolean }[];
  scenarios?: Partial<Record<'conservative' | 'realistic' | 'ambitious', { value: number | null; note: string }>>;
  method?: string;
}

export type MeasureCurve = 'linear' | 'front_loaded' | 'back_loaded' | 'compound';

export interface MeasureLog {
  id: string;
  measure_id: string;
  day: string;
  value: number;
  note: string;
  source: string;
  created_at: string;
}
