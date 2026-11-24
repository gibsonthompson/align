import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Archive } from 'lucide-react';
import { getNodePage, recordView, topSector } from '@/lib/data';
import { sectorLookup } from '@/lib/sectors';
import { NODE_KINDS } from '@/lib/kinds';
import { isId } from '@/lib/ids';
import { nextTypes } from '@/lib/brain';
import TopBar from '@/components/TopBar';
import { NodeProperties, NodeTitle } from '@/components/NodeEditor';
import BrainPanel from '@/components/BrainPanel';
import ChildrenSection from '@/components/ChildrenSection';
import LinksSection from '@/components/LinksSection';
import NotesSection from '@/components/NotesSection';
import ActivitySection from '@/components/ActivitySection';
import NodeSchedule from '@/components/NodeSchedule';
import HabitPanel from '@/components/progress/HabitPanel';
import MeasuresPanel from '@/components/progress/MeasuresPanel';
import { getNodeProgress } from '@/lib/progress';
import { todayISO } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Kinds that are done in a sitting, so they get a time on the calendar.
const SCHEDULABLE = ['action', 'task', 'micro_goal', 'commitment', 'phase'];
// Kinds that usually repeat, so they offer to become a habit.
const HABIT_KINDS = ['commitment', 'micro_goal'];
// Kinds that are outcomes, so they offer measures.
const MEASURE_KINDS = ['vision', 'milestone', 'objective', 'month', 'week', 'commitment', 'project', 'micro_goal'];
// The brain can take a while to think.
export const maxDuration = 120;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isId(id)) return { title: 'Align' };
  const page = await getNodePage(id).catch(() => null);
  return { title: page ? `${page.node.title} · Align` : 'Align' };
}

export default async function NodePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ brain?: string }> }) {
  const { id } = await params;
  const { brain: brainParam } = await searchParams;
  if (!isId(id)) notFound();
  const page = await getNodePage(id);
  if (!page) notFound();
  const { node } = page;
  if (!node.archived) await recordView('node', node.id).catch(() => {});

  const lookup = sectorLookup(page.allSectors);
  const progress = await getNodeProgress(node.id);
  const today = todayISO();
  const top = topSector(page.allSectors, node.sector_id);
  const K = NODE_KINDS[node.type];
  const allowed = nextTypes('node', node.type);
  const next = NODE_KINDS[allowed[0]];
  const allNext = page.children.every((c) => c.type === allowed[0]);

  return (
    <>
      <TopBar path={page.path} />
      <div className="content">
        {node.archived && (
          <div className="banner">
            <Archive size={15} /> This page is archived. Restore it from Properties to bring it and its pages back.
          </div>
        )}
        <div className="page">
          <div className="page-main">
            <NodeTitle key={node.id} node={node} />
            {!node.archived && (
              <BrainPanel
                key={`b-${node.id}`}
                object={{ type: 'node', id: node.id }}
                nodeType={node.type}
                sectorId={top?.id ?? null}
                messages={page.brain.messages}
                facts={page.brain.facts}
                configured={page.brain.configured}
                model={page.brain.model}
                autoRun={brainParam === '1'}
              />
            )}
            {!node.archived && (
              <ChildrenSection
                key={`c-${node.id}`}
                title={allNext ? next.plural : 'Under This'}
                items={page.children}
                parentId={node.id}
                sectorId={node.sector_id}
                defaultType={K.next}
                allowedTypes={[...new Set([...allowed, K.next])]}
                emptyTitle={`No ${next.plural} Yet`}
                emptyBody="Run the brain above to break this down, or add pages by hand below."
              />
            )}
            {(HABIT_KINDS.includes(node.type) || progress.habit) && (
              <HabitPanel key={`h-${node.id}`} nodeId={node.id} habit={progress.habit} cadence={node.cadence} today={today} archived={node.archived} />
            )}
            {(MEASURE_KINDS.includes(node.type) || progress.measures.length > 0) && (
              <MeasuresPanel key={`m-${node.id}`} nodeId={node.id} measures={progress.measures} today={today} sectors={lookup} archived={node.archived} />
            )}
            <NotesSection key={`t-${node.id}`} attached={{ type: 'node', id: node.id }} notes={page.notes} />
          </div>
          <aside className="page-side">
            <NodeProperties key={`p-${node.id}`} node={node} sector={page.sector ?? top} pinned={page.pinned} allSectors={page.allSectors} sectors={lookup} />
            {(SCHEDULABLE.includes(node.type) || page.blocks.length > 0) && <NodeSchedule node={node} blocks={page.blocks} />}
            <LinksSection key={`l-${node.id}`} self={{ type: 'node', id: node.id }} selfTitle={node.title} links={page.links} sectors={lookup} />
            <ActivitySection rows={page.activity} />
          </aside>
        </div>
      </div>
    </>
  );
}
