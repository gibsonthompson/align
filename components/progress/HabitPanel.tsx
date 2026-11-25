'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Check, Flame, Loader2, Pencil, Repeat, Trash2 } from 'lucide-react';
import { checkIn, placeHabits, removeHabit, setHabit, type HabitConfig } from '@/app/actions';
import { scheduleLabel, WEEKDAYS } from '@/lib/habits';
import { clock } from '@/lib/tz';
import type { HabitRow } from '@/lib/progress';
import type { HabitSchedule } from '@/lib/types';
import Dropdown from '@/components/Dropdown';
import EmptyState from '@/components/EmptyState';
import HeatStrip from '@/components/progress/HeatStrip';

const SCHEDULES: { value: HabitSchedule; label: string }[] = [
  { value: 'daily', label: 'Every Day' },
  { value: 'days', label: 'Certain Days' },
  { value: 'per_week', label: 'Times A Week' },
];

type Form = Required<Omit<HabitConfig, 'days'>> & { days: number[] };

function toForm(h: HabitRow | null, cadence: string): Form {
  if (h) {
    return {
      schedule: h.schedule,
      days: h.days,
      per_week: h.per_week ?? 3,
      minutes: h.minutes,
      window_start: h.window_start,
      window_end: h.window_end,
      auto_place: h.auto_place,
      paused: h.paused,
    };
  }
  // A cadence like "4 times a week, 20 minutes" gives a head start.
  const times = /(\d)\s*(?:x|times)/i.exec(cadence)?.[1];
  const mins = /(\d{1,3})\s*(?:min|minutes)/i.exec(cadence)?.[1];
  const daily = /daily|every day/i.test(cadence);
  return {
    schedule: daily ? 'daily' : 'per_week',
    days: [1, 3, 5],
    per_week: times ? Math.min(7, Math.max(1, Number(times))) : 3,
    minutes: mins ? Number(mins) : 30,
    window_start: null,
    window_end: null,
    auto_place: false,
    paused: false,
  };
}

const TIMES = [{ value: '', label: 'Any time' }, ...Array.from({ length: 48 }, (_, i) => ({ value: String(i * 30), label: clock(i * 30) }))];

