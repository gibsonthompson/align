'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pin } from 'lucide-react';
import { setPinned } from '@/app/actions';
import type { ObjectType } from '@/lib/types';

// Pinned pages sit on Today, one tap away however deep they are.
export default function PinButton({ type, id, pinned }: { type: ObjectType; id: string; pinned: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(pinned);
  const [error, setError] = useState(false);

  async function toggle() {
    const next = !on;
    setOn(next);
    setError(false);
    const res = await setPinned(type, id, next);
    if (!res.ok) {
      setOn(!next);
      setError(true);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      className={`icon-btn${on ? ' on' : ''}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Unpin from Today' : 'Pin to Today'}
      title={error ? 'Could not update the pin. Try again.' : on ? 'Pinned to Today' : 'Pin to Today'}
      style={error ? { outline: '2px solid var(--red)' } : undefined}
    >
      <Pin size={17} strokeWidth={2.5} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}
