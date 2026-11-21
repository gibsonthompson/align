'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card" style={{ marginTop: 40 }}>
      <div className="empty">
        <div className="empty-icon" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
          <AlertTriangle size={26} strokeWidth={2.4} />
        </div>
        <h3>This Page Could Not Load</h3>
        <p>Nothing was lost. Try again, and if it keeps happening, check your connection.</p>
        <button className="btn primary" onClick={reset}>
          <RefreshCw size={17} /> Try Again
        </button>
      </div>
    </div>
  );
}