export default function HabitPanel({ nodeId, habit, cadence, today, archived }: { nodeId: string; habit: HabitRow | null; cadence: string; today: string; archived: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Form>(() => toForm(habit, cadence));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, start] = useTransition();
  const [placing, startPlace] = useTransition();
  useEffect(() => setF(toForm(habit, cadence)), [habit, cadence]);
  const set = (p: Partial<Form>) => setF((c) => ({ ...c, ...p }));

  const endOpts = useMemo(() => TIMES.filter((t) => t.value === '' || f.window_start === null || Number(t.value) > f.window_start).concat([{ value: '1440', label: 'Midnight' }]), [f.window_start]);

  function save() {
    setError(null);
    start(async () => {
      const res = await setHabit(nodeId, f);
      if (!res.ok) return setError(res.error);
      setEditing(false);
      router.refresh();
    });
  }

  const form = (
    <div className="hp-form">
      <div className="field">
        <span className="field-label">How often</span>
        <div className="segmented">
          {SCHEDULES.map((s) => (
            <button key={s.value} type="button" aria-pressed={f.schedule === s.value} onClick={() => set({ schedule: s.value })}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {f.schedule === 'days' && (
        <div className="field">
          <span className="field-label">Which days</span>
          <div className="segmented hp-days">
            {WEEKDAYS.map((w, i) => (
              <button
                key={w}
                type="button"
                aria-pressed={f.days.includes(i + 1)}
                onClick={() => set({ days: f.days.includes(i + 1) ? f.days.filter((d) => d !== i + 1) : [...f.days, i + 1].sort() })}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      )}
      {f.schedule === 'per_week' && (
        <div className="field">
          <span className="field-label">Times a week</span>
          <div className="segmented hp-days">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button key={n} type="button" aria-pressed={f.per_week === n} onClick={() => set({ per_week: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="bs-grid">
        <label className="field">
          <span className="field-label">Minutes each</span>
          <input
            className="input"
            inputMode="numeric"
            value={f.minutes ?? ''}
            placeholder="30"
            onChange={(e) => set({ minutes: e.target.value ? Number(e.target.value.replace(/\D/g, '').slice(0, 3)) : null })}
          />
        </label>
        <div className="field">
          <span className="field-label">Earliest</span>
          <Dropdown label="Earliest time" value={f.window_start === null ? '' : String(f.window_start)} options={TIMES} onChange={(v) => set({ window_start: v === '' ? null : Number(v) })} />
        </div>
        <div className="field">
          <span className="field-label">Latest end</span>
          <Dropdown label="Latest end time" value={f.window_end === null ? '' : String(f.window_end)} options={endOpts} onChange={(v) => set({ window_end: v === '' ? null : Number(v) })} />
        </div>
      </div>
      <div className="hp-switches">
        <label className="hp-switch">
          <button type="button" className="switch" role="switch" aria-checked={f.auto_place} onClick={() => set({ auto_place: !f.auto_place })} aria-label="Place on the calendar" />
          <span>
            <b>Place on the calendar</b>
            <span className="dim">Each week, its sessions go into free time inside the window.</span>
          </span>
        </label>
        {habit && (
          <label className="hp-switch">
            <button type="button" className="switch" role="switch" aria-checked={f.paused} onClick={() => set({ paused: !f.paused })} aria-label="Paused" />
            <span>
              <b>Paused</b>
              <span className="dim">Keeps the history, stops counting misses.</span>
            </span>
          </label>
        )}
      </div>
      {error && <div className="form-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {(habit || editing) && (
          <button type="button" className="btn" onClick={() => (habit ? setEditing(false) : setEditing(false))}>
            Cancel
          </button>
        )}
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          {busy && <Loader2 size={14} className="spin" />} {habit ? 'Save' : 'Make It A Habit'}
        </button>
      </div>
    </div>
  );

  if (!habit) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Habit</h2>
        </div>
        {editing ? (
          <div className="panel-body">{form}</div>
        ) : (
          <EmptyState Icon={Repeat} title="Not A Habit Yet" body="Give this a schedule and it gets a check-in every day it happens, a streak, and time on the calendar.">
            {!archived && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                <Repeat size={14} /> Make It A Habit
              </button>
            )}
          </EmptyState>
        )}
      </section>
    );
  }

  const s = habit.stat;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Habit <span className="tag">{scheduleLabel(habit)}</span>
          {habit.window_start !== null && (
            <span className="tag">
              {clock(habit.window_start)} to {clock(habit.window_end ?? 1440)}
            </span>
          )}
          {habit.paused && <span className="tag">Paused</span>}
        </h2>
        {!archived && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn icon ghost" style={{ width: 28, height: 28 }} onClick={() => setEditing((v) => !v)} aria-label="Edit the schedule" title="Edit">
              <Pencil size={13} />
            </button>
            <button type="button" className="btn icon ghost" style={{ width: 28, height: 28 }} onClick={() => setConfirmRemove((v) => !v)} aria-label="Stop tracking as a habit" title="Remove">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      {confirmRemove && (
        <div className="panel-body mcard-confirm">
          <span>Stop tracking this as a habit? Its check-ins are deleted. The page stays.</span>
          <button
            type="button"
            className="btn danger"
            onClick={() =>
              start(async () => {
                const res = await removeHabit(nodeId);
                if (!res.ok) setError(res.error);
                else router.refresh();
              })
            }
          >
            Remove
          </button>
        </div>
      )}
      <div className="panel-body">
        {editing ? (
          form
        ) : (
          <>
            <div className="bal four hp-stats">
              <div className="stat">
                <div className="stat-label">This week</div>
                <div className="stat-value">
                  {s.weekDone}
                  <span className="dim" style={{ fontSize: 15 }}>
                    /{s.weekTarget}
                  </span>
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Streak</div>
                <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Flame size={16} /> {s.streak}
                  <span className="dim" style={{ fontSize: 13 }}>
                    {s.streakUnit}
                    {s.streak === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Last 4 weeks</div>
                <div className="stat-value">{s.rate === null ? <span className="dim">None</span> : `${Math.round(s.rate * 100)}%`}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Today</div>
                <button
                  type="button"
                  className={`btn${s.doneToday ? '' : ' primary'}`}
                  style={{ marginTop: 6 }}
                  disabled={busy || habit.paused}
                  onClick={() =>
                    start(async () => {
                      const res = await checkIn(habit.id, today, s.doneToday ? null : 'done');
                      if (!res.ok) setError(res.error);
                      else router.refresh();
                    })
                  }
                >
                  <Check size={14} /> {s.doneToday ? 'Done' : 'Check In'}
                </button>
              </div>
            </div>
            <HeatStrip habit={habit} logs={habit.logs} today={today} weeks={16} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              <button
                type="button"
                className="btn"
                disabled={placing || habit.paused || s.remainingThisWeek === 0}
                onClick={() =>
                  startPlace(async () => {
                    setNote(null);
                    const res = await placeHabits(today, [habit.id]);
                    if (!res.ok) return setError(res.error);
                    const n = res.data?.placed.length ?? 0;
                    setNote(n ? `Placed ${n} ${n === 1 ? 'session' : 'sessions'} on the calendar this week.` : (res.data?.skipped[0]?.reason ?? 'Nothing to place.'));
                    router.refresh();
                  })
                }
              >
                {placing ? <Loader2 size={14} className="spin" /> : <CalendarPlus size={14} />} Schedule This Week
              </button>
              {note && <span className="dim" style={{ fontSize: 12.5, alignSelf: 'center' }}>{note}</span>}
            </div>
          </>
        )}
        {error && !editing && <div className="inline-error">{error}</div>}
      </div>
    </section>
  );
}
