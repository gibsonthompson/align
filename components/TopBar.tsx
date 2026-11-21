import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import SearchButton from '@/components/SearchButton';

// Title on the left, search on the right. A back link when a page has a natural parent.
export default function TopBar({ title, back, children }: { title?: string; back?: string; children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        {back && (
          <Link href={back} className="icon-btn" aria-label="Back">
            <ChevronLeft size={21} strokeWidth={2.6} />
          </Link>
        )}
        {title && <h1>{title}</h1>}
      </div>
      <div className="topbar-actions">
        {children}
        <SearchButton />
      </div>
    </header>
  );
}
