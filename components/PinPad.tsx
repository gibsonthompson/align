'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Delete } from 'lucide-react';
import { unlock } from '@/app/actions';

// PIN screen: dots fill as you tap, checks on the last digit.
export default function PinPad({ length, next }: { length: number; next: string }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [shake, setShake] = useState(false);
  const [pending, startTransition] = useTransition();
  const pinRef = useRef('');
  pinRef.current = pin;

  const submit = useCallback(
    (value: string) => {
      startTransition(async () => {
        const res = await unlock(value);
        if (res.ok) {
          window.location.replace(next);
          return;
        }
        setError(res.error);
        if (res.lockedForMinutes) {
          setLocked(true);
          window.setTimeout(() => {
            setLocked(false);
            setError(null);
          }, res.lockedForMinutes * 60_000);
        }
        setShake(true);
        if ('vibrate' in navigator) navigator.vibrate?.(180);
        window.setTimeout(() => {
          setShake(false);
          setPin('');
        }, 420);
      });
    },
    [next],
  );

  const press = useCallback(
    (key: string) => {
      if (pending || locked) return;
      const v = pinRef.current;
      if (key === 'back') {
        setPin(v.slice(0, -1));
        return;
      }
      if (v.length >= length) return;
      const nv = v + key;
      setPin(nv);
      setError(null);
      if (nv.length === length) submit(nv);
    },
    [length, locked, pending, submit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div className="lock-body">
      <h1>Enter Your PIN</h1>
      <div className={`pin-dots${shake ? ' shake' : ''}`} aria-label={`${pin.length} of ${length} digits entered`} role="status">
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`pin-dot${i < pin.length ? ' filled' : ''}`} />
        ))}
      </div>
      <p className={`pin-msg${error ? ' error' : ''}`} aria-live="assertive">
        {error ?? (pending ? 'Checking' : ' ')}
      </p>
      <div className="pin-keys" role="group" aria-label="PIN keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" className="pad-key" onClick={() => press(k)} disabled={locked}>
            {k}
          </button>
        ))}
        <span aria-hidden />
        <button type="button" className="pad-key" onClick={() => press('0')} disabled={locked}>
          0
        </button>
        <button type="button" className="pad-key" onClick={() => press('back')} aria-label="Delete" disabled={locked}>
          <Delete size={25} strokeWidth={2.3} />
        </button>
      </div>
    </div>
  );
}
