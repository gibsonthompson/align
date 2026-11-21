import Link from 'next/link';
import { hrefFor, kindIcon, kindLabel } from '@/lib/kinds';
import type { ObjectRef } from '@/lib/types';

export type SectorLookup = Record<string, { name: string; colour: string }>;

// One row for any object: its kind, title and sector. Used by search, links, pins and recents.
export default function ObjectRow({
  item,
  sectors,
  end,
  onClick,
  active,
  asButton = false,
}: {
  item: ObjectRef;
  sectors: SectorLookup;
  end?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  asButton?: boolean;
}) {
  const Icon = kindIcon(item);
  const sector = item.sector_id ? sectors[item.sector_id] : undefined;
  const colour = sector?.colour ?? '#8a8a8a';
  const content = (
    <>
      <span className="row-icon" aria-hidden>
        <Icon size={15} strokeWidth={2} />
      </span>
      <span className="row-main">
        <span className={`row-title${item.status === 'done' ? ' done' : ''}`}>{item.title}</span>
        <span className="row-sub">
          <span>{kindLabel(item)}</span>
          {sector && item.object_type !== 'sector' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ['--c' as string]: colour }}>
              <i className="swatch" aria-hidden />
              {sector.name}
            </span>
          )}
          {item.snippet && <span>{item.snippet}</span>}
        </span>
      </span>
      {end}
    </>
  );
  if (asButton) {
    return (
      <button type="button" className="row" onClick={onClick} data-active={active}>
        {content}
      </button>
    );
  }
  return (
    <Link href={hrefFor(item)} className="row" onClick={onClick} data-active={active}>
      {content}
    </Link>
  );
}
