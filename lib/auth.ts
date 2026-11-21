import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

// Every server read and write calls this first. No valid PIN session, no data.
export async function requireSession(): Promise<void> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session.valid) redirect('/lock');
}

// For server actions: returns false instead of redirecting, so the action can answer cleanly.
export async function hasSession(): Promise<boolean> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  return session.valid;
}
