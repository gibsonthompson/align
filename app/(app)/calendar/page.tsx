import type { Metadata } from 'next';
import { getCalendar, type CalendarNode } from '@/lib/calendar';
import { db } from '@/lib/db';
import { isId } from '@/lib/ids';
import Calendar from '@/components/calendar/Calendar';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Calendar · Align' };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const data = await getCalendar(one(sp.view), one(sp.date));

  // "Schedule It" from a page opens the calendar with that page ready to place.
  let scheduleNode: CalendarNode | null = null;
  const sid = one(sp.schedule);
  if (isId(sid)) {
    const { data: n } = await db()
      .from('align_nodes')
      .select('id, type, title, status, sector_id, parent_id, due_date, start_date, event_date, location, effort_minutes, done_criteria, actionable')
      .eq('id', sid)
      .eq('archived', false)
      .maybeSingle();
    scheduleNode = (n as CalendarNode | null) ?? null;
  }

  return (
    <Calendar key={`${data.view}:${data.from}`} data={data} explicitView={Boolean(one(sp.view))} scheduleNode={scheduleNode} />
  );
}
