'use client';

import { useState } from 'react';
import { Gauge, Plus } from 'lucide-react';
import type { MeasureRow } from '@/lib/progress';
import type { SectorLookup } from '@/components/ObjectRow';
import EmptyState from '@/components/EmptyState';
import MeasureCard from '@/components/progress/MeasureCard';
import MeasureForm from '@/components/progress/MeasureForm';

// The numbers that tell whether this page is actually moving.
export default function MeasuresPanel({ nodeId, measures, today, sectors, archived }: { nodeId: string; measures: MeasureRow[]; today: string; sectors: SectorLookup; archived: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="mpanel">
      <div className="mpanel-head">
        <h2 className="panel-title">
          Measures <span className="count">{measures.length}</span>
        </h2>
        {!archived && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add Measure
          </button>
        )}
      </div>
      {measures.length ? (
        <div className="mgrid" data-odd={measures.length % 2 === 1}>
          {measures.map((m) => (
            <MeasureCard key={m.id} m={m} today={today} sectors={sectors} showPage={false} />
          ))}
        </div>
      ) : (
        <section className="panel">
          <EmptyState Icon={Gauge} title="No Measures Yet" body="Track the number that proves this is working: weight, miles, savings, songs learned. Progress toward its target shows here." />
        </section>
      )}
      <MeasureForm open={adding} onClose={() => setAdding(false)} nodeId={nodeId} />
    </section>
  );
}
