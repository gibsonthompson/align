'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkIn } from '@/app/actions';
import { addDaysISO, mondayOf, shortDate } from '@/lib/format';
import { scheduledOn, WEEKDAYS } from '@/lib/habits';
import type { Habit, HabitLog } from '@/lib/types';

type Cell = 'done' | 'skipped' | 'missed' | 'open' | 'off' | 'future' | 'before';

// The last weeks of a habit, one column per week, Monday at the top.
// Click a past day to cycle it: done, skipped, cleared.
export default function HeatStrip({ habit, logs, today, weeks = 12, legend = true }: { habit: Habit; logs: HabitLog[]; today: string; weeks?: number; legend?: boolean }) {
  const router = useRouter();
  const [local, setLocal] = useState<Record<string, 'done' | 'skipped' | null>>({});
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setLocal({}), [logs]);

  const status = new Map(logs.map((l) => [l.day, l.status]));
  const statusOf = (d: string) => (d in local ? local[d] : (status.get(d) ?? null));
  const first = addDaysISO(mondayOf(today), -7 * (weeks - 1));
  const cols = Array.from({ length: weeks }, (_, w) => addDaysISO(first, w * 7));

  function cell(d: string): Cell {
    if (d > today) return 'future';
    if (d < habit.started_on) return 'before';
    const s = statusOf(d);
    if (s === 'done') return 'done';
    if (s === 'skipped') return 'skipped';
    if (habit.schedule === 'per_week') return 'open';
    if (!scheduledOn(habit, d)) return 'off';
    return d === today ? 'open' : 'missed';
  }

  function cycle(d: string) {
    const s = statusOf(d);
    const next = s === null ? 'done' : s === 'done' ? 'skipped' : null;
    setLocal((m) => ({ ...m, [d]: next }));
    setError(null);
    start(async () => {
      const res = await checkIn(habit.id, d, next);
      if (!res.ok) {
        setLocal((m) => ({ ...m, [d]: s }));
        setError(res.error);
      } else router.refresh();
    });
  }

  const LABEL: Record<Cell, string> = { done: 'Done', skipped: 'Skipped', missed: 'Missed', open: 'Not done', off: 'Not scheduled', future: '', before: 'Before it started' };

  return (
    <div className="heat">
      <div className="heat-grid" style={{ gridTemplateColumns: `18px repeat(${weeks}, 13px)` }}>
        {WEEKDAYS.map((w, r) => (
          <span key={w} className="heat-dow" style={{ gridRow: r + 1, gridColumn: 1 }}>
            {r % 2 === 0 ? w[0] : ''}
          </span>
        ))}
        {cols.map((w, c) =>
          Array.from({ length: 7 }, (_, r) => {
            const d = addDaysISO(w, r);
            const k = cell(d);
            const clickable = k !== 'future' && k !== 'before' && !habit.paused;
            return (
              <button
                key={d}
                type="button"
                className="heat-cell"
                data-k={k}
                data-today={d === today}
                style={{ gridRow: r + 1, gridColumn: c + 2 }}
                disabled={!clickable}
                title={k === 'future' ? '' : `${shortDate(d)}: ${LABEL[k]}${clickable ? '. Click to change.' : ''}`}
                aria-label={`${shortDate(d)}, ${LABEL[k] || 'upcoming'}`}
                onClick={() => clickable && cycle(d)}
              />
            );
          }),
        )}
      </div>
      {legend && (
        <div className="heat-legend">
          <span>
            <i className="heat-cell" data-k="done" /> Done
          </span>
          <span>
            <i className="heat-cell" data-k="skipped" /> Skipped
          </span>
          {habit.schedule !== 'per_week' && (
            <span>
              <i className="heat-cell" data-k="missed" /> Missed
            </span>
          )}
          <span className="dim">Click a day to change it</span>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
}
