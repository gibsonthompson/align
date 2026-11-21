'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Gauge, Loader2, MoreHorizontal } from 'lucide-react';
import { archiveSector, updateSector } from '@/app/actions';
import { sectorIcon } from '@/lib/kinds';
import type { Sector } from '@/lib/types';
import Sheet from '@/components/Sheet';
import PinButton from '@/components/PinButton';

function Scale({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <div className="scale" role="group" aria-label={label}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          className={value !== null && n < value ? 'in' : undefined}
          onClick={() => onChange(value === n ? null : n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// The top of a sector or area: name, summary, and how it is rated right now.
export default function SectorHero({ sector, isArea, pinned, pages }: { sector: Sector; isArea: boolean; pinned: boolean; pages: number }) {
  const router = useRouter();
  const Icon = sectorIcon(sector.icon);
  const [name, setName] = useState(sector.name);
  const [summary, setSummary] = useState(sector.summary);
  const [ratings, setRatings] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  useEffect(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el?.dataset?.field !== 'name') setName(sector.name);
    if (el?.dataset?.field !== 'summary') setSummary(sector.summary);
  }, [sector.name, sector.summary]);

  async function save(patch: Parameters<typeof updateSector>[1]) {
    setError(null);
    const res = await updateSector(sector.id, patch);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  function archive() {
    startBusy(async () => {
      const res = await archiveSector(sector.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(res.data?.parentSlug ? `/s/${res.data.parentSlug}` : '/life');
    });
  }

  const rated = sector.importance || sector.satisfaction || sector.attention_needed || sector.mode;

  return (
    <section className="hero" style={{ ['--c' as string]: sector.colour }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <span className="hero-icon">
          <Icon size={26} strokeWidth={2.3} />
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <PinButton type="sector" id={sector.id} pinned={pinned} />
          {isArea && (
            <button type="button" className="icon-btn" onClick={() => setMenu(true)} aria-label="More options">
              <MoreHorizontal size={19} />
            </button>
          )}
        </div>
      </div>
      <div className="eyebrow" style={{ marginTop: 14 }}>
        {isArea ? 'Area' : 'Life Sector'}
        <span className="dim">
          · {pages} {pages === 1 ? 'page' : 'pages'}
        </span>
      </div>
      <textarea
        data-field="name"
        className="hero-title-input"
        value={name}
        rows={1}
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
      <div className="hero-meta">
        <button type="button" className="pill" onClick={() => setRatings(true)} style={{ cursor: 'pointer' }}>
          <Gauge size={14} />
          {rated ? 'Ratings' : 'Rate This Sector'}
        </button>
        {sector.mode && <span className="pill">{sector.mode === 'priority' ? 'Current Priority' : 'Maintain'}</span>}
      </div>
      {(sector.importance || sector.satisfaction || sector.attention_needed) && (
        <div className="ratings">
          {(
            [
              ['Importance', sector.importance],
              ['Satisfied', sector.satisfaction],
              ['Attention', sector.attention_needed],
            ] as const
          ).map(([label, v]) => (
            <button key={label} type="button" onClick={() => setRatings(true)} aria-label={`${label}: ${v ?? 'not rated'}. Edit ratings`}>
              <span className="l">{label}</span>
              <span className="v">
                {v ?? '-'}
                <small>/10</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="hero-body">
        <textarea
          data-field="summary"
          className="textarea bare"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => {
            if (summary !== sector.summary) save({ summary });
          }}
          placeholder="What this part of your life means to you, and what good looks like here."
          aria-label="Summary"
        />
      </div>
      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      <Sheet open={ratings} onClose={() => setRatings(false)} title="Where This Stands">
        <div style={{ ['--c' as string]: sector.colour }}>
          <div className="field">
            <span className="field-label">How Important Is This To You</span>
            <Scale label="Importance" value={sector.importance} onChange={(v) => save({ importance: v })} />
          </div>
          <div className="field">
            <span className="field-label">How Satisfied Are You Now</span>
            <Scale label="Satisfaction" value={sector.satisfaction} onChange={(v) => save({ satisfaction: v })} />
          </div>
          <div className="field">
            <span className="field-label">How Much Attention It Needs</span>
            <Scale label="Attention needed" value={sector.attention_needed} onChange={(v) => save({ attention_needed: v })} />
          </div>
          <div className="field" style={{ marginBottom: 4 }}>
            <span className="field-label">Right Now</span>
            <div className="segmented" role="group" aria-label="Priority or maintain">
              <button type="button" aria-pressed={sector.mode === 'priority'} onClick={() => save({ mode: sector.mode === 'priority' ? null : 'priority' })}>
                Current Priority
              </button>
              <button type="button" aria-pressed={sector.mode === 'maintain'} onClick={() => save({ mode: sector.mode === 'maintain' ? null : 'maintain' })}>
                Maintain
              </button>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 14, fontSize: 13.5, lineHeight: 1.5 }}>
            Ratings save as you tap. The full assessment, with current and desired state, arrives in the next phase and keeps its history year to year.
          </p>
          {error && (
            <div className="form-error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>
      </Sheet>

      {isArea && (
        <Sheet open={menu} onClose={() => setMenu(false)} title="Area Options">
          <p className="muted" style={{ lineHeight: 1.5, marginBottom: 14 }}>
            Archiving hides this area. Its pages stay where they are and still show up in search.
          </p>
          <button type="button" className="btn block danger" onClick={archive} disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <Archive size={18} />} Archive This Area
          </button>
          {error && (
            <div className="form-error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
        </Sheet>
      )}
    </section>
  );
}
