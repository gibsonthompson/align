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
  const [results, sectors] = await Promise.all([
    inboxView ? getInbox() : query ? searchEverything(query, 60) : Promise.resolve([]),
    getSectors(),
  ]);
  const lookup = sectorLookup(sectors);

  return (
    <>
      <TopBar title={inboxView ? 'Inbox' : 'Search'} back="/" />
      <form action="/search" style={{ position: 'relative', marginBottom: 14 }}>
        <span style={{ position: 'absolute', left: 14, top: 15, color: 'var(--text-3)' }}>
          <Search size={19} />
        </span>
        <input
          name="q"
          className="input"
          style={{ paddingLeft: 44 }}
          defaultValue={query}
          placeholder="Search titles, descriptions and notes"
          aria-label="Search everything"
          autoComplete="off"
          autoFocus={!inboxView}
        />
      </form>

      {inboxView ? (
        <section className="card flush">
          <div className="section-head">
            <h2 className="section-title">
              Waiting To Be Filed
              <span className="count">{results.length}</span>
            </h2>
          </div>
          {results.length ? (
            <div className="rows">
              {results.map((r) => (
                <ObjectRow key={r.id} item={r} sectors={lookup} />
              ))}
            </div>
          ) : (
            <EmptyState small Icon={Inbox} title="Inbox Is Clear" body="Anything captured without a home lands here, ready to file under a sector or goal." />
          )}
        </section>
      ) : query ? (
        <section className="card flush">
          <div className="section-head">
            <h2 className="section-title">
              Results
              <span className="count">{results.length}</span>
            </h2>
          </div>
          {results.length ? (
            <div className="rows">
              {results.map((r) => (
                <ObjectRow key={`${r.object_type}:${r.id}`} item={r} sectors={lookup} />
              ))}
            </div>
          ) : (
            <EmptyState small Icon={Search} title="Nothing Found" body="Try fewer words, or a word from a note on the page you want." />
          )}
        </section>
      ) : (
        <section className="card">
          <EmptyState Icon={Search} title="Search Everything" body="Every sector, area, goal, project and note, at any depth." />
        </section>
      )}
    </>
  );
}
