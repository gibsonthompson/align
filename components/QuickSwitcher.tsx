'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { CornerDownLeft, Loader2, Search } from 'lucide-react';
import { findObjects } from '@/app/actions';
import { hrefFor } from '@/lib/kinds';
import type { ObjectRef } from '@/lib/types';
import ObjectRow, { type SectorLookup } from '@/components/ObjectRow';
import { OPEN_SWITCHER } from '@/components/SearchButton';

// Jump to any page by name, from anywhere. Shows recently viewed before you type.
export default function QuickSwitcher({ sectors }: { sectors: SectorLookup }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ObjectRef[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
    setItems([]);
    setError(null);
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener(OPEN_SWITCHER, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_SWITCHER, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Close on navigation.
  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Search as you type, newest answer wins.
  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(
      async () => {
        const res = await findObjects(q);
        if (mine !== seq.current) return;
        setLoading(false);
        if (res.ok) {
          setItems(res.data ?? []);
          setError(null);
        } else {
          setItems([]);
          setError(res.error);
        }
        setActive(0);
      },
      q ? 140 : 0,
    );
    return () => window.clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function go(item: ObjectRef) {
    router.push(hrefFor(item));
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) go(items[active]);
      else if (q.trim()) {
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
        close();
      }
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="switcher-backdrop" onClick={close} aria-hidden />
      <div className="switcher" role="dialog" aria-modal="true" aria-label="Jump to any page" onKeyDown={onKeyDown}>
        <div className="switcher-input">
          {loading ? <Loader2 size={19} className="spin" style={{ color: 'var(--text-3)' }} /> : <Search size={19} style={{ color: 'var(--text-3)' }} />}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to any page"
            aria-label="Search everything"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="btn ghost" onClick={close}>
            Close
          </button>
        </div>
        <div className="switcher-list" ref={listRef} role="listbox">
          {!q && items.length > 0 && <div className="group-head">Recently Viewed</div>}
          {items.map((item, i) => (
            <div key={`${item.object_type}:${item.id}`} data-index={i} onMouseEnter={() => setActive(i)}>
              <ObjectRow item={item} sectors={sectors} active={i === active} asButton onClick={() => go(item)} />
            </div>
          ))}
          {error && <div className="switcher-empty" style={{ color: 'var(--red)' }}>{error}</div>}
          {!error && !loading && items.length === 0 && (
            <div className="switcher-empty">
              {q ? 'Nothing matches that yet.' : 'Pages you open show up here. Start typing to find anything.'}
            </div>
          )}
          {q.trim() && (
            <button
              type="button"
              className="row"
              onClick={() => {
                router.push(`/search?q=${encodeURIComponent(q.trim())}`);
                close();
              }}
            >
              <span className="row-icon" aria-hidden>
                <Search size={16} />
              </span>
              <span className="row-main">
                <span className="row-title" style={{ display: 'block' }}>
                  Search notes and pages for &ldquo;{q.trim()}&rdquo;
                </span>
              </span>
            </button>
          )}
        </div>
        <div className="switcher-foot">
          <span>↑↓ Move</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CornerDownLeft size={11} /> Open
          </span>
          <span>Esc Close</span>
        </div>
      </div>
    </>,
    document.body,
  );
}
