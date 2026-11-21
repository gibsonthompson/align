import Link from 'next/link';
import LogoMark from '@/components/LogoMark';

export default function NotFound() {
  return (
    <main className="lock">
      <div className="logo-mark" aria-hidden>
        <LogoMark size={44} />
      </div>
      <div className="lock-body" style={{ gap: 10, textAlign: 'center' }}>
        <h1>Page Not Found</h1>
        <p className="muted">That page does not exist, or it was archived.</p>
        <Link href="/" className="btn primary" style={{ marginTop: 12 }}>
          Go To Today
        </Link>
      </div>
    </main>
  );
}
