import Link from 'next/link';
import { CalendarClock, CalendarPlus } from 'lucide-react';
import { shortDate, todayISO } from '@/lib/format';
import { clock, duration, utcToZoned } from '@/lib/tz';
import type { AlignNode, Block } from '@/lib/types';
import EmptyState from '@/components/EmptyState';

const STATUS: Record<Block['status'], string> = { planned: 'Planned', done: 'Done', skipped: 'Skipped' };

// Where this page sits on the calendar: upcoming sessions first, then the last few done.
export default function NodeSchedule({ node, blocks }: { node: AlignNode; blocks: Block[] }) {
  const today = todayISO();
  const now = Date.now();
  const rows = blocks.map((b) => {
    const a = utcToZoned(b.start_at);
    const z = utcToZoned(b.end_at);
    return { b, date: a.date, s: a.minutes, mins: Math.round((new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000), e: z.minutes };
  });
  const upcoming = rows.filter((r) => new Date(r.b.end_at).getTime() >= now).sort((x, y) => x.b.start_at.localeCompare(y.b.start_at));
  const past = rows.filter((r) => new Date(r.b.end_at).getTime() < now).slice(0, Math.max(0, 6 - upcoming.length));
  const shown = [...upcoming.slice(0, 6), ...past];
  const doneMin = rows.filter((r) => r.b.status === 'done').reduce((n, r) => n + r.mins, 0);
  const day = node.due_date && node.due_date >= today ? node.due_date : today;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">
          On The Calendar <span className="count">{blocks.length}</span>
        </h2>
        {!node.archived && node.status !== 'done' && (
          <Link href={`/calendar?view=day&date=${day}&schedule=${node.id}`} className="btn">
            <CalendarPlus size={14} /> Schedule It
          </Link>
        )}
      </div>
      {shown.length ? (
        <>
          <div className="rows">
            {shown.map(({ b, date, s, e }) => (
              <Link key={b.id} href={`/calendar?view=day&date=${date}`} className="sched-row" data-status={b.status} style={{ gridTemplateColumns: '1fr auto' }}>
                <span className="sched-title">
                  <CalendarClock size={14} />
                  <span>
                    {date === today ? 'Today' : shortDate(date)}, {clock(s)} to {clock(e)}
                  </span>
                </span>
                <span className={`tag${b.status === 'done' ? ' good' : ''}`}>{STATUS[b.status]}</span>
              </Link>
            ))}
          </div>
          {doneMin > 0 && (
            <div className="panel-body" style={{ borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--text-2)' }}>
              {duration(doneMin)} spent on this so far
            </div>
          )}
        </>
      ) : (
        <EmptyState Icon={CalendarClock} title="Not Scheduled" body="Give this a time on the calendar so it actually happens." />
      )}
    </section>
  );
}
