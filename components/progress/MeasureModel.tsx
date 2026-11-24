'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, Loader2, Plus, X } from 'lucide-react';
import { saveMeasureModel } from '@/app/plan-actions';
import { shortDate } from '@/lib/format';
import { CURVE_LABEL, fmtValue, MODEL_STATUS_LABEL } from '@/lib/habits';
import type { MeasureRow } from '@/lib/progress';
import type { MeasureCurve } from '@/lib/types';
import Sheet from '@/components/Sheet';

const CURVES: { v: MeasureCurve; hint: string }[] = [
  { v: 'linear', hint: 'The same amount every week' },
  { v: 'front_loaded', hint: 'Fast early, slower later (weight loss)' },
  { v: 'back_loaded', hint: 'Slow start that builds (a skill, an audience)' },
  { v: 'compound', hint: 'Grows by a percentage (savings, followers)' },
];
const SCEN = ['conservative', 'realistic', 'ambitious'] as const;
const statusTone = (s: string) => (s === 'done' || s === 'ahead' || s === 'on_track' ? ' good' : s === 'behind' ? ' soon' : s === 'off_track' ? ' late' : '');
const signed = (n: number, unit: string) => `${n > 0 ? '+' : ''}${fmtValue(Math.round(n * 100) / 100, unit)}`;

