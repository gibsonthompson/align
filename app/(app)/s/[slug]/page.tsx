import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSectorPage, recordView } from '@/lib/data';
import { sectorLookup } from '@/lib/sectors';
import { SECTOR_ROOT_TYPES } from '@/lib/kinds';
import TopBar from '@/components/TopBar';
import Breadcrumbs from '@/components/Breadcrumbs';
import SectorHero from '@/components/SectorHero';
import AreasSection from '@/components/AreasSection';
import ChildrenSection from '@/components/ChildrenSection';
import LinksSection from '@/components/LinksSection';
import NotesSection from '@/components/NotesSection';
import ActivitySection from '@/components/ActivitySection';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getSectorPage(slug).catch(() => null);
  return { title: page ? `${page.sector.name} · Align` : 'Align' };
}

export default async function SectorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();
  const page = await getSectorPage(slug);
  if (!page) notFound();
  const { sector } = page;
  const isArea = Boolean(sector.parent_id);
  await recordView('sector', sector.id).catch(() => {});

  const lookup = sectorLookup(page.allSectors);
  const parent = isArea ? page.path[page.path.length - 2] : null;
  const pages = page.roots.length + page.areas.reduce((n, a) => n + a.pages, 0);

  return (
    <>
      <TopBar back={parent ? `/s/${parent.slug}` : '/life'} />
      <Breadcrumbs path={page.path} colour={sector.colour} />
      <SectorHero key={sector.id} sector={sector} isArea={isArea} pinned={page.pinned} pages={pages} />
      <div className="stack">
        {!isArea && <AreasSection key={`a-${sector.id}`} sector={sector} areas={page.areas} />}
        <ChildrenSection
          key={`c-${sector.id}`}
          title={isArea ? 'Goals And Projects' : 'Vision, Goals And Projects'}
          items={page.roots}
          parentId={null}
          sectorId={sector.id}
          defaultType={isArea ? 'micro_goal' : 'vision'}
          allowedTypes={SECTOR_ROOT_TYPES}
          groupByType
          colour={sector.colour}
          emptyTitle={isArea ? 'Nothing Here Yet' : 'Start With The Vision'}
          emptyBody={
            isArea
              ? 'Add a goal, a project or a quick micro goal for this area.'
              : 'Write what this part of your life looks like five years from now. Milestones, objectives and daily actions build down from it.'
          }
        />
        <LinksSection key={`l-${sector.id}`} self={{ type: 'sector', id: sector.id }} selfTitle={sector.name} links={page.links} sectors={lookup} />
        <NotesSection key={`t-${sector.id}`} attached={{ type: 'sector', id: sector.id }} notes={page.notes} />
        <ActivitySection rows={page.activity} />
      </div>
    </>
  );
}
