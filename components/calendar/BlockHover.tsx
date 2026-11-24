'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, CalendarClock, Clock3, FileText, Sparkles } from 'lucide-react';
import { clock, duration } from '@/lib/tz';
import { kindIcon, kindLabel } from '@/lib/kinds';
import type { SectorLookup } from '@/components/ObjectRow';
import { blockTitle, longDate, type CalBlock } from '@/components/calendar/shared';

const STATUS = { planned: 'Planned', done: 'Done', skipped: 'Skipped' } as const;

// Everything about a block, beside it, while the pointer rests on it.
export default function BlockHover({ block, anchor, lookup, movable = true }: { block: CalBlock; anchor: DOMRect; lookup: SectorLookup; movable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 10;
    const fitsRight = anchor.right + gap + w <= window.innerWidth - 8;
    const left = fitsRight ? anchor.right + gap : Math.max(8, anchor.left - gap - w);
    const top = Math.min(Math.max(8, anchor.top), window.innerHeight - h - 8);
    setPos({ left, top });
  }, [anchor, block.id]);

  const sector = block.sector_id ? lookup[block.sector_id] : undefined;
  const Kind = block.node ? kindIcon({ object_type: 'node', kind: block.node.type }) : null;
  const len = block.e - block.s;

  return createPortal(
    <div ref={ref} className="bh" role="tooltip" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, ['--c' as string]: sector?.colour ?? '#8a8a8a' }}>
      <div className="bh-sector">
        <i className="swatch" aria-hidden />
        <span>{sector?.name ?? 'No sector'}</span>
        {block.sector_auto && !block.node_id && (
          <span className="bh-auto" title="Filed automatically from the title and notes">
            <Sparkles size={10} /> Auto
          </span>
        )}
      </div>
      <div className="bh-title">{blockTitle(block)}</div>
      <div className="bh-row">
        <CalendarClock size={13} />
        <span>{longDate(block.date)}</span>
      </div>
      <div className="bh-row">
        <Clock3 size={13} />
        <span>
          {clock(block.s)} to {block.e >= 1440 ? 'Midnight' : clock(block.e)} <span className="dim">· {duration(len)}</span>
        </span>
      </div>
      <div className="bh-tags">
        <span className={`tag${block.status === 'done' ? ' good' : ''}`}>{STATUS[block.status]}</span>
        {block.source === 'chatgpt' && (
          <span className="tag">
            <Bot size={10} /> From ChatGPT
          </span>
        )}
        {block.clipped && <span className="tag">Runs past this view</span>}
      </div>
      {block.node && Kind && (
        <div className="bh-page">
          <div className="bh-row">
            <Kind size={13} />
            <span>
              <span className="dim">{kindLabel({ object_type: 'node', kind: block.node.type })}: </span>
              {block.node.title}
            </span>
          </div>
          {block.node.done_criteria && <p className="bh-text">Done when: {block.node.done_criteria}</p>}
          {block.node.effort_minutes ? <p className="bh-text dim">Planned effort {duration(block.node.effort_minutes)}</p> : null}
        </div>
      )}
      {block.notes?.trim() && (
        <div className="bh-notes">
          <div className="bh-row">
            <FileText size={13} />
            <span className="dim">Notes</span>
          </div>
          <p className="bh-text">{block.notes}</p>
        </div>
      )}
      <div className="bh-foot">Click to edit{movable && !block.clipped ? ', drag to move' : ''}</div>
    </div>,
    document.body,
  );
}
