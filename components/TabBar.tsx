'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Images, NotebookPen, Orbit, Sun } from 'lucide-react';

const TABS = [
  { href: '/', label: 'Today', Icon: Sun, match: (p: string) => p === '/' || p.startsWith('/search') },
  { href: '/life', label: 'Life', Icon: Orbit, match: (p: string) => p.startsWith('/life') || p.startsWith('/s/') || p.startsWith('/n/') },
  { href: '/calendar', label: 'Calendar', Icon: CalendarDays, match: (p: string) => p.startsWith('/calendar') },
  { href: '/vision', label: 'Vision', Icon: Images, match: (p: string) => p.startsWith('/vision') },
  { href: '/reviews', label: 'Reviews', Icon: NotebookPen, match: (p: string) => p.startsWith('/reviews') },
];

export default function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-inner">
        {TABS.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link key={href} href={href} className="tab" aria-current={active ? 'page' : undefined}>
              <Icon size={23} strokeWidth={active ? 2.7 : 2.2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
