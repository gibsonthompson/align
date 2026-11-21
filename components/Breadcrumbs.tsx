'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { hrefFor, NODE_KINDS } from '@/lib/kinds';
import type { Crumb, NodeType } from '@/lib/types';

// The full path back up to the sector. Every crumb opens its page; the last is this page.
// Deep paths scroll; it opens scrolled to the end so the current spot is in view.
export default function Breadcrumbs({ path, colour }: { path: Crumb[]; colour: string }) {
  const ref = useRef<HTMLElement>(null);
  const key = path.map((c) => c.id).join('/');
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [key]);
  if (path.length <= 1) return null;
  return (
    <nav ref={ref} className="crumbs" aria-label="Where you are" style={{ ['--c' as string]: colour }}>
      {path.map((c, i) => {
        const last = i === path.length - 1;
        const label = c.title;
        const hint = c.object_type === 'node' ? NODE_KINDS[c.kind as NodeType]?.label : 'Sector';
        return (
          <span key={`${c.object_type}:${c.id}`} style={{ display: 'contents' }}>
            {last ? (
              <span className="crumb here" aria-current="page" title={hint}>
                <span>{label}</span>
              </span>
            ) : (
              <Link href={hrefFor(c)} className="crumb" title={hint}>
                {i === 0 && <i className="dot" aria-hidden />}
                <span>{label}</span>
              </Link>
            )}
            {!last && <ChevronRight size={13} className="crumb-sep" aria-hidden />}
          </span>
        );
      })}
    </nav>
  );
}
