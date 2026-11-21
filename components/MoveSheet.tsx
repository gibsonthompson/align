'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import { findObjects, moveNode } from '@/app/actions';
import type { AlignNode, ObjectRef, Sector } from '@/lib/types';
import Dropdown from '@/components/Dropdown';
import Sheet from '@/components/Sheet';
import ObjectRow, { type SectorLookup } from '@/components/ObjectRow';

// Move a page (and its whole branch) under another page, or to the top of a sector.
export default function MoveSheet({
  open,
  onClose,
  node,
  allSectors,
  sectors,
}: {
  open: boolean;
  onClose: () => void;
  node: AlignNode;
  allSectors: Sector[];
  sectors: SectorLookup;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'page' | 'sector'>('page');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ObjectRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [sectorId, setSectorId] = useState<string | null>(node.sector_id);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (open) {
      setQ('');
      setError(null);
      setSectorId(node.sector_id);
    }
  }, [open, node.sector_id]);

  useEffect(() => {
    if (!open || mode !== 'page') return;
    const mine = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(
      async () => {
        const res = await findObjects(q, ['node']);
        if (mine !== seq.current) return;
        setLoading(false);
        if (res.ok) setItems((res.data ?? []).filter((o) => o.id !== node.id && o.id !== node.parent_id));
        else setError(res.error);
      },
      q ? 140 : 0,
    );
    return () => window.clearTimeout(t);
  }, [q, open, mode, node.id, node.parent_id]);

  function go(target: { parentId?: string; sectorId?: string | null }) {
    setError(null);
    startSave(async () => {
      const res = await moveNode(node.id, target);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const sectorOptions = allSectors
    .filter((s) => !s.parent_id)
    .flatMap((top) => [
      { value: top.id, label: top.name, group: top.name, colour: top.colour, icon: <i className="status-dot" style={{ background: top.colour }} /> },
      ...allSectors
        .filter((a) => a.parent_id === top.id)
        .map((a) => ({ value: a.id, label: a.name, group: top.name, colour: a.colour, icon: <i className="status-dot" style={{ background: a.colour, opacity: 0.6 }} /> })),
    ]);

  return (
    <Sheet open={open} onClose={onClose} title="Move Page">
      <div className="segmented" role="group" aria-label="Move to" style={{ marginBottom: 14 }}>
        <button type="button" aria-pressed={mode === 'page'} onClick={() => setMode('page')}>
          Under A Page
        </button>
        <button type="button" aria-pressed={mode === 'sector'} onClick={() => setMode('sector')}>
          Top Of A Sector
        </button>
      </div>

      {mode === 'page' ? (
        <>
          <div className="field" style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-3)' }}>
              {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            </span>
            <input
              data-autofocus
              className="input"
              style={{ paddingLeft: 34 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find the new parent page"
              aria-label="Find the new parent page"
              autoComplete="off"
            />
          </div>
          <div className="panel">
            {items.length === 0 && !loading ? (
              <div className="switcher-empty">{q ? 'Nothing matches that yet.' : 'Start typing to find a page.'}</div>
            ) : (
              <div className="rows">
                {items.map((o) => (
                  <ObjectRow key={o.id} item={o} sectors={sectors} asButton onClick={() => go({ parentId: o.id })} />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <span className="field-label">Sector Or Area</span>
            <Dropdown label="Sector" value={sectorId} options={sectorOptions} onChange={setSectorId} placeholder="Choose a sector" />
          </div>
          <button type="button" className="btn primary block lg" disabled={!sectorId || saving} onClick={() => go({ sectorId })}>
            {saving && <Loader2 size={17} className="spin" />} Move Here
          </button>
        </>
      )}
      {saving && mode === 'page' && (
        <p className="muted" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Loader2 size={16} className="spin" /> Moving
        </p>
      )}
      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}
    </Sheet>
  );
}
