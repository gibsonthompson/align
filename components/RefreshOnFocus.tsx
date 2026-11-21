'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const MIN_GAP_MS = 15_000;
const WHILE_OPEN_MS = 60_000;

// Keeps the phone and computer in step: when the app comes back to the
// foreground, and every minute while it is open, the page reloads its data.
// Nothing typed is lost, because only server data refreshes.
export default function RefreshOnFocus() {
  const router = useRouter();
  const last = useRef(Date.now());

  useEffect(() => {
    const refresh = (force = false) => {
      if (document.visibilityState !== 'visible') return;
      // Never refresh while he is typing.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!force && Date.now() - last.current < MIN_GAP_MS) return;
      last.current = Date.now();
      router.refresh();
    };
    const onVisible = () => refresh();
    const timer = window.setInterval(() => refresh(true), WHILE_OPEN_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [router]);

  return null;
}
