'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Loader2, Plus } from 'lucide-react';
import { placeHabits } from '@/app/actions';
import type { Sector } from '@/lib/types';
import MeasureForm from '@/components/progress/MeasureForm';

export default function ProgressActions({ today, sectors, canPlace }: { today: string; sectors: Sector[]; canPlace: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="progress-actions">
      {note && <span className="dim" style={{ fontSize: 12.5 }}>{note}</span>}
      {canPlace && (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const res = await placeHabits(today);
              if (!res.ok) return setNote(res.error);
              const n = res.data?.placed.length ?? 0;
              const miss = res.data?.skipped.filter((s) => s.reason.startsWith('No free')).length ?? 0;
              setNote(n ? `Placed ${n} ${n === 1 ? 'session' : 'sessions'} this week${miss ? `, ${miss} could not fit` : ''}.` : miss ? `${miss} could not fit in their time windows.` : 'Every habit is already on track or booked this week.');
              router.refresh();
            })
          }
        >
          {busy ? <Loader2 size={14} className="spin" /> : <CalendarPlus size={14} />} Place This Week
        </button>
      )}
      <button type="button" className="btn primary" onClick={() => setAdding(true)}>
        <Plus size={14} /> New Measure
      </button>
      <MeasureForm open={adding} onClose={() => setAdding(false)} sectors={sectors} />
    </div>
  );
}
