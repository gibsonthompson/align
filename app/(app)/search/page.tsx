import { Inbox, Search } from 'lucide-react';
import { getInbox, getSectors, searchEverything } from '@/lib/data';
import { sectorLookup } from '@/lib/sectors';
import TopBar from '@/components/TopBar';
import ObjectRow from '@/components/ObjectRow';
import EmptyState from '@/components/EmptyState';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q = '', status } = await searchParams;
  const query = q.trim().slice(0, 120);
  const inboxView = !query && status === 'inbox';
  const [results, sectors] = await Promise.all([inboxView ? getInbox() : query ? searchEverything(query, 60) : Promise.resolve([]), getSectors()]);
  const lookup = sectorLookup(sectors);

  return (
    <>
      <TopBar title={inboxView ? 'Inbox' : 'Search'} />
      <div className="content narrow">
        <div className="page-head">
          <div>
            <h1>{inboxView ? 'Inbox' : 'Search'}</h1>
            <p>{inboxView ? 'Pages captured without a home, waiting to be filed under a sector or goal.' : 'Every sector, area, page and note, at any depth.'}</p>
          </div>
        </div>
        <form action="/search" style={{ position: 'relative', marginBottom: 16 }}>
          <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-3)' }}>
            <Search size={16} />
          </span>
          <input name="q" className="input" style={{ paddingLeft: 34 }} defaultValue={query} placeholder="Search titles, descriptions and notes" aria-label="Search everything" autoComplete="off" autoFocus={!inboxView} />
        </form>
        {inboxView || query ? (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">
                {inboxView ? 'Waiting To Be Filed' : 'Results'}
                <span className="count">{results.length}</span>
              </h2>
            </div>
            {results.length ? (
              <div className="rows">
                {results.map((r) => (
                  <ObjectRow key={`${r.object_type}:${r.id}`} item={r} sectors={lookup} />
                ))}
              </div>
            ) : inboxView ? (
              <EmptyState Icon={Inbox} title="Inbox Is Clear" body="Anything captured without a home lands here." />
            ) : (
              <EmptyState Icon={Search} title="Nothing Found" body="Try fewer words, or a word from a note on the page you want." />
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
