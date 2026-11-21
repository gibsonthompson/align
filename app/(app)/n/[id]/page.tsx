import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Archive } from 'lucide-react';
import { getNodePage, recordView, topSector } from '@/lib/data';
import { sectorLookup } from '@/lib/sectors';
import { hrefFor, NODE_KINDS } from '@/lib/kinds';
import { isId } from '@/lib/ids';
import TopBar from '@/components/TopBar';
import Breadcrumbs from '@/components/Breadcrumbs';
import NodeHero from '@/components/NodeHero';
import ChildrenSection from '@/components/ChildrenSection';
import LinksSection from '@/components/LinksSection';
import NotesSection from '@/components/NotesSection';
import ActivitySection from '@/components/ActivitySection';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isId(id)) return { title: 'Align' };
  const page = await getNodePage(id).catch(() => null);
  return { title: page ? `${page.node.title} · Align` : 'Align' };
}

export default async function NodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const page = await getNodePage(id);
  if (!page) notFound();
  const { node } = page;
  if (!node.archived) await recordView('node', node.id).catch(() => {});

  const lookup = sectorLookup(page.allSectors);
  const top = topSector(page.allSectors, node.sector_id);
  const colour = page.sector?.colour ?? top?.colour ?? '#8a8a8a';
  const up = page.path.length > 1 ? page.path[page.path.length - 2] : null;
  const K = NODE_KINDS[node.type];
  const next = NODE_KINDS[K.next];
  const allNext = page.children.every((c) => c.type === K.next);

  return (
    <>
      <TopBar back={up ? hrefFor(up) : '/life'} />
      <Breadcrumbs path={page.path} colour={colour} />
      {node.archived && (
        <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', background: 'var(--amber-soft)', border: 0 }}>
          <Archive size={20} style={{ color: 'var(--amber)', flex: 'none' }} />
          <p style={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.45 }}>
            This page is archived. Restore it from the options menu to bring it and its pages back.
          </p>
        </div>
      )}
      <NodeHero key={node.id} node={node} sector={page.sector ?? top} pinned={page.pinned} allSectors={page.allSectors} sectors={lookup} />
      <div className="stack">
        {!node.archived && (
          <ChildrenSection
            key={`c-${node.id}`}
            title={allNext ? next.plural : 'Pages Under This'}
            items={page.children}
            parentId={node.id}
            sectorId={node.sector_id}
            defaultType={K.next}
            colour={colour}
            emptyTitle={`No ${next.plural} Yet`}
            emptyBody={emptyHint(node.type)}
          />
        )}
        <LinksSection key={`l-${node.id}`} self={{ type: 'node', id: node.id }} selfTitle={node.title} links={page.links} sectors={lookup} />
        <NotesSection key={`t-${node.id}`} attached={{ type: 'node', id: node.id }} notes={page.notes} />
        <ActivitySection rows={page.activity} />
      </div>
    </>
  );
}

function emptyHint(type: string): string {
  switch (type) {
    case 'vision':
      return 'What has to be true twelve months from now to be on track for this? Add those milestones.';
    case 'milestone':
      return 'Break this year into what you can realistically pursue this quarter.';
    case 'objective':
      return 'What has to happen every week to hit this by the end of the quarter?';
    case 'commitment':
      return 'Add the specific things to do on a given day to keep this week on track.';
    case 'project':
      return 'Split the project into phases, then tasks under each.';
    default:
      return 'Add smaller steps under this one. Each opens its own page.';
  }
}
