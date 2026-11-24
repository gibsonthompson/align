'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveSectorPlan } from '@/app/plan-actions';
import type { Sector } from '@/lib/types';

const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[$,\s]/g, '')));

// Where this part of life is now, where he wants it, and what he will give it.
export default function SectorPlan({ sector }: { sector: Sector }) {
  const router = useRouter();
  const [now, setNow] = useState(sector.current_state ?? '');
  const [want, setWant] = useState(sector.desired_state ?? '');
  const [hours, setHours] = useState(sector.weekly_hours === null || sector.weekly_hours === undefined ? '' : String(sector.weekly_hours));
  const [money, setMoney] = useState(sector.monthly_budget === null || sector.monthly_budget === undefined ? '' : String(sector.monthly_budget));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const f = (document.activeElement as HTMLElement | null)?.dataset?.field;
    if (f !== 'now') setNow(sector.current_state ?? '');
    if (f !== 'want') setWant(sector.desired_state ?? '');
  }, [sector.current_state, sector.desired_state]);

  async function save(patch: Parameters<typeof saveSectorPlan>[1]) {
    setError(null);
    const res = await saveSectorPlan(sector.id, patch);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Now And Where You Want It</h2>
        <span className="panel-note">The gap every plan here exists to close</span>
      </div>
      <div className="panel-body sp-grid">
        <label className="field">
          <span className="field-label">Where it is now</span>
          <textarea data-field="now" className="textarea" rows={4} value={now} maxLength={5000} placeholder="Honestly, how this part of life is going today." onChange={(e) => setNow(e.target.value)} onBlur={() => now !== (sector.current_state ?? '') && save({ current_state: now })} />
        </label>
        <label className="field">
          <span className="field-label">Where you want it</span>
          <textarea data-field="want" className="textarea" rows={4} value={want} maxLength={5000} placeholder="Concretely, what it looks like when it is right." onChange={(e) => setWant(e.target.value)} onBlur={() => want !== (sector.desired_state ?? '') && save({ desired_state: want })} />
        </label>
        <label className="field">
          <span className="field-label">Hours a week you will give it</span>
          <input
            className="input"
            inputMode="decimal"
            value={hours}
            placeholder="Not set"
            onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => {
              const v = toNum(hours);
              if (v !== (sector.weekly_hours ?? null)) save({ weekly_hours: v });
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Money a month you will spend on it</span>
          <input
            className="input"
            inputMode="decimal"
            value={money}
            placeholder="Not set"
            onChange={(e) => setMoney(e.target.value)}
            onBlur={() => {
              const v = toNum(money);
              if (v !== (sector.monthly_budget ?? null)) save({ monthly_budget: v });
            }}
          />
        </label>
      </div>
      {error && <div className="inline-error">{error}</div>}
    </section>
  );
}
