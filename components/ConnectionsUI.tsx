'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Loader2 } from 'lucide-react';
import { disconnectClient } from '@/app/actions';
import Sheet from '@/components/Sheet';

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <label className="field" style={{ marginBottom: 0 }}>
      <span className="field-label">{label}</span>
      <span style={{ display: 'flex', gap: 8 }}>
        <input className="input mono" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <button
          type="button"
          className="btn"
          style={{ height: 34 }}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </span>
    </label>
  );
}

export function DisconnectButton({ clientId, name }: { clientId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <button type="button" className="btn danger" onClick={() => setOpen(true)}>
        Disconnect
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Disconnect ${name}`}>
        <p className="muted" style={{ lineHeight: 1.6, marginBottom: 16 }}>
          {name} loses access to Align right away. Everything it added stays. You can connect it again from ChatGPT any time.
        </p>
        {error && (
          <div className="form-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <div className="btn-row">
          <button type="button" className="btn lg" onClick={() => setOpen(false)}>
            Keep It
          </button>
          <button
            type="button"
            className="btn lg danger"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const res = await disconnectClient(clientId);
                if (!res.ok) return setError(res.error);
                setOpen(false);
                router.refresh();
              })
            }
          >
            {busy && <Loader2 size={14} className="spin" />} Disconnect
          </button>
        </div>
      </Sheet>
    </>
  );
}
