'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ChevronDown, Loader2, Pencil, TrendingDown, TrendingUp, X } from 'lucide-react';
import { deleteMeasureLog, logMeasure, updateMeasure } from '@/app/actions';
import { shortDate } from '@/lib/format';
import { fmtValue } from '@/lib/habits';
import type { MeasureRow } from '@/lib/progress';
import type { Sector } from '@/lib/types';
import type { SectorLookup } from '@/components/ObjectRow';
import MeasureChart from '@/components/progress/MeasureChart';
import MeasureForm from '@/components/progress/MeasureForm';
import MeasureModel from '@/components/progress/MeasureModel';

// One measure: where it stands, how far toward the target, its chart, and a quick log.
export default function MeasureCard({ m, today, sectors, allSectors, showPage = true }: { m: MeasureRow; today: string; sectors: SectorLookup; allSectors?: Sector[]; showPage?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const s = m.stat;
  const colour = m.sector_id ? (sectors[m.sector_id]?.colour ?? '#8a8a8a') : '#8a8a8a';
  const Trend = m.direction === 'down' ? TrendingDown : TrendingUp;
  const good = s.change === null ? null : m.direction === 'up' ? s.change >= 0 : s.change <= 0;

  function log() {
    const v = Number(value.replace(/[$,\s]/g, ''));
    if (value.trim() === '' || !Number.isFinite(v)) return setError('Enter a number.');
    setError(null);
    start(async () => {
      const res = await logMeasure(m.id, day, v, note);
      if (!res.ok) return setError(res.error);
      setValue('');
      setNote('');
      router.refresh();
    });
  }

  const recent = [...m.logs].sort((a, b) => b.day.localeCompare(a.day) || b.created_at.localeCompare(a.created_at)).slice(0, 10);

  return (
    <section className="panel mcard" style={{ ['--c' as string]: colour }}>
      <div className="panel-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="swatch" aria-hidden />
            <span className="mcard-name">{m.name}</span>
          </h3>
          {showPage && m.node && (
            <Link href={`/n/${m.node.id}`} className="mcard-page">
              {m.node.title}
            </Link>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="btn icon ghost" style={{ width: 28, height: 28 }} onClick={() => setEditing(true)} aria-label={`Edit ${m.name}`} title="Edit">
            <Pencil size={13} />
          </button>
          <button type="button" className="btn icon ghost" style={{ width: 28, height: 28 }} onClick={() => setConfirmArchive((v) => !v)} aria-label={`Archive ${m.name}`} title="Archive">
            <Archive size={13} />
          </button>
        </div>
      </div>

      {confirmArchive && (
        <div className="panel-body mcard-confirm">
          <span>Archive this measure? Its entries are kept.</span>
          <button
            type="button"
            className="btn danger"
            onClick={() =>
              start(async () => {
                const res = await updateMeasure(m.id, { archived: true });
                if (!res.ok) setError(res.error);
                else router.refresh();
              })
            }
          >
            Archive
          </button>
        </div>
      )}

      <div className="mcard-top">
        <div>
          <div className="mcard-label">{s.periodLabel}</div>
          <div className="mcard-value">{fmtValue(s.current, m.unit)}</div>
          {s.latestDay && m.kind === 'level' && <div className="mcard-label">on {shortDate(s.latestDay)}</div>}
        </div>
        <div className="mcard-side">
          {m.target_value !== null && (
            <div>
              <div className="mcard-label">Target{m.target_date ? ` by ${shortDate(m.target_date)}` : ''}</div>
              <div className="mcard-target">{fmtValue(m.target_value, m.unit)}</div>
            </div>
          )}
          {s.change !== null && (
            <span className={`tag${good ? ' good' : good === false ? ' late' : ''}`} title="Change since the start">
              <Trend size={10} /> {s.change > 0 ? '+' : ''}
              {fmtValue(s.change, m.unit)}
            </span>
          )}
        </div>
      </div>

      {s.progress !== null && (
        <div className="mcard-progress">
          <div className="mcard-bar">
            <i style={{ width: `${Math.round(s.progress * 100)}%` }} />
          </div>
          <span className="mono" style={{ fontSize: 11 }}>
            {Math.round(s.progress * 100)}%
          </span>
          {s.onTrack !== null && !(m.model && m.model.status !== 'no_target') && <span className={`tag${s.onTrack ? ' good' : ' soon'}`}>{s.progress >= 1 ? 'Hit' : s.onTrack ? 'On track' : 'Behind'}</span>}
        </div>
      )}
      <MeasureModel m={m} />

      <div className="mcard-chart">
        <MeasureChart m={m} logs={m.logs} today={today} />
      </div>

      <form
        className="mcard-log"
        onSubmit={(e) => {
          e.preventDefault();
          log();
        }}
      >
        <div className="mcard-input">
          <input className="input" inputMode="decimal" value={value} placeholder="Value" aria-label={`New ${m.name} value`} onChange={(e) => setValue(e.target.value)} />
          {m.unit && <span className="dim">{m.unit}</span>}
        </div>
        <input type="date" className="input" value={day} max={today} aria-label="Day" onChange={(e) => setDay(e.target.value || today)} style={{ colorScheme: 'dark' }} />
        <button type="submit" className="btn primary" disabled={busy}>
          {busy && <Loader2 size={14} className="spin" />} Log
        </button>
        <input className="input mcard-note" value={note} maxLength={2000} placeholder="Note (optional)" aria-label="Note" onChange={(e) => setNote(e.target.value)} />
      </form>
      {error && <div className="inline-error">{error}</div>}

      {m.logs.length > 0 && (
        <div className="mcard-entries">
          <button type="button" className="mcard-toggle" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
            <ChevronDown size={13} style={{ transform: showLog ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
            {m.logs.length} {m.logs.length === 1 ? 'entry' : 'entries'}
          </button>
          {showLog &&
            recent.map((l) => (
              <div key={l.id} className="mcard-entry">
                <span className="mono dim">{shortDate(l.day)}</span>
                <b>{fmtValue(l.value, m.unit)}</b>
                <span className="dim mcard-entry-note">{l.note}</span>
                <button
                  type="button"
                  className="btn icon ghost"
                  style={{ width: 24, height: 24 }}
                  aria-label="Remove this entry"
                  onClick={() =>
                    start(async () => {
                      const res = await deleteMeasureLog(l.id);
                      if (!res.ok) setError(res.error);
                      else router.refresh();
                    })
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
        </div>
      )}

      <MeasureForm open={editing} onClose={() => setEditing(false)} measure={m} sectors={allSectors} />
    </section>
  );
}
