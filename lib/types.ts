export type NodeType =
  | 'vision'
  | 'milestone'
  | 'objective'
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
}

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
}
