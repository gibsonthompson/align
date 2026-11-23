import Link from 'next/link';
import { History } from 'lucide-react';
import { hrefFor, NODE_KINDS, relationLabel, STATUS_LABEL } from '@/lib/kinds';
import { shortDate, timeAgo } from '@/lib/format';
import type { Activity, NodeStatus, NodeType, ObjectRef, Relation } from '@/lib/types';
import EmptyState from '@/components/EmptyState';

type Row = Activity & { other?: ObjectRef | null };

function Other({ other, fallback }: { other?: ObjectRef | null; fallback: string }) {
  if (!other) return <b>{fallback}</b>;
  return <Link href={hrefFor(other)}>{other.title}</Link>;
}

function describe(r: Row): { text: React.ReactNode; tone: 'plain' | 'strong' | 'good' } {
  const d = r.detail as Record<string, string | null>;
  switch (r.action) {
    case 'created':
      return { text: <>Created{d.type ? ` as a ${NODE_KINDS[d.type as NodeType]?.label ?? 'page'}` : ''}</>, tone: 'strong' };
    case 'renamed':
      return {
        text: (
          <>
            Renamed to <b>{d.to}</b>
          </>
        ),
        tone: 'plain',
      };
    case 'completed':
      return { text: <>Marked done</>, tone: 'good' };
    case 'status':
      return {
        text: (
          <>
            Status set to <b>{STATUS_LABEL[d.to as NodeStatus] ?? d.to}</b>
          </>
        ),
        tone: 'plain',
      };
    case 'archived':
      return { text: <>Archived</>, tone: 'plain' };
    case 'restored':
      return { text: <>Restored</>, tone: 'plain' };
    case 'moved':
      return {
        text: d.to ? (
          <>
            Moved under <Other other={r.other} fallback="another page" />
          </>
        ) : (
          <>Moved to the top of its sector</>
        ),
        tone: 'plain',
      };
    case 'dates':
      return {
        text: (
          <>
            Dates set{d.start ? `, starts ${shortDate(d.start)}` : ''}
            {d.due ? `, due ${shortDate(d.due)}` : ''}
            {!d.start && !d.due ? ' (cleared)' : ''}
          </>
        ),
        tone: 'plain',
      };
    case 'edited':
      return { text: <>Description edited</>, tone: 'plain' };
    case 'child_added':
      return {
        text: (
          <>
            Added <Other other={r.other} fallback={d.title ?? 'a page'} /> underneath
          </>
        ),
        tone: 'plain',
      };
    case 'linked':
    case 'unlinked':
      return {
        text: (
          <>
            {r.action === 'linked' ? 'Linked' : 'Unlinked'}: {relationLabel((d.relation ?? 'related') as Relation, (d.direction ?? 'out') as 'out' | 'in').toLowerCase()}{' '}
            <Other other={r.other} fallback="a page" />
          </>
        ),
        tone: 'plain',
      };
    case 'note_added':
      return { text: <>Note added</>, tone: 'plain' };
    case 'note_removed':
      return { text: <>Note removed</>, tone: 'plain' };
    case 'rated':
      return { text: <>Ratings updated</>, tone: 'plain' };
    default:
      return { text: <>{r.action}</>, tone: 'plain' };
  }
}

// Every change, completion and connection on this page, newest first.
export default function ActivitySection({ rows }: { rows: Row[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">
          History
          <span className="count">{rows.length}</span>
        </h2>
      </div>
      {rows.length === 0 ? (
        <EmptyState Icon={History} title="No History Yet" body="Changes, completions and links show up here as they happen." />
      ) : (
        <div className="timeline">
          {rows.map((r) => {
            const { text, tone } = describe(r);
            return (
              <div className="event" key={r.id}>
                <span className={`pip${tone === 'strong' ? ' strong' : tone === 'good' ? ' good' : ''}`} aria-hidden />
                <span className="what">
                  {text}
                  {r.via === 'chatgpt' && (
                    <span className="tag" style={{ marginLeft: 6, verticalAlign: 1 }}>
                      via ChatGPT
                    </span>
                  )}
                </span>
                <span className="when">{timeAgo(r.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
