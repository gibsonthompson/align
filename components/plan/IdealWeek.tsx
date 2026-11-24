'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { saveLifestyleAction } from '@/app/plan-actions';
import { clock, hhmm } from '@/lib/tz';
import type { IdealSlot, Sector } from '@/lib/types';
import Dropdown from '@/components/Dropdown';
import Sheet from '@/components/Sheet';

const START = 300; // 5 AM
const END = 1380; // 11 PM
const HOUR_PX = 26;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIMES = Array.from({ length: (END - START) / 15 + 1 }, (_, i) => START + i * 15);

type Edit = { index: number | null; slot: IdealSlot };

// The week he wants, hour by hour, coloured by sector, next to how this week is actually planned.
export default function IdealWeek({
  slots,
  sectors,
  planned,
}: {
  slots: IdealSlot[];
  sectors: Sector[];
  planned: { sector_id: string; minutes: number }[];
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<Edit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const tops = sectors.filter((s) => !s.parent_id);
  const byId = useMemo(() => new Map(sectors.map((s) => [s.id, s])), [sectors]);
  const colour = (id: string | null) => (id ? (byId.get(id)?.colour ?? '#8a8a8a') : '#5a5a5a');

  const ideal = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots) if (s.sector_id) m.set(s.sector_id, (m.get(s.sector_id) ?? 0) + (s.end - s.start));
    return m;
  }, [slots]);
  const compare = tops
    .map((s) => ({ s, ideal: ideal.get(s.id) ?? 0, planned: planned.find((p) => p.sector_id === s.id)?.minutes ?? 0 }))
    .filter((r) => r.ideal || r.planned);
  const unassigned = slots.filter((s) => !s.sector_id).reduce((n, s) => n + s.end - s.start, 0);
  const maxBar = Math.max(1, ...compare.map((r) => Math.max(r.ideal, r.planned)));

  function persist(next: IdealSlot[]) {
    setError(null);
    start(async () => {
      const res = await saveLifestyleAction({ ideal_week: next });
      if (!res.ok) return setError(res.error);
      setEdit(null);
      router.refresh();
    });
  }

  function saveEdit() {
    if (!edit) return;
    const s = edit.slot;
    if (s.end <= s.start) return setError('The end has to be after the start.');
    const next = [...slots];
    if (edit.index === null) next.push(s);
    else next[edit.index] = s;
    persist(next);
  }

  return (
    <div className="iw-wrap">
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">
            Your Ideal Week <span className="count">{slots.length}</span>
          </h2>
          <button type="button" className="btn primary" onClick={() => setEdit({ index: null, slot: { day: 1, start: 360, end: 420, label: '', sector_id: null } })}>
            <Plus size={14} /> Add Block
          </button>
        </div>
        <div className="iw-grid" style={{ ['--h' as string]: `${((END - START) / 60) * HOUR_PX}px` }}>
          <div className="iw-gutter">
            <div className="iw-head" />
            <div className="iw-col-body">
              {Array.from({ length: (END - START) / 60 }, (_, i) => (
                <span key={i} style={{ top: i * HOUR_PX }}>
                  {clock(START + i * 60, true)}
                </span>
              ))}
            </div>
          </div>
          {DAYS.map((d, di) => (
            <div key={d} className="iw-col">
              <div className="iw-head">{d}</div>
              <div
                className="iw-col-body"
                onDoubleClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const min = START + Math.floor(((e.clientY - r.top) / HOUR_PX) * 4) * 15;
                  setEdit({ index: null, slot: { day: di + 1, start: min, end: Math.min(END, min + 60), label: '', sector_id: null } });
                }}
              >
                {slots.map((s, i) =>
                  s.day === di + 1 ? (
                    <button
                      key={i}
                      type="button"
                      className="iw-slot"
                      style={{
                        top: ((Math.max(s.start, START) - START) / 60) * HOUR_PX,
                        height: Math.max(12, ((Math.min(s.end, END) - Math.max(s.start, START)) / 60) * HOUR_PX - 2),
                        ['--c' as string]: colour(s.sector_id),
                      }}
                      title={`${s.label || 'Untitled'}, ${clock(s.start)} to ${clock(s.end)}`}
                      onClick={() => setEdit({ index: i, slot: { ...s } })}
                    >
                      <b>{s.label || 'Untitled'}</b>
                      {s.end - s.start >= 90 && <span>{`${clock(s.start, true)} to ${clock(s.end, true)}`}</span>}
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="panel-note" style={{ padding: '10px 16px' }}>
          Double-click an empty spot to add a block there. Leave real gaps: unplanned time is part of the design.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Ideal Against This Week</h2>
          <span className="panel-note">Hours a week</span>
        </div>
        <div className="panel-body iw-compare">
          {compare.length === 0 && <p className="dim">Add blocks with a sector to compare your ideal week with what is planned.</p>}
          {compare.map(({ s, ideal: i, planned: p }) => (
            <div key={s.id} className="iw-row" style={{ ['--c' as string]: s.colour }}>
              <span className="iw-name">
                <i className="swatch" aria-hidden /> {s.name}
              </span>
              <div className="iw-bars">
                <i className="ideal" style={{ width: `${(i / maxBar) * 100}%` }} />
                <i className="planned" style={{ width: `${(p / maxBar) * 100}%` }} />
              </div>
              <span className="mono">
                {(p / 60).toFixed(1)} / {(i / 60).toFixed(1)}
              </span>
            </div>
          ))}
          {compare.length > 0 && (
            <div className="iw-legend dim">
              <span>
                <i className="ph-key plannable" /> Ideal
              </span>
              <span>
                <i className="ph-key planned" /> Planned this week
              </span>
              {unassigned > 0 && <span>{(unassigned / 60).toFixed(1)} ideal hours have no sector</span>}
            </div>
          )}
        </div>
      </section>

      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={edit?.index === null ? 'Add To Your Ideal Week' : 'Edit Block'}>
        {edit && (
          <div className="iw-form">
            <label className="field">
              <span className="field-label">What</span>
              <input
                className="input"
                autoFocus
                value={edit.slot.label}
                maxLength={80}
                placeholder="Run, deep work, date night, unplanned"
                onChange={(e) => setEdit({ ...edit, slot: { ...edit.slot, label: e.target.value } })}
              />
            </label>
            <div className="iw-form-row">
              <Dropdown label="Day" value={String(edit.slot.day)} options={DAYS.map((d, i) => ({ value: String(i + 1), label: d }))} onChange={(v) => setEdit({ ...edit, slot: { ...edit.slot, day: Number(v) } })} />
              <Dropdown label="Starts" value={String(edit.slot.start)} options={TIMES.slice(0, -1).map((t) => ({ value: String(t), label: clock(t) }))} onChange={(v) => setEdit({ ...edit, slot: { ...edit.slot, start: Number(v), end: Math.max(edit.slot.end, Number(v) + 15) } })} />
              <Dropdown label="Ends" value={String(edit.slot.end)} options={TIMES.filter((t) => t > edit.slot.start).map((t) => ({ value: String(t), label: clock(t) }))} onChange={(v) => setEdit({ ...edit, slot: { ...edit.slot, end: Number(v) } })} />
            </div>
            <Dropdown
              label="Sector"
              value={edit.slot.sector_id ?? ''}
              options={[{ value: '', label: 'No sector (free time)' }, ...tops.map((s) => ({ value: s.id, label: s.name, colour: s.colour }))]}
              onChange={(v) => setEdit({ ...edit, slot: { ...edit.slot, sector_id: v || null } })}
            />
            <p className="dim" style={{ fontSize: 12 }}>
              {DAYS[edit.slot.day - 1]} {hhmm(edit.slot.start)} to {hhmm(edit.slot.end)}
            </p>
            {error && <div className="form-error">{error}</div>}
            <div className="btn-row">
              {edit.index !== null && (
                <button type="button" className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => persist(slots.filter((_, i) => i !== edit.index))}>
                  <Trash2 size={14} /> Remove
                </button>
              )}
              <button type="button" className="btn" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={saveEdit}>
                {busy && <Loader2 size={14} className="spin" />} Save
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
