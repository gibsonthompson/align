'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, FolderInput, Loader2, Pin } from 'lucide-react';
import { archiveNode, setPinned, updateNode } from '@/app/actions';
import { NODE_KINDS, NODE_TYPE_ORDER, STATUS_LABEL, STATUS_ORDER } from '@/lib/kinds';
import { dueLabel } from '@/lib/format';
import type { AlignNode, NodeStatus, NodeType, Sector } from '@/lib/types';
import Dropdown from '@/components/Dropdown';
import Sheet from '@/components/Sheet';
import MoveSheet from '@/components/MoveSheet';
import type { SectorLookup } from '@/components/ObjectRow';

type Patch = Parameters<typeof updateNode>[1];

function useSave(id: string) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  async function save(patch: Patch) {
    setState('saving');
    setError(null);
    const res = await updateNode(id, patch);
    if (!res.ok) {
      setState('error');
      setError(res.error);
      return false;
    }
    setState('saved');
    window.setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 1400);
    router.refresh();
    return true;
  }
  return { save, state, error };
}

function isTyping(field: string) {
  return (document.activeElement as HTMLElement | null)?.dataset?.field === field;
}

// Title and description, edited in place. Saves as you go.
export function NodeTitle({ node }: { node: AlignNode }) {
  const K = NODE_KINDS[node.type];
  const { save, state, error } = useSave(node.id);
  const [title, setTitle] = useState(node.title);
  const [body, setBody] = useState(node.body);
  const last = useRef({ title: node.title, body: node.body });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!isTyping('title')) setTitle(node.title);
    if (!isTyping('body')) setBody(node.body);
    last.current = { title: node.title, body: node.body };
  }, [node.title, node.body]);

  async function saveTitle() {
    const t = title.trim().replace(/\s+/g, ' ');
    if (!t) return setTitle(last.current.title);
    if (t !== last.current.title && (await save({ title: t }))) last.current.title = t;
  }

  function onBody(v: string) {
    setBody(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      if (v !== last.current.body && (await save({ body: v }))) last.current.body = v;
    }, 900);
  }

  return (
    <div className="page-title-block">
      <div className="eyebrow">
        <b>{K.label}</b>
        {K.horizon && <span>{K.horizon}</span>}
        {node.actionable && <span className="tag good">Ready To Do</span>}
        {state !== 'idle' && <span className="save-state">{state === 'saving' ? 'Saving' : state === 'saved' ? 'Saved' : 'Not saved'}</span>}
      </div>
      <textarea
        data-field="title"
        className="title-input"
        rows={1}
        value={title}
        maxLength={300}
        aria-label="Title"
        readOnly={node.archived}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
      <textarea
        data-field="body"
        className="desc-input"
        value={body}
        aria-label="Description"
        readOnly={node.archived}
        placeholder="What this looks like when it is real, and why it matters."
        onChange={(e) => onBody(e.target.value)}
        onBlur={() => {
          if (timer.current) window.clearTimeout(timer.current);
          if (body !== last.current.body) save({ body }).then((ok) => ok && (last.current.body = body));
        }}
      />
      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  );
}

const PRIORITY = [
  { value: '0', label: 'None' },
  { value: '1', label: 'High' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'Low' },
];