// The model behind a target: where it should be today, the real pace, where it lands.
export default function MeasureModel({ m }: { m: MeasureRow }) {
  const [open, setOpen] = useState(false);
  const md = m.model;
  if (!md) return null;
  const hasTarget = md.status !== 'no_target';

  return (
    <div className="mmodel">
      {hasTarget ? (
        <>
          <div className="mmodel-head">
            <span className={`tag${statusTone(md.status)}`}>{MODEL_STATUS_LABEL[md.status]}</span>
            {md.needsRecalc && <span className="tag late">Recalculate the plan</span>}
            <span className="dim">{CURVE_LABEL[md.curve]} curve</span>
            <button type="button" className="mcard-toggle" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}>
              <Calculator size={12} /> Plan Math
            </button>
          </div>
          {md.status !== 'done' && md.status !== 'no_data' && (
            <div className="mmodel-grid">
              <div>
                <span className="mcard-label">Should be today</span>
                <b className="mono">{md.expected === null ? 'None' : fmtValue(Math.round(md.expected * 100) / 100, m.unit)}</b>
              </div>
              <div>
                <span className="mcard-label">Recent pace</span>
                <b className="mono">{md.ratePerWeek === null ? 'Too few entries' : `${signed(md.ratePerWeek, m.unit)}/wk`}</b>
              </div>
              <div>
                <span className="mcard-label">Needed from here</span>
                <b className="mono">{md.requiredPerWeek === null ? 'None' : `${signed(md.requiredPerWeek, m.unit)}/wk`}</b>
              </div>
              <div>
                <span className="mcard-label">Lands by {md.targetDate ? shortDate(md.targetDate) : 'the date'}</span>
                <b className="mono">{md.projected === null ? 'Unknown' : fmtValue(Math.round(md.projected * 100) / 100, m.unit)}</b>
              </div>
            </div>
          )}
          {md.scenarios.length > 0 && (
            <div className="mmodel-scen">
              {md.scenarios.map((s) => (
                <span key={s.name} className={`tag${s.onPace === true ? ' good' : ''}`} title={s.note}>
                  {s.name[0].toUpperCase() + s.name.slice(1)} {s.value === null ? '' : fmtValue(s.value, m.unit)}
                  {s.onPace === true ? ', on pace' : ''}
                </span>
              ))}
            </div>
          )}
          {(m.assumptions?.length ?? 0) > 0 && (
            <ul className="mmodel-assume">
              {m.assumptions!.map((a, i) => (
                <li key={i} className={a.confirmed ? '' : 'dim'}>
                  {a.text}
                  {a.confirmed ? '' : ' (unconfirmed)'}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="mmodel-head">
          <span className="dim">Give it a target and date to track pace.</span>
          <button type="button" className="mcard-toggle" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}>
            <Calculator size={12} /> Plan Math
          </button>
        </div>
      )}
      <ModelSheet m={m} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function ModelSheet({ m, open, onClose }: { m: MeasureRow; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [curve, setCurve] = useState<MeasureCurve>(m.curve ?? 'linear');
  const [baseline, setBaseline] = useState(m.baseline_date ?? '');
  const [assume, setAssume] = useState(m.assumptions ?? []);
  const [draft, setDraft] = useState('');
  const [scen, setScen] = useState(() =>
    Object.fromEntries(SCEN.map((k) => [k, { value: m.scenarios?.[k]?.value === null || m.scenarios?.[k]?.value === undefined ? '' : String(m.scenarios[k]!.value), note: m.scenarios?.[k]?.note ?? '' }])),
  );
  const [method, setMethod] = useState(m.method ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save() {
    setError(null);
    const scenarios: Record<string, { value: number | null; note: string }> = {};
    for (const k of SCEN) {
      const v = scen[k];
      if (!v.value.trim() && !v.note.trim()) continue;
      const n = v.value.trim() === '' ? null : Number(v.value.replace(/[$,\s]/g, ''));
      if (n !== null && !Number.isFinite(n)) return setError(`The ${k} value is not a number.`);
      scenarios[k] = { value: n, note: v.note };
    }
    start(async () => {
      const res = await saveMeasureModel(m.id, { curve, baseline_date: baseline || null, assumptions: assume, scenarios, method });
      if (!res.ok) return setError(res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Plan Math: ${m.name}`}>
      <div className="field">
        <span className="field-label">How progress should build</span>
        <div className="rv-verdicts">
          {CURVES.map((c) => (
            <button key={c.v} type="button" className="rv-verdict" aria-pressed={curve === c.v} onClick={() => setCurve(c.v)}>
              <b>{CURVE_LABEL[c.v]}</b>
              <span>{c.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="field-label">Baseline date (when the start value was true)</span>
        <input type="date" className="input" value={baseline} style={{ colorScheme: 'dark', width: 170 }} onChange={(e) => setBaseline(e.target.value)} />
      </label>
      <div className="field" style={{ marginTop: 12 }}>
        <span className="field-label">Scenarios by the target date</span>
        <div className="mm-scen">
          {SCEN.map((k) => (
            <div key={k} className="mm-scen-row">
              <span>{k[0].toUpperCase() + k.slice(1)}</span>
              <input className="input" inputMode="decimal" value={scen[k].value} placeholder={m.unit || 'Value'} onChange={(e) => setScen({ ...scen, [k]: { ...scen[k], value: e.target.value } })} />
              <input className="input" value={scen[k].note} maxLength={400} placeholder="What has to be true" onChange={(e) => setScen({ ...scen, [k]: { ...scen[k], note: e.target.value } })} />
            </div>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <span className="field-label">Assumptions</span>
        {assume.map((a, i) => (
          <div key={i} className="mm-assume">
            <label className="rv-check" style={{ margin: 0 }}>
              <input type="checkbox" checked={a.confirmed} onChange={(e) => setAssume(assume.map((x, j) => (j === i ? { ...x, confirmed: e.target.checked } : x)))} />
              <span>{a.text}</span>
            </label>
            <button type="button" className="btn icon ghost" aria-label="Remove" onClick={() => setAssume(assume.filter((_, j) => j !== i))}>
              <X size={13} />
            </button>
          </div>
        ))}
        <form
          className="nn-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) setAssume([...assume, { text: draft.trim(), confirmed: false }]);
            setDraft('');
          }}
        >
          <input className="input" value={draft} maxLength={300} placeholder="For example: 3 runs a week without injury" onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="btn" disabled={!draft.trim()}>
            <Plus size={14} /> Add
          </button>
        </form>
        <span className="dim" style={{ fontSize: 12 }}>
          Ticked means confirmed.
        </span>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="field-label">The math</span>
        <textarea className="textarea" rows={4} value={method} maxLength={5000} placeholder="Variables, the required rate, allowances for missed weeks, compounding." onChange={(e) => setMethod(e.target.value)} />
      </label>
      {error && (
        <div className="form-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button type="button" className="btn lg" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn lg primary" onClick={save} disabled={busy}>
          {busy && <Loader2 size={14} className="spin" />} Save
        </button>
      </div>
    </Sheet>
  );
}
