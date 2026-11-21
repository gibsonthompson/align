import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSectorPage, recordView } from '@/lib/data';
import { sectorLookup } from '@/lib/sectors';
import { SECTOR_ROOT_TYPES } from '@/lib/kinds';
import TopBar from '@/components/TopBar';
import { SectorProperties, SectorTitle } from '@/components/SectorEditor';
import BrainPanel from '@/components/BrainPanel';
import AreasSection from '@/components/AreasSection';
import ChildrenSection from '@/components/ChildrenSection';
import LinksSection from '@/components/LinksSection';
import NotesSection from '@/components/NotesSection';
import ActivitySection from '@/components/ActivitySection';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getSectorPage(slug).catch(() => null);
  return { title: page ? `${page.sector.name} · Align` : 'Align' };
}

export default async function SectorPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ brain?: string }> }) {
  const { slug } = await params;
  const { brain: brainParam } = await searchParams;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();
  const page = await getSectorPage(slug);
  if (!page) notFound();
  const { sector } = page;
  const isArea = Boolean(sector.parent_id);
  await recordView('sector', sector.id).catch(() => {});

  const lookup = sectorLookup(page.allSectors);
  const pages = page.roots.length + page.areas.reduce((n, a) => n + a.pages, 0);

  return (
    <>
      <TopBar path={page.path} />
      <div className="content">
        <div className="page">
          <div className="page-main">
            <SectorTitle key={sector.id} sector={sector} isArea={isArea} pages={pages} />
            <BrainPanel
              key={`b-${sector.id}`}
              object={{ type: 'sector', id: sector.id }}
              sectorId={sector.parent_id ?? sector.id}
              messages={page.brain.messages}
              facts={page.brain.facts}
              configured={page.brain.configured}
              model={page.brain.model}
              autoRun={brainParam === '1'}
            />
            <ChildrenSection
              key={`c-${sector.id}`}
              title={isArea ? 'Goals And Projects' : 'Vision, Goals And Projects'}
              items={page.roots}
              parentId={null}
              sectorId={sector.id}
              defaultType={isArea ? 'micro_goal' : 'vision'}
              allowedTypes={SECTOR_ROOT_TYPES}
              groupByType
              emptyTitle={isArea ? 'Nothing Here Yet' : 'Start With The Vision'}
              emptyBody={
                isArea
                  ? 'Run the brain above, or add a goal, project or micro goal by hand.'
                  : 'Run the brain above to draft the five-year vision for this part of your life, or write it by hand below.'
              }
            />
            {!isArea && <AreasSection key={`a-${sector.id}`} sector={sector} areas={page.areas} />}
            <NotesSection key={`t-${sector.id}`} attached={{ type: 'sector', id: sector.id }} notes={page.notes} />
          </div>
          <aside className="page-side">
            <SectorProperties key={`p-${sector.id}`} sector={sector} isArea={isArea} pinned={page.pinned} />
            <LinksSection key={`l-${sector.id}`} self={{ type: 'sector', id: sector.id }} selfTitle={sector.name} links={page.links} sectors={lookup} />
            <ActivitySection rows={page.activity} />
          </aside>
        </div>
      </div>
    </>
  );
}
