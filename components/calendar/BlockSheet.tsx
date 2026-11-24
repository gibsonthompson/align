'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Link2, Loader2, Search, Trash2, X } from 'lucide-react';
import { findObjects } from '@/app/actions';
import { clock, duration } from '@/lib/tz';
import { kindIcon, kindLabel } from '@/lib/kinds';
import type { BlockStatus, ObjectRef, Sector } from '@/lib/types';
import Sheet from '@/components/Sheet';
import Dropdown from '@/components/Dropdown';
import { DAY_MIN, longDate, SNAP, type Draft } from '@/components/calendar/shared';

const LENGTHS = [15, 30, 45, 60, 90, 120];
const STATUSES: { value: BlockStatus; label: string }[] = [
  { value: 'planned', label: 'Planned' },
  { value: 'done', label: 'Done' },
  { value: 'skipped', label: 'Skipped' },
];

export default function BlockSheet({
  draft,
  sectors,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft | null;
  sectors: Sector[];
  onClose: () => void;
  onSave: (d: Draft) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
}) {
  const [d, setD] = useState<Draft | null>(draft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (draft) {
      setD(draft);
      setError(null);
      setConfirmDelete(false);
      setLinking(false);
    }
  }, [draft]);

  const startOpts = useMemo(() => Array.from({ length: DAY_MIN / SNAP }, (_, i) => ({ value: String(i * SNAP), label: clock(i * SNAP) })), []);
  const endOpts = useMemo(() => {
    if (!d) return [];
    const out = [];
    for (let m = d.start + SNAP; m <= DAY_MIN; m += SNAP) out.push({ value: String(m), label: `${m === DAY_MIN ? 'Midnight' : clock(m)} (${duration(m - d.start)})` });
    return out;
  }, [d]);

  const sectorOpts = useMemo(() => {
    const tops = sectors.filter((s) => !s.parent_id);
    return [
      { value: '', label: 'No sector' },
      ...tops.flatMap((t) => [
        { value: t.id, label: t.name, group: t.name, colour: t.colour },
        ...sectors.filter((a) => a.parent_id === t.id).map((a) => ({ value: a.id, label: a.name, group: t.name, colour: t.colour })),
      ]),
    ];
  }, [sectors]);

  if (!d) return <Sheet open={false} title="" onClose={onClose} children={null} />;
  const set = (patch: Partial<Draft>) => setD((cur) => (cur ? { ...cur, ...patch } : cur));
  const len = d.end - d.start;

  async function save() {
    if (!d) return;
    if (!d.nodeId && !d.title.trim()) return setError('Give it a title or link it to a page.');
    setSaving(true);
    setError(null);
    const e = await onSave(d);
    setSaving(false);
    if (e) setError(e);
  }

  async function remove() {
    if (!d?.id) return;
    setDeleting(true);
    const e = await onDelete(d.id);
    setDeleting(false);
    if (e) setError(e);
  }

  return (
    <Sheet open={Boolean(draft)} title={d.id ? 'Edit Block' : 'New Block'} onClose={onClose}>
      <form
        className="bs"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <label className="field">
          <span className="field-label">Title</span>
          <input
            data-autofocus
            className="input"
            value={d.title}
            maxLength={300}
            placeholder={d.nodeTitle ? d.nodeTitle : 'What is this time for?'}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>

        <div className="field">
          <span className="field-label">Page</span>
          {d.nodeId ? (
            <div className="bs-link">
              {(() => {
                const Icon = kindIcon({ object_type: 'node', kind: d.nodeType ?? 'action' });
                return <Icon size={14} />;
              })()}
              <span className="bs-link-title">{d.nodeTitle}</span>
              <span className="dim" style={{ fontSize: 12 }}>
                {kindLabel({ object_type: 'node', kind: d.nodeType ?? 'action' })}
              </span>
              <Link href={`/n/${d.nodeId}`} className="btn icon ghost" style={{ width: 26, height: 26 }} aria-label="Open the page">
                <ExternalLink size={13} />
              </Link>
              <button type="button" className="btn icon ghost" style={{ width: 26, height: 26 }} onClick={() => set({ nodeId: null, nodeTitle: undefined, nodeType: undefined, title: d.title || d.nodeTitle || '' })} aria-label="Unlink the page">
                <X size={13} />
              </button>
            </div>
          ) : linking ? (
            <PagePicker
              onPick={(o) => {
                set({ nodeId: o.id, nodeTitle: o.title, nodeType: o.kind });
                setLinking(false);
              }}
              onCancel={() => setLinking(false)}
            />
          ) : (
            <div className="bs-unlinked">
              <button type="button" className="btn" onClick={() => setLinking(true)}>
                <Link2 size={14} /> Link to a page
              </button>
              <Dropdown label="Sector" value={d.sectorId ?? ''} options={sectorOpts} placeholder="Sector" onChange={(v) => set({ sectorId: v || null })} />
            </div>
          )}
          {!d.nodeId && !linking && <span className="dim" style={{ fontSize: 12 }}>Standalone time, like a meeting or an errand. Pick a sector so it counts toward the right part of your life.</span>}
        </div>

        <div className="bs-grid">
          <label className="field">
            <span className="field-label">Day</span>
            <input type="date" className="input" value={d.date} onChange={(e) => e.target.value && set({ date: e.target.value })} style={{ colorScheme: 'dark' }} />
          </label>
          <div className="field">
            <span className="field-label">Starts</span>
            <Dropdown
              label="Start time"
              value={String(d.start)}
              options={startOpts}
              onChange={(v) => {
                const s = Number(v);
                set({ start: s, end: Math.min(s + len, DAY_MIN) });
              }}
            />
          </div>
          <div className="field">
            <span className="field-label">Ends</span>
            <Dropdown label="End time" value={String(d.end)} options={endOpts} onChange={(v) => set({ end: Number(v) })} />
          </div>
        </div>

        <div className="bs-lengths">
          {LENGTHS.map((m) => (
            <button key={m} type="button" className="tag" data-on={len === m} disabled={d.start + m > DAY_MIN} onClick={() => set({ end: d.start + m })}>
              {duration(m)}
            </button>
          ))}
          <span className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {longDate(d.date)}
          </span>
        </div>

        {d.id && (
          <div className="field">
            <span className="field-label">Status</span>
            <div className="segmented">
              {STATUSES.map((s) => (
                <button key={s.value} type="button" aria-pressed={d.status === s.value} onClick={() => set({ status: s.value })}>
                  {s.label}
                </button>
              ))}
            </div>
            {d.status === 'done' && d.nodeId && (d.nodeType === 'action' || d.nodeType === 'task') && <span className="dim" style={{ fontSize: 12 }}>Marking this done also marks the page done.</span>}
          </div>
        )}

        <label className="field">
          <span className="field-label">Notes</span>
          <textarea className="textarea" rows={3} value={d.notes} maxLength={5000} placeholder="Anything to remember for this time" onChange={(e) => set({ notes: e.target.value })} />
        </label>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        <div className="bs-foot">
          {d.id &&
            (confirmDelete ? (
              <button type="button" className="btn danger" onClick={remove} disabled={deleting}>
                {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Remove It
              </button>
            ) : (
              <button type="button" className="btn ghost danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Remove
              </button>
            ))}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving && <Loader2 size={14} className="spin" />} {d.id ? 'Save' : 'Add To Calendar'}
            </button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}

