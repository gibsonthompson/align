'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
  group?: string;
  icon?: React.ReactNode;
  colour?: string;
}

// Custom themed dropdown. Never a native select.
export default function Dropdown({
  value,
  options,
  onChange,
  placeholder = 'Choose',
  label,
  variant = 'field',
  disabled = false,
}: {
  value: string | null;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  variant?: 'field' | 'compact' | 'pill';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const selected = options.find((o) => o.value === value) ?? null;

  const grouped = useMemo(() => {
    const out: { group: string | null; items: { opt: DropdownOption; index: number }[] }[] = [];
    options.forEach((opt, index) => {
      const g = opt.group ?? null;
      let bucket = out.find((b) => b.group === g);
      if (!bucket) {
        bucket = { group: g, items: [] };
        out.push(bucket);
      }
      bucket.items.push({ opt, index });
    });
    return out;
  }, [options]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  // The menu lives in a portal with fixed positioning so a scrolling sheet never clips it.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const spaceBelow = vh - r.bottom;
      const goUp = spaceBelow < 300 && r.top > spaceBelow;
      const width = Math.max(r.width, 220);
      const left = Math.min(Math.max(12, r.left), Math.max(12, vw - width - 12));
      setPos({
        position: 'fixed',
        left,
        minWidth: Math.max(r.width, 220),
        maxHeight: Math.min(340, (goUp ? r.top : spaceBelow) - 20),
        ...(goUp ? { bottom: vh - r.top + 6 } : { top: r.bottom + 6 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(v: string) {
    if (v !== value) onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = options[active];
      if (opt) choose(opt.value);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const triggerClass = variant === 'compact' ? 'dd-trigger compact' : variant === 'pill' ? 'dd-trigger pill-like' : 'dd-trigger';

  return (
    <div className="dd" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${selected?.label ?? placeholder}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {selected?.icon && <span style={{ display: 'inline-flex', color: selected.colour }}>{selected.icon}</span>}
        <span className={`dd-value${selected ? '' : ' placeholder'}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={variant === 'field' ? 18 : 15} strokeWidth={2.6} style={{ opacity: 0.6, flex: 'none' }} />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div ref={listRef} id={`${id}-list`} role="listbox" aria-label={label} className="dd-menu" style={pos} onKeyDown={onKeyDown}>
            {grouped.map((g) => (
              <div key={g.group ?? 'all'} role="group" aria-label={g.group ?? undefined}>
                {g.group && <div className="dd-group">{g.group}</div>}
                {g.items.map(({ opt, index }) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={opt.value === value}
                    data-active={index === active}
                    data-index={index}
                    className="dd-option"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(opt.value)}
                  >
                    {opt.icon && (
                      <span className="opt-icon" style={opt.colour ? { color: opt.colour } : undefined}>
                        {opt.icon}
                      </span>
                    )}
                    <span style={{ flex: 1 }}>{opt.label}</span>
                    {opt.value === value && <Check size={16} strokeWidth={3} />}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
