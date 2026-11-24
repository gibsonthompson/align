'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Flame, Pause } from 'lucide-react';
import { checkIn } from '@/app/actions';
import { scheduleLabel } from '@/lib/habits';
import type { HabitRow } from '@/lib/progress';
import type { SectorLookup } from '@/components/ObjectRow';
import HeatStrip from '@/components/progress/HeatStrip';

// One habit: today's check, where the week stands, the streak, and (full) its last 12 weeks.
export default function HabitItem({ h, today, sectors, full = false }: { h: HabitRow; today: string; sectors: SectorLookup; full?: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState(h.stat.doneToday);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDone(h.stat.doneToday), [h.stat.doneToday]);

  const weekDone = h.stat.weekDone + (done && !h.stat.doneToday ? 1 : !done && h.stat.doneToday ? -1 : 0);
  const colour = h.node.sector_id ? (sectors[h.node.sector_id]?.colour ?? '#8a8a8a') : '#8a8a8a';

  function toggle() {
    const next = !done;
    setDone(next);
    setError(null);
    start(async () => {
      const res = await checkIn(h.id, today, next ? 'done' : null);
      if (!res.ok) {
        setDone(!next);
        setError(res.error);
      } else router.refresh();
    });
  }

  const s = h.stat;
  return (
    <div className="habit" data-full={full} data-paused={h.paused} style={{ ['--c' as string]: colour }}>
      <div className="habit-row">
        <button
          type="button"
          className="check"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Undo today's check-in for ${h.node.title}` : `Check in ${h.node.title} for today`}
          disabled={busy || h.paused}
          onClick={toggle}
        >
          <Check size={12} strokeWidth={3.4} />
        </button>
        <div className="habit-main">
          <Link href={`/n/${h.node_id}`} className="habit-title">
            {h.node.title}
          </Link>
          <span className="habit-sub">
            <i className="swatch" aria-hidden />
            {scheduleLabel(h)}
            {h.paused && (
              <span className="tag">
                <Pause size={10} /> Paused
              </span>
            )}
            {!h.paused && s.skippedToday && <span className="tag">Skipped today</span>}
          </span>
        </div>
        <div className="habit-stats">
          <span className="habit-week" title="Done this week">
            <span className="mono">
              {weekDone}/{s.weekTarget}
            </span>
            <span className="habit-bar" aria-hidden>
              <i style={{ width: `${Math.min(100, (weekDone / Math.max(1, s.weekTarget)) * 100)}%` }} />
            </span>
          </span>
          <span className={`tag${s.streak >= 3 ? ' good' : ''}`} title={`Current streak in ${s.streakUnit}s`}>
            <Flame size={10} /> {s.streak} {s.streakUnit}
            {s.streak === 1 ? '' : 's'}
          </span>
          {full && s.rate !== null && (
            <span className="tag" title="Share of expected sessions done over the last 4 weeks">
              {Math.round(s.rate * 100)}% 4 wk
            </span>
          )}
        </div>
      </div>
      {full && <HeatStrip habit={h} logs={h.logs} today={today} weeks={12} legend={false} />}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}
