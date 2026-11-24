'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { saveLifestyleAction } from '@/app/plan-actions';
import type { Lifestyle } from '@/lib/types';

// The life he is building overall, in his words, and what every plan must protect.
export default function LifestyleEditor({ lifestyle }: { lifestyle: Lifestyle }) {
  const router = useRouter();
  const [vision, setVision] = useState(lifestyle.vision);
  const [items, setItems] = useState(lifestyle.non_negotiables);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    if ((document.activeElement as HTMLElement | null)?.dataset?.field !== 'vision') setVision(lifestyle.vision);
    setItems(lifestyle.non_negotiables);
  }, [lifestyle.vision, lifestyle.non_negotiables]);

  function save(patch: { vision?: string; non_negotiables?: string[] }) {
    setError(null);
    start(async () => {
      const res = await saveLifestyleAction(patch);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function add() {
    const t = draft.trim();
    if (!t || items.includes(t)) return setDraft('');
    const next = [...items, t];
    setItems(next);
    setDraft('');
    save({ non_negotiables: next });
  }

  return (
    <div className="life-grid">
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">The Life You Are Building</h2>
          <span className="panel-note">Every goal serves this</span>
        </div>
        <div className="panel-body">
          <textarea
            data-field="vision"
            className="textarea life-vision"
            value={vision}
            maxLength={8000}
            placeholder="What an ordinary great week looks like a few years from now. Where you live, how your mornings go, who you spend time with, what work looks like, what you do for fun, how you feel."
            onChange={(e) => setVision(e.target.value)}
            onBlur={() => vision !== lifestyle.vision && save({ vision })}
          />
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">
            Non-Negotiables <span className="count">{items.length}</span>
          </h2>
          <span className="panel-note">No plan may take these</span>
        </div>
        <div className="panel-body">
          <div className="nn-list">
            {items.map((t) => (
              <span key={t} className="nn-chip">
                {t}
                <button
                  type="button"
                  aria-label={`Remove ${t}`}
                  onClick={() => {
                    const next = items.filter((x) => x !== t);
                    setItems(next);
                    save({ non_negotiables: next });
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {!items.length && <span className="dim">Sleep, family time, a day off, time outside. Whatever you will not trade away.</span>}
          </div>
          <form
            className="nn-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input className="input" value={draft} maxLength={200} placeholder="For example: 8 hours of sleep" onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="btn" disabled={!draft.trim()}>
              <Plus size={14} /> Add
            </button>
          </form>
          {error && <div className="inline-error">{error}</div>}
        </div>
      </section>
    </div>
  );
}
