'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { approveConnection, denyConnection, type AuthorizeParams } from '@/app/oauth/actions';

// The approval screen ChatGPT sends Gibson to. PIN in, then back to ChatGPT.
export default function ConnectApprove({ clientName, params }: { clientName: string; params: AuthorizeParams }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function approve() {
    setError(null);
    start(async () => {
      const res = await approveConnection(params, pin);
      if (!res.ok) {
        setError(res.error);
        setPin('');
        return;
      }
      window.location.replace(res.redirect);
    });
  }

  return (
    <div style={{ width: '100%', marginTop: 14 }}>
      <p className="muted" style={{ textAlign: 'center', lineHeight: 1.6 }}>
        {clientName} will be able to read your whole life map and create, edit, complete and link pages, add notes and save facts about you. Every change shows in each page&apos;s history.
      </p>
      <div className="panel" style={{ marginTop: 18 }}>
        {['Read sectors, pages, notes and what is due', 'Create and break down goals at any depth', 'Edit, complete, move and link pages', 'Add notes and facts the brain uses'].map((t) => (
          <div key={t} className="row" style={{ minHeight: 36 }}>
            <Check size={14} style={{ color: 'var(--green)', flex: 'none' }} />
            <span style={{ fontSize: 13 }}>{t}</span>
          </div>
        ))}
      </div>
      <form
        style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          approve();
        }}
      >
        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field-label">Your Align PIN</span>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
            aria-label="Align PIN"
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="btn-row">
          <button
            type="button"
            className="btn lg"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await denyConnection(params);
                if (res.redirect) window.location.replace(res.redirect);
                else setError('Cancelled. You can close this tab.');
              })
            }
          >
            Cancel
          </button>
          <button type="submit" className="btn primary lg" disabled={pending || pin.length < 4}>
            {pending && <Loader2 size={14} className="spin" />} Connect
          </button>
        </div>
      </form>
    </div>
  );
}
