export type NodeType =
  | 'vision'
  | 'milestone'
  | 'objective'
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
}

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
  why: string;
  // Set once Gibson decides.
  status?: 'open' | 'added' | 'skipped';
  created_id?: string | null;
}

export interface BrainReply {
  assessment: string;
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

export interface Fact {
  id: string;
  fact: string;
  source: 'brain' | 'gibson';
  sector_id: string | null;
  node_id: string | null;
  created_at: string;
}

// A slot of time on the calendar, optionally belonging to a page.
export type BlockStatus = 'planned' | 'done' | 'skipped';

export interface Block {
  id: string;
  node_id: string | null;
  sector_id: string | null;
  title: string;
  notes: string;
  start_at: string;
  end_at: string;
  status: BlockStatus;
  source: 'align' | 'chatgpt' | 'google';
  // From the linked page, when there is one.
  node?: { id: string; title: string; type: NodeType; status: NodeStatus; effort_minutes: number | null; done_criteria: string } | null;
}
