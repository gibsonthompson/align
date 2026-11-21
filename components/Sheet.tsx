'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Bottom sheet on phones, centered card on desktop. Springs in, slides out.
export default function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      lastFocus.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = window.setTimeout(() => {
        setMounted(false);
        setClosing(false);
        lastFocus.current?.focus?.();
      }, 220);
      return () => window.clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      // Focus the first field if there is one, otherwise the panel.
      const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      (first ?? panelRef.current)?.focus();
    }, 60);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [mounted, requestClose]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className={`sheet-backdrop${closing ? ' closing' : ''}`} onClick={requestClose} aria-hidden />
      <div
        ref={panelRef}
        className={`sheet${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ outline: 'none' }}
      >
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={requestClose} aria-label="Close">
            <X size={19} strokeWidth={2.6} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}
