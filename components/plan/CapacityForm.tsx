'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { saveCapacityAction } from '@/app/plan-actions';
import type { Capacity } from '@/lib/types';

const WAKING = 126; // 5 AM to 11 PM, seven days

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

// What he really has to give each week: the numbers every plan is checked against.
export default function CapacityForm({ capacity }: { capacity: Capacity }) {
  const router = useRouter();
  const [work, setWork] = useState(capacity.work_hours_per_week === null ? '' : String(capacity.work_hours_per_week));
  const [buffer, setBuffer] = useState(String(capacity.buffer_percent));
  const [maxDay, setMaxDay] = useState(String(capacity.max_day_hours));
  const [money, setMoney] = useState(capacity.monthly_discretionary_usd === null ? '' : String(capacity.monthly_discretionary_usd));
  const [peak, setPeak] = useState(capacity.peak_energy);
  const [notes, setNotes] = useState(capacity.energy_notes);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();

  const w = numOrNull(work) ?? 0;
  const free = Math.max(0, WAKING - (Number.isFinite(w) ? w : 0));
  const b = Number(buffer);
  const plannable = free * (1 - (Number.isFinite(b) ? Math.min(Math.max(b, 0), 90) : 25) / 100);

  function save() {
    setError(null);
    setSaved(false);
    const patch = {
      work_hours_per_week: numOrNull(work),
      buffer_percent: Number(buffer),
      max_day_hours: Number(maxDay),
      monthly_discretionary_usd: numOrNull(money.replace(/[$,\s]/g, '')),
      peak_energy: peak,
      energy_notes: notes,
    };
    start(async () => {
      const res = await saveCapacityAction(patch);
      if (!res.ok) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="panel" id="capacity">
      <div className="panel-head">
        <h2 className="panel-title">What You Have To Give</h2>
        <span className="panel-note">
          {Math.round(free)} free hours, {Math.round(plannable)} plannable
        </span>
      </div>
      <form
        className="panel-body cap-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="cap-grid">
          <label className="field">
            <span className="field-label">Work hours a week</span>
            <input className="input" inputMode="decimal" value={work} placeholder="Not set" onChange={(e) => setWork(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          <label className="field">
            <span className="field-label">Keep free, percent</span>
            <input className="input" inputMode="numeric" value={buffer} onChange={(e) => setBuffer(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </label>
          <label className="field">
            <span className="field-label">Most planned hours in a day</span>
            <input className="input" inputMode="decimal" value={maxDay} onChange={(e) => setMaxDay(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          <label className="field">
            <span className="field-label">Spending money a month</span>
            <input className="input" inputMode="decimal" value={money} placeholder="Not set" onChange={(e) => setMoney(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">When you have the most energy</span>
          <input className="input" value={peak} maxLength={200} placeholder="For example: early mornings, before 10 AM" onChange={(e) => setPeak(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Energy notes</span>
          <textarea className="textarea" rows={2} value={notes} maxLength={2000} placeholder="What drains you, what restores you, how sleep or travel affects you." onChange={(e) => setNotes(e.target.value)} />
        </label>
        <p className="dim" style={{ fontSize: 12, lineHeight: 1.5 }}>
          Work hours are time outside your own plan. If you book work on the calendar, leave it out here so it is not counted twice.
        </p>
        {error && <div className="form-error">{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
          {saved && <span className="dim">Saved</span>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <Loader2 size={14} className="spin" />} Save
          </button>
        </div>
      </form>
    </section>
  );
}
