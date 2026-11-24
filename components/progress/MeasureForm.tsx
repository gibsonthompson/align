'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createMeasure, updateMeasure, type MeasureInput } from '@/app/actions';
import type { Measure, Sector } from '@/lib/types';
import Sheet from '@/components/Sheet';
import Dropdown from '@/components/Dropdown';

type Form = {
  name: string;
  unit: string;
  kind: 'level' | 'total';
  direction: 'up' | 'down';
  period: 'week' | 'month' | 'all';
  start: string;
  target: string;
  date: string;
  sectorId: string;
};

const blank: Form = { name: '', unit: '', kind: 'level', direction: 'up', period: 'week', start: '', target: '', date: '', sectorId: '' };

// Add or edit a measure. On a page it belongs to that page; on Progress it can take a sector.
export default function MeasureForm({
  open,
  onClose,
  measure,
  nodeId,
  sectors,
}: {
  open: boolean;
  onClose: () => void;
  measure?: Measure | null;
  nodeId?: string | null;
  sectors?: Sector[];
}) {
  const router = useRouter();
  const [f, setF] = useState<Form>(blank);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(
      measure
        ? {
            name: measure.name,
            unit: measure.unit,
            kind: measure.kind,
            direction: measure.direction,
            period: measure.period,
            start: measure.start_value === null ? '' : String(measure.start_value),
            target: measure.target_value === null ? '' : String(measure.target_value),
            date: measure.target_date ?? '',
            sectorId: measure.sector_id ?? '',
          }
        : blank,
    );
  }, [open, measure]);

  const sectorOpts = useMemo(() => {
    const all = sectors ?? [];
    const tops = all.filter((s) => !s.parent_id);
    return [
      { value: '', label: 'No sector' },
      ...tops.flatMap((t) => [
        { value: t.id, label: t.name, group: t.name, colour: t.colour },
        ...all.filter((a) => a.parent_id === t.id).map((a) => ({ value: a.id, label: a.name, group: t.name, colour: t.colour })),
      ]),
    ];
  }, [sectors]);

  const set = (p: Partial<Form>) => setF((cur) => ({ ...cur, ...p }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[$,\s]/g, '')));

  async function save() {
    const start = num(f.start);
    const target = num(f.target);
    if ((start !== null && !Number.isFinite(start)) || (target !== null && !Number.isFinite(target))) return setError('Start and target have to be numbers.');
    const input: MeasureInput = {
      name: f.name,
      unit: f.unit,
      kind: f.kind,
      direction: f.direction,
      period: f.kind === 'total' ? f.period : 'all',
      start_value: f.kind === 'level' ? start : null,
      target_value: target,
      target_date: f.date || null,
      ...(nodeId !== undefined && !measure ? { nodeId } : {}),
      ...(!nodeId && !measure?.node_id ? { sectorId: f.sectorId || null } : {}),
    };
    setSaving(true);
    setError(null);
    const res = measure ? await updateMeasure(measure.id, input) : await createMeasure(input);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onClose();
    router.refresh();
  }

  return (
    <Sheet open={open} title={measure ? 'Edit Measure' : 'New Measure'} onClose={onClose}>
      <form
        className="bs"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="bs-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <label className="field">
            <span className="field-label">Name</span>
            <input data-autofocus className="input" value={f.name} maxLength={120} placeholder="Body weight, Miles run, Savings" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Unit</span>
            <input className="input" value={f.unit} maxLength={24} placeholder="lb, mi, $, songs" onChange={(e) => set({ unit: e.target.value })} />
          </label>
        </div>

        <div className="field">
          <span className="field-label">What kind of number</span>
          <div className="segmented">
            <button type="button" aria-pressed={f.kind === 'level'} onClick={() => set({ kind: 'level' })}>
              A Level (Latest Counts)
            </button>
            <button type="button" aria-pressed={f.kind === 'total'} onClick={() => set({ kind: 'total' })}>
              A Total (Adds Up)
            </button>
          </div>
          <span className="dim" style={{ fontSize: 12 }}>
            {f.kind === 'level' ? 'Weight, savings balance, mile pace: the newest entry is where you stand.' : 'Miles run, hours practiced, pages read: entries add up over the period.'}
          </span>
        </div>

        {f.kind === 'level' ? (
          <div className="field">
            <span className="field-label">Better is</span>
            <div className="segmented">
              <button type="button" aria-pressed={f.direction === 'up'} onClick={() => set({ direction: 'up' })}>
                Higher
              </button>
              <button type="button" aria-pressed={f.direction === 'down'} onClick={() => set({ direction: 'down' })}>
                Lower
              </button>
            </div>
          </div>
        ) : (
          <div className="field">
            <span className="field-label">Target per</span>
            <div className="segmented">
              <button type="button" aria-pressed={f.period === 'week'} onClick={() => set({ period: 'week' })}>
                Week
              </button>
              <button type="button" aria-pressed={f.period === 'month'} onClick={() => set({ period: 'month' })}>
                Month
              </button>
              <button type="button" aria-pressed={f.period === 'all'} onClick={() => set({ period: 'all' })}>
                All Time
              </button>
            </div>
          </div>
        )}

        <div className="bs-grid">
          {f.kind === 'level' ? (
            <label className="field">
              <span className="field-label">Starting at</span>
              <input className="input" inputMode="decimal" value={f.start} placeholder="Optional" onChange={(e) => set({ start: e.target.value })} />
            </label>
          ) : (
            <div className="field">
              <span className="field-label">Counts</span>
              <span className="dim" style={{ fontSize: 12.5, paddingTop: 8 }}>
                {f.period === 'all' ? 'Everything logged' : f.period === 'week' ? 'Monday to Sunday' : 'Calendar month'}
              </span>
            </div>
          )}
          <label className="field">
            <span className="field-label">Target</span>
            <input className="input" inputMode="decimal" value={f.target} placeholder="Optional" onChange={(e) => set({ target: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">By</span>
            <input type="date" className="input" value={f.date} onChange={(e) => set({ date: e.target.value })} style={{ colorScheme: 'dark' }} />
          </label>
        </div>

        {!nodeId && !measure?.node_id && sectors && (
          <div className="field">
            <span className="field-label">Sector</span>
            <Dropdown label="Sector" value={f.sectorId} options={sectorOpts} onChange={(v) => set({ sectorId: v })} />
          </div>
        )}

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="bs-foot">
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving && <Loader2 size={14} className="spin" />} {measure ? 'Save' : 'Add Measure'}
            </button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}
