import {
  Brain,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CircleCheck,
  CircleDot,
  Compass,
  Dumbbell,
  Flag,
  FolderKanban,
  GraduationCap,
  Guitar,
  House,
  Layers,
  ListChecks,
  Sparkles,
  Target,
  Telescope,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { NodeStatus, NodeType, ObjectRef, Relation } from '@/lib/types';

export interface KindInfo {
  label: string; // one of them
  plural: string; // a group of them
  next: NodeType; // what usually sits under it
  Icon: LucideIcon;
  horizon?: string;
}

export const NODE_KINDS: Record<NodeType, KindInfo> = {
  vision: { label: 'Five-Year Vision', plural: 'Five-Year Visions', next: 'milestone', Icon: Telescope, horizon: '5 Years' },
  milestone: { label: '12-Month Milestone', plural: '12-Month Milestones', next: 'objective', Icon: Flag, horizon: '12 Months' },
  objective: { label: '90-Day Objective', plural: '90-Day Objectives', next: 'month', Icon: Target, horizon: '90 Days' },
  month: { label: 'Month', plural: 'Months', next: 'week', Icon: CalendarDays, horizon: 'One Month' },
  week: { label: 'Week', plural: 'Weeks', next: 'action', Icon: CalendarRange, horizon: 'One Week' },
  commitment: { label: 'Weekly Commitment', plural: 'Weekly Commitments', next: 'action', Icon: CalendarCheck, horizon: 'This Week' },
  action: { label: 'Daily Action', plural: 'Daily Actions', next: 'task', Icon: CircleCheck, horizon: 'Today' },
  project: { label: 'Project', plural: 'Projects', next: 'phase', Icon: FolderKanban },
  phase: { label: 'Phase', plural: 'Phases', next: 'task', Icon: Layers },
  task: { label: 'Task', plural: 'Tasks', next: 'task', Icon: ListChecks },
  micro_goal: { label: 'Micro Goal', plural: 'Micro Goals', next: 'task', Icon: Sparkles },
};

// The order types are listed in, top of the hierarchy first.
export const NODE_TYPE_ORDER: NodeType[] = [
  'vision',
  'milestone',
  'objective',
  'month',
  'week',
  'commitment',
  'action',
  'project',
  'phase',
  'micro_goal',
  'task',
];

// What a sector page offers to add at its top level.
// Kinds that cover a stretch of calendar time and get their end date filled in.
export const PERIOD_TYPES: NodeType[] = ['month', 'week'];

export const SECTOR_ROOT_TYPES: NodeType[] = ['vision', 'milestone', 'objective', 'project', 'micro_goal', 'commitment'];

export const STATUS_LABEL: Record<NodeStatus, string> = {
  inbox: 'Inbox',
  planned: 'Planned',
  active: 'Active',
  done: 'Done',
  paused: 'Paused',
  abandoned: 'Abandoned',
};

export const STATUS_ORDER: NodeStatus[] = ['active', 'planned', 'paused', 'done', 'abandoned', 'inbox'];

const SECTOR_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  wallet: Wallet,
  dumbbell: Dumbbell,
  guitar: Guitar,
  users: Users,
  'graduation-cap': GraduationCap,
  brain: Brain,
  house: House,
  compass: Compass,
};

export function sectorIcon(name: string): LucideIcon {
  return SECTOR_ICONS[name] ?? CircleDot;
}

export const SECTOR_ICON_NAMES = Object.keys(SECTOR_ICONS);

// How a link reads from this page's side.
export function relationLabel(relation: Relation, direction: 'out' | 'in'): string {
  const out: Record<Relation, string> = {
    supports: 'Supports',
    depends_on: 'Depends On',
    pictured_in: 'Pictured In',
    scheduled_as: 'Scheduled As',
    reviewed_in: 'Reviewed In',
    related: 'Related',
  };
  const inn: Record<Relation, string> = {
    supports: 'Supported By',
    depends_on: 'Needed By',
    pictured_in: 'Pictures',
    scheduled_as: 'Schedules',
    reviewed_in: 'Reviews',
    related: 'Related',
  };
  return direction === 'out' ? out[relation] : inn[relation];
}

// Relations offered when linking two pages (the rest arrive with later phases).
export const LINK_RELATIONS: { value: Relation; label: string }[] = [
  { value: 'supports', label: 'Supports' },
  { value: 'depends_on', label: 'Depends On' },
  { value: 'related', label: 'Related To' },
];

export function kindLabel(ref: Pick<ObjectRef, 'object_type' | 'kind'>): string {
  if (ref.object_type === 'sector') return ref.kind === 'area' ? 'Area' : 'Sector';
  return NODE_KINDS[ref.kind as NodeType]?.label ?? 'Page';
}

export function kindIcon(ref: Pick<ObjectRef, 'object_type' | 'kind'>): LucideIcon {
  if (ref.object_type === 'sector') return CircleDot;
  return NODE_KINDS[ref.kind as NodeType]?.Icon ?? CircleDot;
}

export function hrefFor(ref: Pick<ObjectRef, 'object_type' | 'id' | 'slug'>): string {
  if (ref.object_type === 'sector') return `/s/${ref.slug}`;
  return `/n/${ref.id}`;
}

// Group key for the linked items section.
export function groupLabel(ref: Pick<ObjectRef, 'object_type' | 'kind'>): string {
  if (ref.object_type === 'sector') return 'Sectors And Areas';
  return NODE_KINDS[ref.kind as NodeType]?.plural ?? 'Pages';
}
