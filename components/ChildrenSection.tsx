'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, Loader2, Plus } from 'lucide-react';
import { createNode, reorderNode, updateNode } from '@/app/actions';
import { NODE_KINDS, NODE_TYPE_ORDER, STATUS_LABEL } from '@/lib/kinds';
import { dueLabel } from '@/lib/format';
import type { ChildRow, NodeType } from '@/lib/types';
import Dropdown from '@/components/Dropdown';
import EmptyState from '@/components/EmptyState';

const typeOptions = (allowed: NodeType[]) =>
  allowed.map((t) => {
    const K = NODE_KINDS[t];
    return { value: t, label: K.label, icon: <K.Icon size={14} /> };
  });

// The next layer down, as a table. Each row opens its own page; the add row creates the next level.
export default function ChildrenSection({
  title,
  items,
  parentId,
  sectorId,
  defaultType,
  allowedTypes = NODE_TYPE_ORDER,
  groupByType = false,
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
  const ready = items.filter((i) => i.actionable).length;
  // Show each row's kind only when the list mixes kinds and is not already grouped by them.
  const mixed = !groupByType && new Set(items.map((i) => i.type)).size > 1;

  const groups = useMemo(() => {
    if (!groupByType) return [{ key: 'all', label: null as string | null, rows: items }];
    return NODE_TYPE_ORDER.map((t) => ({ key: t, label: NODE_KINDS[t].plural, rows: items.filter((i) => i.type === t) })).filter((g) => g.rows.length);
  }, [items, groupByType]);

  function add() {
    const t = text.trim();
    if (!t) return inputRef.current?.focus();
    setError(null);
    startAdd(async () => {
      const res = await createNode({ type, title: t, parentId, sectorId: parentId ? null : sectorId });
      if (!res.ok) return setError(res.error);
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
      return setError(res.error);
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
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">
          {title}
          <span className="count">
            {items.length ? `${done}/${items.length} done` : '0'}
            {ready > 0 ? `, ${ready} ready` : ''}
          </span>
        </h2>
        {items.length > 1 && (
          <button type="button" className={`btn${ordering ? '' : ' ghost'}`} onClick={() => setOrdering((o) => !o)} aria-pressed={ordering}>
            {ordering ? 'Done' : 'Reorder'}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState Icon={NODE_KINDS[defaultType].Icon} title={emptyTitle} body={emptyBody} />
      ) : (
        <>
          <div className="table-head" aria-hidden>
            <span />
            <span>Title</span>
            <span className="c-status">Status</span>
            <span>Due</span>
            <span className="c-effort">Effort</span>
            <span className="c-progress">{ordering ? 'Order' : 'Under'}</span>
          </div>
          {groups.map((g) => (
            <div key={g.key}>
              {g.label && (
                <div className="group-head">
                  <span>{g.label}</span>
                  <span>{g.rows.length}</span>
                </div>
              )}
              {g.rows.map((row) => {
                const status = optimistic[row.id] ?? row.status;
                const K = NODE_KINDS[row.type];
                const due = status !== 'done' ? dueLabel(row.due_date) : null;
                const pct = row.child_count ? Math.round((row.done_count / row.child_count) * 100) : 0;
                const sub = row.done_criteria || row.cadence;
                return (
                  <div key={row.id} className="trow">
                    <button
                      type="button"
                      className="check"
                      role="checkbox"
                      aria-checked={status === 'done'}
                      aria-label={status === 'done' ? `Mark ${row.title} not done` : `Mark ${row.title} done`}
                      onClick={() => toggle(row)}
                    >
                      <Check size={12} strokeWidth={3.4} />
                    </button>
                    <Link href={`/n/${row.id}`} className="t">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span className={`row-title${status === 'done' ? ' done' : ''}`}>{row.title}</span>
                        {row.actionable && status !== 'done' && <span className="tag good">Ready</span>}
                        {row.brain_state === 'asking' && <span className="tag soon">Needs answers</span>}
                      </span>
                      {(sub || mixed) && (
                        <span className="crit">
                          {mixed && <span style={{ color: 'var(--text-2)' }}>{K.label}{sub ? ' · ' : ''}</span>}
                          {row.done_criteria ? `Done when: ${row.done_criteria}` : row.cadence}
                        </span>
                      )}
                    </Link>
                    <span className="cell c-status" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <i className="status-dot" data-s={status} />
                      {STATUS_LABEL[status as keyof typeof STATUS_LABEL]}
                    </span>
                    <span className="cell">{due ? <span className={`tag ${due.tone === 'late' ? 'late' : due.tone === 'soon' ? 'soon' : ''}`}>{due.text}</span> : <span className="dim">None</span>}</span>
                    <span className="cell c-effort mono">{row.effort_minutes ? `${row.effort_minutes} min` : <span className="dim">None</span>}</span>
                    <span className="cell c-progress" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {ordering ? (
                        busyId === row.id ? (
                          <Loader2 size={14} className="spin" />
                        ) : (
                          <>
                            <button type="button" className="btn icon ghost" style={{ width: 26, height: 26 }} onClick={() => move(row, 'up')} aria-label={`Move ${row.title} up`}>
                              <ArrowUp size={13} />
                            </button>
                            <button type="button" className="btn icon ghost" style={{ width: 26, height: 26 }} onClick={() => move(row, 'down')} aria-label={`Move ${row.title} down`}>
                              <ArrowDown size={13} />
                            </button>
                          </>
                        )
                      ) : row.child_count > 0 ? (
                        <>
                          <span className="mono" style={{ fontSize: 11 }}>
                            {row.done_count}/{row.child_count}
                          </span>
                          <span className="progress" aria-hidden>
                            <span style={{ width: `${pct}%` }} />
                          </span>
                        </>
                      ) : (
                        <span className="dim">None</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      {error && <div className="inline-error" role="alert">{error}</div>}

      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Add a ${NODE_KINDS[type].label.toLowerCase()} by hand`} aria-label="New page title" maxLength={300} />
        <Dropdown label="Kind of page" value={type} options={typeOptions(allowedTypes)} onChange={(v) => setType(v as NodeType)} variant="compact" />
        <button type="submit" className="btn primary" disabled={adding} aria-label="Add">
          {adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Add
        </button>
      </form>
    </section>
  );
}
