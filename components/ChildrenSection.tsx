'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, ChevronRight, Link2, Loader2, Plus } from 'lucide-react';
import { createNode, reorderNode, updateNode } from '@/app/actions';
import { NODE_KINDS, NODE_TYPE_ORDER } from '@/lib/kinds';
import { dueLabel } from '@/lib/format';
import type { ChildRow, NodeType } from '@/lib/types';
import Dropdown from '@/components/Dropdown';
import EmptyState from '@/components/EmptyState';

const typeOptions = (allowed: NodeType[]) =>
  allowed.map((t) => {
    const K = NODE_KINDS[t];
    return { value: t, label: K.label, icon: <K.Icon size={15} strokeWidth={2.4} /> };
  });

// The next layer down. Each row opens its own page; the add row creates the next level.
export default function ChildrenSection({
  title,
  items,
  parentId,
  sectorId,
  defaultType,
  allowedTypes = NODE_TYPE_ORDER,
  groupByType = false,
  colour,
  emptyTitle,
  emptyBody,
}: {
  title: string;
  items: ChildRow[];
  parentId: string | null;
  sectorId: string | null;
  defaultType: NodeType;
  allowedTypes?: NodeType[];
  groupByType?: boolean;
  colour: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [type, setType] = useState<NodeType>(defaultType);
  const [error, setError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [adding, startAdd] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const done = items.filter((i) => (optimistic[i.id] ?? i.status) === 'done').length;

  const groups = useMemo(() => {
    if (!groupByType) return [{ key: 'all', label: null as string | null, rows: items }];
    return NODE_TYPE_ORDER.map((t) => ({ key: t, label: NODE_KINDS[t].plural, rows: items.filter((i) => i.type === t) })).filter(
      (g) => g.rows.length,
    );
  }, [items, groupByType]);

  function add() {
    const t = text.trim();
    if (!t) {
      inputRef.current?.focus();
      return;
    }
    setError(null);
    startAdd(async () => {
      const res = await createNode({ type, title: t, parentId, sectorId: parentId ? null : sectorId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setText('');
      router.refresh();
      inputRef.current?.focus();
    });
  }

  async function toggle(row: ChildRow) {
    const current = optimistic[row.id] ?? row.status;
    const next = current === 'done' ? 'active' : 'done';
    setOptimistic((o) => ({ ...o, [row.id]: next }));
    setError(null);
    const res = await updateNode(row.id, { status: next });
    if (!res.ok) {
      setOptimistic((o) => ({ ...o, [row.id]: current }));
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function move(row: ChildRow, dir: 'up' | 'down') {
    setBusyId(row.id);
    setError(null);
    const res = await reorderNode(row.id, dir);
    setBusyId(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <section className="card flush" style={{ ['--c' as string]: colour }}>
      <div className="section-head">
        <h2 className="section-title">
          {title}
          <span className="count">
            {items.length ? `${done}/${items.length}` : '0'}
          </span>
        </h2>
        {items.length > 1 && (
          <button type="button" className={`text-btn${ordering ? '' : ' ghost'}`} onClick={() => setOrdering((o) => !o)} aria-pressed={ordering}>
            {ordering ? 'Done' : 'Reorder'}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState small Icon={NODE_KINDS[defaultType].Icon} title={emptyTitle} body={emptyBody} />
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            {g.label && (
              <div className="group-head">
                <span>{g.label}</span>
                <span>{g.rows.length}</span>
              </div>
            )}
            <div className="rows">
              {g.rows.map((row) => {
                const status = optimistic[row.id] ?? row.status;
                const K = NODE_KINDS[row.type];
                const due = status !== 'done' ? dueLabel(row.due_date) : null;
                const pct = row.child_count ? Math.round((row.done_count / row.child_count) * 100) : 0;
                return (
                  <div key={row.id} className="row" style={{ padding: 0 }}>
                    <div style={{ paddingLeft: 18, display: 'flex' }}>
                      <button
                        type="button"
                        className="check"
                        role="checkbox"
                        aria-checked={status === 'done'}
                        aria-label={status === 'done' ? `Mark ${row.title} not done` : `Mark ${row.title} done`}
                        onClick={() => toggle(row)}
                      >
                        <Check size={15} strokeWidth={3.2} />
                      </button>
                    </div>
                    <Link href={`/n/${row.id}`} className="row" style={{ flex: 1, paddingLeft: 12 }}>
                      <span className="row-main">
                        <span className={`row-title${status === 'done' ? ' done' : ''}`} style={{ display: 'block' }}>
                          {row.title}
                        </span>
                        <span className="row-sub">
                          <span className="mono">{K.label}</span>
                          {status !== 'active' && status !== 'done' && <span className="mono">{status[0].toUpperCase() + status.slice(1)}</span>}
                          {due && <span className={due.tone === 'late' ? 'late' : due.tone === 'soon' ? 'soon' : ''}>{due.text}</span>}
                          {row.link_count > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <Link2 size={12} /> {row.link_count}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="row-end">
                        {row.child_count > 0 && (
                          <>
                            <span className="mono" style={{ fontSize: 11 }}>
                              {row.done_count}/{row.child_count}
                            </span>
                            <span className="progress" aria-hidden>
                              <span style={{ width: `${pct}%` }} />
                            </span>
                          </>
                        )}
                        {!ordering && <ChevronRight size={17} />}
                      </span>
                    </Link>
                    {ordering && (
                      <div style={{ display: 'flex', gap: 6, paddingRight: 14 }}>
                        {busyId === row.id ? (
                          <Loader2 size={18} className="spin" />
                        ) : (
                          <>
                            <button type="button" className="icon-btn small" onClick={() => move(row, 'up')} aria-label={`Move ${row.title} up`}>
                              <ArrowUp size={15} />
                            </button>
                            <button type="button" className="icon-btn small" onClick={() => move(row, 'down')} aria-label={`Move ${row.title} down`}>
                              <ArrowDown size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {error && <div className="inline-error" role="alert">{error}</div>}

      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          ref={inputRef}
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Add a ${NODE_KINDS[type].label.toLowerCase()}`}
          aria-label="New page title"
          maxLength={300}
        />
        <Dropdown label="Kind of page" value={type} options={typeOptions(allowedTypes)} onChange={(v) => setType(v as NodeType)} variant="compact" />
        <button type="submit" className="icon-btn on" style={{ width: 44, height: 44 }} disabled={adding} aria-label="Add">
          {adding ? <Loader2 size={19} className="spin" /> : <Plus size={20} strokeWidth={2.8} />}
        </button>
      </form>
    </section>
  );
}
