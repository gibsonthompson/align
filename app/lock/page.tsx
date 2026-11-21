import type { Metadata } from 'next';
import { missingEnvNames, pinLength } from '@/lib/env';
import PinPad from '@/components/PinPad';
import LogoMark from '@/components/LogoMark';

export const metadata: Metadata = { title: 'Align' };
export const dynamic = 'force-dynamic';

export default async function LockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const missing = missingEnvNames();
  // Only return to a path inside the app.
  const target = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/lock') ? next : '/';

  return (
    <main className="lock">
      <div className="logo-mark" aria-hidden>
        <LogoMark size={44} />
      </div>
      {missing.length > 0 ? (
        <div className="lock-body">
          <h1>Finish Setup</h1>
          <div className="form-error" role="alert" style={{ marginTop: 18 }}>
            Add these in Vercel, then redeploy: {missing.join(', ')}
          </div>
        </div>
      ) : (
        <PinPad length={pinLength()} next={target} />
      )}
    </main>
  );
}
