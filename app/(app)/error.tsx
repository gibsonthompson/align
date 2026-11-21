'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="content narrow">
      <div className="panel empty big">
        <div className="empty-icon" style={{ color: 'var(--red)' }}>
          <AlertTriangle size={18} />
        </div>
        <h3>This Page Could Not Load</h3>
        <p>Nothing was lost. Try again, and if it keeps happening, check your connection.</p>
        <button className="btn primary lg" onClick={reset}>
          <RefreshCw size={14} /> Try Again
        </button>
      </div>
    </div>
  );
}
