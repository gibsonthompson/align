import type { Metadata } from 'next';
import Link from 'next/link';
import { Gauge, Repeat } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { getSectors } from '@/lib/data';
import { getHabits, getMeasures } from '@/lib/progress';
import { sectorLookup } from '@/lib/sectors';
import { todayISO } from '@/lib/format';
import TopBar from '@/components/TopBar';
import EmptyState from '@/components/EmptyState';
import HabitItem from '@/components/progress/HabitItem';
import MeasureCard from '@/components/progress/MeasureCard';
import ProgressActions from '@/components/progress/ProgressActions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Progress · Align' };

export default async function ProgressPage() {
  await requireSession();
  const [habits, measures, sectors] = await Promise.all([getHabits(), getMeasures(), getSectors()]);
  const today = todayISO();
  const lookup = sectorLookup(sectors);
  const active = habits.filter((h) => !h.paused);
  const due = active.filter((h) => h.stat.dueToday);
  const doneToday = active.filter((h) => h.stat.doneToday).length;
  const best = active.reduce((b, h) => (h.stat.streak > b.streak ? { streak: h.stat.streak, unit: h.stat.streakUnit, title: h.node.title } : b), { streak: 0, unit: 'day', title: '' });
  const tracked = measures.filter((m) => m.stat.onTrack !== null);
  const onTrack = tracked.filter((m) => m.stat.onTrack).length;

  return (
    <>
      <TopBar title="Progress" />
      <div className="content">
        <div className="page-head">
          <div>
            <div className="eyebrow">Habits and measures</div>
            <h1 style={{ marginTop: 8 }}>Progress</h1>
          </div>
          <ProgressActions today={today} sectors={sectors} canPlace={active.length > 0} />
        </div>

        <div className="bal four" style={{ marginBottom: 18 }}>
          <div className="stat">
            <div className="stat-label">Due today</div>
            <div className="stat-value">{due.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Checked in today</div>
            <div className={`stat-value${doneToday && doneToday >= due.length ? ' good' : ''}`}>
              {doneToday}
              <span className="dim" style={{ fontSize: 15 }}>
                /{due.length}
              </span>
            </div>
          </div>
          <div className="stat" title={best.title}>
            <div className="stat-label">Best streak</div>
            <div className="stat-value">
              {best.streak}
              <span className="dim" style={{ fontSize: 13 }}>
                {' '}
                {best.unit}
                {best.streak === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Measures on track</div>
            <div className="stat-value">
              {onTrack}
              <span className="dim" style={{ fontSize: 15 }}>
                /{tracked.length}
              </span>
            </div>
          </div>
        </div>

        <section className="panel" style={{ marginBottom: 22 }}>
          <div className="panel-head">
            <h2 className="panel-title">
              Habits <span className="count">{habits.length}</span>
            </h2>
            <span className="panel-note">Last 12 weeks, click a day to change it</span>
          </div>
          {habits.length ? (
            <div className="habit-list">
              {habits.map((h) => (
                <HabitItem key={h.id} h={h} today={today} sectors={lookup} full />
              ))}
            </div>
          ) : (
            <EmptyState Icon={Repeat} title="No Habits Yet" body="Open any Weekly Commitment and give it a schedule, or tell ChatGPT what you want to do every week. Each one gets a daily check-in, a streak and time on the calendar.">
              <Link href="/life" className="btn">
                Open Life
              </Link>
            </EmptyState>
          )}
        </section>

        <div className="mpanel-head">
          <h2 className="panel-title">
            Measures <span className="count">{measures.length}</span>
          </h2>
        </div>
        {measures.length ? (
          <div className="mgrid" data-odd={measures.length % 2 === 1}>
            {measures.map((m) => (
              <MeasureCard key={m.id} m={m} today={today} sectors={lookup} allSectors={sectors} />
            ))}
          </div>
        ) : (
          <section className="panel">
            <EmptyState Icon={Gauge} title="No Measures Yet" body="Body weight, miles a week, savings, songs learned. Add the numbers that prove your goals are moving, and log them as you go." />
          </section>
        )}
      </div>
    </>
  );
}
