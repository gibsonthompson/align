'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Loader2, Pin } from 'lucide-react';
import { archiveSector, setPinned, updateSector } from '@/app/actions';
import type { Sector } from '@/lib/types';
import Sheet from '@/components/Sheet';

function useSave(id: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function save(patch: Parameters<typeof updateSector>[1]) {
    setError(null);
    const res = await updateSector(id, patch);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }
  return { save, error };
}

// Name and summary of a sector or area, edited in place.
export function SectorTitle({ sector, isArea, pages }: { sector: Sector; isArea: boolean; pages: number }) {
  const { save, error } = useSave(sector.id);
  const [name, setName] = useState(sector.name);
  const [summary, setSummary] = useState(sector.summary);

  useEffect(() => {
    const f = (document.activeElement as HTMLElement | null)?.dataset?.field;
    if (f !== 'name') setName(sector.name);
    if (f !== 'summary') setSummary(sector.summary);
  }, [sector.name, sector.summary]);

  return (
    <div className="page-title-block" style={{ ['--c' as string]: sector.colour }}>
      <div className="eyebrow">
        <i className="swatch" aria-hidden />
        <b>{isArea ? 'Area' : 'Life Sector'}</b>
        <span>
          {pages} {pages === 1 ? 'page' : 'pages'}
        </span>
        {sector.mode && <span className="tag">{sector.mode === 'priority' ? 'Current Priority' : 'Maintain'}</span>}
      </div>
      <textarea
        data-field="name"
        className="title-input"
        rows={1}
        value={name}
        maxLength={80}
        aria-label="Name"
        onChange={(e) => setName(e.target.value.replace(/\n/g, ' '))}
        onBlur={() => {
          const n = name.trim();
          if (!n) setName(sector.name);
          else if (n !== sector.name) save({ name: n });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
      <textarea
        data-field="summary"
        className="desc-input"
        value={summary}
        aria-label="Summary"
        placeholder="What this part of your life means to you, and what good looks like here."
        onChange={(e) => setSummary(e.target.value)}
        onBlur={() => summary !== sector.summary && save({ summary })}
      />
      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function Scale({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <div className="scale" role="group" aria-label={label}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" aria-pressed={value === n} className={value !== null && n < value ? 'in' : undefined} onClick={() => onChange(value === n ? null : n)}>
          {n}
        </button>
      ))}
    </div>
  );
}

// Where the sector stands: importance, satisfaction, attention, priority or maintain.
export function SectorProperties({ sector, isArea, pinned }: { sector: Sector; isArea: boolean; pinned: boolean }) {
  const router = useRouter();
  const { save, error } = useSave(sector.id);
  const [pin, setPin] = useState(pinned);
  const [confirm, setConfirm] = useState(false);
  const [busy, startBusy] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => setPin(pinned), [pinned]);

  async function togglePin() {
    const next = !pin;
    setPin(next);
    const res = await setPinned('sector', sector.id, next);
    if (!res.ok) {
      setPin(!next);
      setLocalError(res.error);
    } else router.refresh();
  }

  function archive() {
    startBusy(async () => {
      const res = await archiveSector(sector.id);
      if (!res.ok) return setLocalError(res.error);
      router.push(res.data?.parentSlug ? `/s/${res.data.parentSlug}` : '/life');
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Where It Stands</h2>
        <button type="button" className={`btn icon${pin ? ' on' : ''}`} onClick={togglePin} aria-pressed={pin} aria-label={pin ? 'Unpin' : 'Pin'} title={pin ? 'Pinned' : 'Pin'}>
          <Pin size={14} fill={pin ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="props">
        <div className="prop stack">
          <span className="prop-label">How important is this to you</span>
          <Scale label="Importance" value={sector.importance} onChange={(v) => save({ importance: v })} />
        </div>
        <div className="prop stack">
          <span className="prop-label">How satisfied are you now</span>
          <Scale label="Satisfaction" value={sector.satisfaction} onChange={(v) => save({ satisfaction: v })} />
        </div>
        <div className="prop stack">
          <span className="prop-label">How much attention it needs</span>
          <Scale label="Attention needed" value={sector.attention_needed} onChange={(v) => save({ attention_needed: v })} />
        </div>
        <div className="prop stack">
          <span className="prop-label">Right now</span>
          <div className="segmented" role="group" aria-label="Priority or maintain">
            <button type="button" aria-pressed={sector.mode === 'priority'} onClick={() => save({ mode: sector.mode === 'priority' ? null : 'priority' })}>
              Current Priority
            </button>
            <button type="button" aria-pressed={sector.mode === 'maintain'} onClick={() => save({ mode: sector.mode === 'maintain' ? null : 'maintain' })}>
              Maintain
            </button>
          </div>
        </div>
      </div>
      {isArea && (
        <div className="panel-body" style={{ borderTop: '1px solid var(--line)' }}>
          <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
            <Archive size={14} /> Archive Area
          </button>
        </div>
      )}
      {(error || localError) && <div className="inline-error" role="alert">{error ?? localError}</div>}
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Archive This Area">
        <p className="muted" style={{ lineHeight: 1.6, marginBottom: 16 }}>
          The area is hidden. Its pages stay where they are and still show up in search.
        </p>
        <div className="btn-row">
          <button type="button" className="btn lg" onClick={() => setConfirm(false)}>
            Keep It
          </button>
          <button type="button" className="btn lg danger" onClick={archive} disabled={busy}>
            {busy && <Loader2 size={14} className="spin" />} Archive
          </button>
        </div>
      </Sheet>
    </section>
  );
}