function PagePicker({ onPick, onCancel }: { onPick: (o: ObjectRef) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ObjectRef[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const res = await findObjects(q, ['node']);
      if (n !== seq.current) return;
      setLoading(false);
      setResults(res.ok ? (res.data ?? []).filter((o) => o.object_type === 'node') : []);
    }, 180);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <div className="bs-picker">
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
        <input
          className="input"
          style={{ paddingLeft: 30 }}
          autoFocus
          value={q}
          placeholder="Search your pages"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onCancel();
            }
          }}
        />
      </div>
      <div className="bs-results">
        {loading && !results.length ? (
          <div className="dim" style={{ padding: 10, fontSize: 12.5 }}>
            Searching
          </div>
        ) : results.length ? (
          results.slice(0, 8).map((o) => {
            const Icon = kindIcon(o);
            return (
              <button key={o.id} type="button" className="bs-result" onClick={() => onPick(o)}>
                <Icon size={14} />
                <span className="bs-link-title">{o.title}</span>
                <span className="dim" style={{ fontSize: 11.5 }}>
                  {kindLabel(o)}
                </span>
              </button>
            );
          })
        ) : (
          <div className="dim" style={{ padding: 10, fontSize: 12.5 }}>
            {q ? 'No pages match.' : 'Type to search.'}
          </div>
        )}
      </div>
    </div>
  );
}
