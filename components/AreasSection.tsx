'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { createArea } from '@/app/actions';
import type { Sector } from '@/lib/types';

// The subcategories of a sector, each its own page. Add your own.
export default function AreasSection({ sector, areas }: { sector: Sector; areas: (Sector & { pages: number })[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function save() {
    if (!name.trim()) return;
    setError(null);
    startSave(async () => {
      const res = await createArea(sector.id, name);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName('');
      setAdding(false);
      router.refresh();
    });
  }

  return (
    <section className="panel" style={{ ['--c' as string]: sector.colour }}>
      <div className="panel-head">
        <h2 className="panel-title">
          Areas
          <span className="count">{areas.length}</span>
        </h2>
        <button type="button" className={`btn${adding ? '' : ' ghost'}`} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          {adding ? 'Cancel' : (
            <>
              <Plus size={15} strokeWidth={2.8} /> Add Area
            </>
          )}
        </button>
      </div>
      <div className="panel-body">
      {areas.length > 0 && (
        <div className="bal">
          {areas.map((a) => (
            <Link key={a.id} href={`/s/${a.slug}`} className="tile">
              <i className="swatch" aria-hidden />
              <span className="name">{a.name}</span>
              <span className="n">{a.pages}</span>
            </Link>
          ))}
        </div>
      )}
      {areas.length === 0 && !adding && <p className="dim" style={{ fontSize: 13 }}>No areas yet. Add one to split this sector up.</p>}
      {adding && (
        <form
          style={{ display: 'flex', gap: 8, marginTop: areas.length ? 12 : 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name the area"
            aria-label="New area name"
            maxLength={80}
            autoFocus
          />
          <button type="submit" className="btn primary" disabled={saving || !name.trim()}>
            {saving && <Loader2 size={16} className="spin" />} Add
          </button>
        </form>
      )}
      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      </div>
    </section>
  );
}
