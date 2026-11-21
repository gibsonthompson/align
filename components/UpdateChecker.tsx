'use client';

import { useEffect, useState } from 'react';

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
const CHECK_EVERY_MS = 5 * 60 * 1000;

// Registers the service worker and checks for a newer deploy whenever the app
// comes back to the foreground, so the home screen app always picks up updates.
export default function UpdateChecker() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, { scope: '/' }).catch(() => {});
    }

    let stopped = false;
    async function check() {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (version && version !== 'dev' && BUILD_ID !== 'dev' && version !== BUILD_ID) setReady(true);
      } catch {
        // Offline or a blip. Try again next time.
      }
    }

    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (!ready) return null;

  return (
    <div className="toast" role="status">
      New Version Ready
      <button
        onClick={async () => {
          try {
            const regs = await navigator.serviceWorker?.getRegistrations();
            await Promise.all((regs ?? []).map((r) => r.update()));
          } catch {}
          window.location.reload();
        }}
      >
        Update
      </button>
    </div>
  );
}