// Everything about the page besides its words: status, kind, timing, finish line.
export function NodeProperties({
  node,
  sector,
  pinned,
  allSectors,
  sectors,
}: {
  node: AlignNode;
  sector: Sector | null;
  pinned: boolean;
  allSectors: Sector[];
  sectors: SectorLookup;
}) {
  const router = useRouter();
  const { save, error } = useSave(node.id);
  const [criteria, setCriteria] = useState(node.done_criteria);
  const [effort, setEffort] = useState(node.effort_minutes ? String(node.effort_minutes) : '');
  const [cadence, setCadence] = useState(node.cadence);
  const [pin, setPin] = useState(pinned);
  const [moving, setMoving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, startBusy] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTyping('criteria')) setCriteria(node.done_criteria);
    if (!isTyping('effort')) setEffort(node.effort_minutes ? String(node.effort_minutes) : '');
    if (!isTyping('cadence')) setCadence(node.cadence);
  }, [node.done_criteria, node.effort_minutes, node.cadence]);
  useEffect(() => setPin(pinned), [pinned]);

  const due = node.status !== 'done' ? dueLabel(node.due_date) : null;
  const leaf = node.type === 'action' || node.type === 'task' || node.type === 'micro_goal';

  async function togglePin() {
    const next = !pin;
    setPin(next);
    const res = await setPinned('node', node.id, next);
    if (!res.ok) {
      setPin(!next);
      setLocalError(res.error);
    } else router.refresh();
  }

  function archive(next: boolean) {
    setLocalError(null);
    startBusy(async () => {
      const res = await archiveNode(node.id, next);
      if (!res.ok) return setLocalError(res.error);
      setConfirmArchive(false);
      router.refresh();
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Properties</h2>
        {!node.archived && (
          <button type="button" className={`btn icon${pin ? ' on' : ''}`} onClick={togglePin} aria-pressed={pin} aria-label={pin ? 'Unpin' : 'Pin to Today and the sidebar'} title={pin ? 'Pinned' : 'Pin'}>
            <Pin size={14} fill={pin ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <div className="props">
        <div className="prop">
          <span className="prop-label">Status</span>
          <div className="prop-value">
            <Dropdown
              label="Status"
              variant="pill"
              value={node.status}
              disabled={node.archived}
              options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s], icon: <i className="status-dot" data-s={s} /> }))}
              onChange={(v) => save({ status: v as NodeStatus })}
            />
          </div>
        </div>
        <div className="prop">
          <span className="prop-label">Kind</span>
          <div className="prop-value">
            <Dropdown
              label="Kind of page"
              variant="pill"
              value={node.type}
              disabled={node.archived}
              options={NODE_TYPE_ORDER.map((t) => {
                const T = NODE_KINDS[t];
                return { value: t, label: T.label, icon: <T.Icon size={14} /> };
              })}
              onChange={(v) => save({ type: v as NodeType })}
            />
          </div>
        </div>
        <div className="prop">
          <span className="prop-label">Priority</span>
          <div className="prop-value">
            <Dropdown label="Priority" variant="pill" value={String(node.priority ?? 0)} disabled={node.archived} options={PRIORITY} onChange={(v) => save({ priority: v === '0' ? null : Number(v) })} />
          </div>
        </div>
        <div className="prop">
          <span className="prop-label">Starts</span>
          <div className="prop-value">
            <input type="date" className="prop-input" value={node.start_date ?? ''} disabled={node.archived} onChange={(e) => save({ start_date: e.target.value || null })} aria-label="Start date" style={{ colorScheme: 'dark' }} />
          </div>
        </div>
        <div className="prop">
          <span className="prop-label">Due</span>
          <div className="prop-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" className="prop-input" value={node.due_date ?? ''} disabled={node.archived} onChange={(e) => save({ due_date: e.target.value || null })} aria-label="Due date" style={{ colorScheme: 'dark' }} />
            {due && <span className={`tag ${due.tone === 'late' ? 'late' : due.tone === 'soon' ? 'soon' : ''}`}>{due.text}</span>}
          </div>
        </div>
        <div className="prop stack">
          <span className="prop-label">Done when</span>
          <textarea
            data-field="criteria"
            className="prop-input"
            value={criteria}
            disabled={node.archived}
            placeholder="The measurable finish line"
            aria-label="Done when"
            onChange={(e) => setCriteria(e.target.value)}
            onBlur={() => criteria !== node.done_criteria && save({ done_criteria: criteria })}
          />
        </div>
        <div className="prop">
          <span className="prop-label">Effort</span>
          <div className="prop-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              data-field="effort"
              className="prop-input"
              inputMode="numeric"
              value={effort}
              disabled={node.archived}
              placeholder="Minutes"
              aria-label="Effort in minutes"
              style={{ width: 90 }}
              onChange={(e) => setEffort(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onBlur={() => {
                const v = effort ? Number(effort) : null;
                if (v !== node.effort_minutes) save({ effort_minutes: v && v > 0 ? v : null });
              }}
            />
            {effort && <span className="dim">min</span>}
          </div>
        </div>
        {(node.type === 'commitment' || node.cadence) && (
          <div className="prop">
            <span className="prop-label">Cadence</span>
            <div className="prop-value">
              <input
                data-field="cadence"
                className="prop-input"
                value={cadence}
                disabled={node.archived}
                placeholder="4 times a week, 20 min"
                aria-label="Cadence"
                onChange={(e) => setCadence(e.target.value)}
                onBlur={() => cadence !== node.cadence && save({ cadence })}
              />
            </div>
          </div>
        )}
        <div className="prop">
          <span className="prop-label">Ready to do</span>
          <div className="prop-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={node.actionable}
              aria-label="Ready to do"
              disabled={node.archived}
              onClick={() => save({ actionable: !node.actionable })}
            />
            <span className="dim" style={{ fontSize: 12 }}>
              {node.actionable ? 'Passes the actionable test' : leaf ? 'Needs a clear finish line' : 'Break it down further'}
            </span>
          </div>
        </div>
        <div className="prop">
          <span className="prop-label">Sector</span>
          <div className="prop-value" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'nowrap', ['--c' as string]: sector?.colour ?? '#8a8a8a' }}>
            <i className="swatch" aria-hidden />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sector ? sectors[sector.id]?.name ?? sector.name : 'None'}</span>
          </div>
        </div>
      </div>
      <div className="panel-body" style={{ borderTop: '1px solid var(--line)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {node.archived ? (
          <button type="button" className="btn" onClick={() => archive(false)} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <ArchiveRestore size={14} />} Restore
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => setMoving(true)}>
              <FolderInput size={14} /> Move
            </button>
            <button type="button" className="btn danger" onClick={() => setConfirmArchive(true)}>
              <Archive size={14} /> Archive
            </button>
          </>
        )}
      </div>
      {(error || localError) && <div className="inline-error" role="alert">{error ?? localError}</div>}

      <Sheet open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archive This Page">
        <p className="muted" style={{ lineHeight: 1.6, marginBottom: 16 }}>
          This page and everything under it will be archived. Links, notes and history are kept, and you can restore it any time.
        </p>
        <div className="btn-row">
          <button type="button" className="btn lg" onClick={() => setConfirmArchive(false)}>
            Keep It
          </button>
          <button type="button" className="btn lg danger" onClick={() => archive(true)} disabled={busy}>
            {busy && <Loader2 size={14} className="spin" />} Archive
          </button>
        </div>
      </Sheet>
      <MoveSheet open={moving} onClose={() => setMoving(false)} node={node} allSectors={allSectors} sectors={sectors} />
    </section>
  );
}
