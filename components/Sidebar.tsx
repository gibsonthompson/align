'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, CalendarDays, ChevronRight, Images, Inbox, NotebookPen, Orbit, Pin, Plug, Search, Sun } from 'lucide-react';
import { NODE_KINDS } from '@/lib/kinds';
import type { NodeType, ObjectRef, Sector } from '@/lib/types';
import LogoMark from '@/components/LogoMark';
import { openSwitcher } from '@/components/SearchButton';

export const TOGGLE_SIDEBAR = 'align:toggle-sidebar';

export interface SidebarRoot {
  id: string;
  title: string;
  type: NodeType;
  sector_id: string;
  status: string;
}

const NAV = [
  { href: '/', label: 'Today', Icon: Sun },
  { href: '/life', label: 'Life', Icon: Orbit },
  { href: '/search?status=inbox', label: 'Inbox', Icon: Inbox, key: 'inbox' },
  { href: '/calendar', label: 'Calendar', Icon: CalendarDays },
  { href: '/progress', label: 'Progress', Icon: Activity },
  { href: '/vision', label: 'Vision', Icon: Images },
  { href: '/reviews', label: 'Reviews', Icon: NotebookPen },
  { href: '/connections', label: 'Connections', Icon: Plug },
];

const OPEN_KEY = 'align.sidebar.open';

// The whole life map, always one click away: sectors, their areas and top pages.
export default function Sidebar({
  sectors,
  roots,
  pinned,
  inbox,
}: {
  sectors: Sector[];
  roots: SidebarRoot[];
  pinned: ObjectRef[];
  inbox: number;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Remember which sectors are expanded on this device.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(OPEN_KEY) || '{}');
      if (saved && typeof saved === 'object') setOpen(saved);
    } catch {}
  }, []);

  useEffect(() => {
    const onToggle = () => setMobileOpen((o) => !o);
    window.addEventListener(TOGGLE_SIDEBAR, onToggle);
    return () => window.removeEventListener(TOGGLE_SIDEBAR, onToggle);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Expand the sector being viewed.
  useEffect(() => {
    const m = pathname.match(/^\/s\/([a-z0-9-]+)/);
    if (!m) return;
    const s = sectors.find((x) => x.slug === m[1]);
    const top = s?.parent_id ? s.parent_id : s?.id;
    if (top && !open[top]) toggle(top, true);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string, value?: boolean) {
    setOpen((o) => {
      const next = { ...o, [id]: value ?? !o[id] };
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  const tops = sectors.filter((s) => !s.parent_id);
  const current = (href: string) => (href === '/' ? pathname === '/' : pathname === href);

  return (
    <>
      {mobileOpen && <div className="side-backdrop" onClick={() => setMobileOpen(false)} aria-hidden />}
      <aside className={`side${mobileOpen ? ' open' : ''}`} aria-label="Navigation">
        <div className="side-head">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>
              <LogoMark size={18} />
            </span>
            Align
          </Link>
        </div>
        <div className="side-scroll">
          <button type="button" className="jump" onClick={openSwitcher}>
            <Search size={14} /> Jump to any page
            <kbd>⌘K</kbd>
          </button>

          <div className="nav-group">
            {NAV.map(({ href, label, Icon, key }) => (
              <Link key={href} href={href} className="nav-item" aria-current={current(href) ? 'page' : undefined}>
                <Icon size={15} strokeWidth={2} />
                <span className="label">{label}</span>
                {key === 'inbox' && inbox > 0 && <span className="n">{inbox}</span>}
              </Link>
            ))}
          </div>

          {pinned.length > 0 && (
            <div className="nav-group">
              <div className="nav-label">Pinned</div>
              {pinned.map((p) => {
                const href = p.object_type === 'sector' ? `/s/${p.slug}` : `/n/${p.id}`;
                const colour = sectors.find((s) => s.id === p.sector_id)?.colour ?? '#8a8a8a';
                return (
                  <Link key={`${p.object_type}:${p.id}`} href={href} className="nav-item" aria-current={pathname === href ? 'page' : undefined}>
                    <Pin size={13} strokeWidth={2} style={{ color: colour }} />
                    <span className="label">{p.title}</span>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="nav-group">
            <div className="nav-label">
              <span>Sectors</span>
              <Link href="/life" className="dim" style={{ fontSize: 10.5 }}>
                All
              </Link>
            </div>
            {tops.map((s) => {
              const areas = sectors.filter((a) => a.parent_id === s.id);
              const pages = roots.filter((r) => r.sector_id === s.id);
              const isOpen = Boolean(open[s.id]);
              const href = `/s/${s.slug}`;
              return (
                <div key={s.id}>
                  <div className="tree-row">
                    <button type="button" className="tree-toggle" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${s.name}`} onClick={() => toggle(s.id)}>
                      <ChevronRight size={13} />
                    </button>
                    <Link href={href} className="nav-item" aria-current={pathname === href ? 'page' : undefined} style={{ ['--c' as string]: s.colour }}>
                      <i className="swatch" aria-hidden />
                      <span className="label">{s.name}</span>
                    </Link>
                  </div>
                  {isOpen && (
                    <div className="tree-children">
                      {pages.map((r) => (
                        <TreePage key={r.id} r={r} pathname={pathname} />
                      ))}
                      {areas.map((a) => {
                        const aPages = roots.filter((r) => r.sector_id === a.id);
                        const aOpen = Boolean(open[a.id]);
                        const aHref = `/s/${a.slug}`;
                        return (
                          <div key={a.id}>
                            <div className="tree-row">
                              {aPages.length > 0 ? (
                                <button type="button" className="tree-toggle" aria-expanded={aOpen} aria-label={`${aOpen ? 'Collapse' : 'Expand'} ${a.name}`} onClick={() => toggle(a.id)}>
                                  <ChevronRight size={12} />
                                </button>
                              ) : (
                                <span className="tree-toggle" aria-hidden />
                              )}
                              <Link href={aHref} className="nav-item" aria-current={pathname === aHref ? 'page' : undefined}>
                                <span className="label">{a.name}</span>
                                {aPages.length > 0 && <span className="n">{aPages.length}</span>}
                              </Link>
                            </div>
                            {aOpen && aPages.length > 0 && (
                              <div className="tree-children">
                                {aPages.map((r) => (
                                  <TreePage key={r.id} r={r} pathname={pathname} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
}

function TreePage({ r, pathname }: { r: SidebarRoot; pathname: string }) {
  const K = NODE_KINDS[r.type];
  const href = `/n/${r.id}`;
  return (
    <div className="tree-row">
      <span className="tree-toggle" aria-hidden />
      <Link href={href} className="nav-item" aria-current={pathname === href ? 'page' : undefined} title={`${K.label}: ${r.title}`}>
        <K.Icon size={13} strokeWidth={2} style={{ flex: 'none', color: 'var(--text-3)' }} />
        <span className="label" style={r.status === 'done' ? { textDecoration: 'line-through', color: 'var(--text-3)' } : undefined}>
          {r.title}
        </span>
      </Link>
    </div>
  );
}
