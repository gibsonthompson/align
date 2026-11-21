'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, CalendarRange, FolderInput, Loader2, MoreHorizontal } from 'lucide-react';
import { archiveNode, updateNode } from '@/app/actions';
import { NODE_KINDS, NODE_TYPE_ORDER, STATUS_LABEL, STATUS_ORDER } from '@/lib/kinds';
import { dueLabel, shortDate } from '@/lib/format';
import type { AlignNode, NodeStatus, NodeType, Sector } from '@/lib/types';
import Dropdown from '@/components/Dropdown';
import Sheet from '@/components/Sheet';
import PinButton from '@/components/PinButton';
import MoveSheet from '@/components/MoveSheet';
import type { SectorLookup } from '@/components/ObjectRow';

const PRIORITY = [
  { value: '0', label: 'No Priority' },
  { value: '1', label: 'High' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'Low' },
];

// Title, type, status, dates and priority, all editable in place. Saves as you go.
export default function NodeHero({
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
  const K = NODE_KINDS[node.type];
  const colour = sector?.colour ?? '#8a8a8a';
  const [title, setTitle] = useState(node.title);
  const [body, setBody] = useState(node.body);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [dates, setDates] = useState(false);
  const [moving, setMoving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, startBusy] = useTransition();
  const bodyTimer = useRef<number | null>(null);
  const lastSaved = useRef({ title: node.title, body: node.body });

  // A refresh from the other device brings new values in, unless he is typing here.
  useEffect(() => {
    const el = document.activeElement as HTMLElement | null;
    const typing = el?.dataset?.field === 'title' || el?.dataset?.field === 'body';
    if (!typing) {
      setTitle(node.title);
      setBody(node.body);
      lastSaved.current = { title: node.title, body: node.body };
    }
  }, [node.title, node.body]);

  async function save(patch: Parameters<typeof updateNode>[1]) {
    setSaveState('saving');
    setError(null);
    const res = await updateNode(node.id, patch);
    if (!res.ok) {
      setSaveState('error');
      setError(res.error);
      return false;
    }
    setSaveState('saved');
    window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1600);
    router.refresh();
    return true;
  }

  async function saveTitle() {
    const t = title.trim().replace(/\s+/g, ' ');
    if (!t) {
      setTitle(lastSaved.current.title);
      return;
    }
    if (t === lastSaved.current.title) return;
    if (await save({ title: t })) lastSaved.current.title = t;
  }

  function onBodyChange(v: string) {
    setBody(v);
    if (bodyTimer.current) window.clearTimeout(bodyTimer.current);
    bodyTimer.current = window.setTimeout(async () => {
      if (v === lastSaved.current.body) return;
      if (await save({ body: v })) lastSaved.current.body = v;
    }, 900);
  }

  function flushBody() {
    if (bodyTimer.current) window.clearTimeout(bodyTimer.current);
    if (body !== lastSaved.current.body) {
      save({ body }).then((ok) => {
        if (ok) lastSaved.current.body = body;
      });
    }
  }

  function archive(next: boolean) {
    startBusy(async () => {
      const res = await archiveNode(node.id, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirmArchive(false);
      setMenu(false);
      router.refresh();
    });
  }

  const due = node.status !== 'done' ? dueLabel(node.due_date) : null;

  return (
    <section className="hero" style={{ ['--c' as string]: colour }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span className="eyebrow">
          <i className="dot" aria-hidden />
          {K.label}
          {K.horizon && <span className="dim">· {K.horizon}</span>}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {!node.archived && <PinButton type="node" id={node.id} pinned={pinned} />}
          <button type="button" className="icon-btn" onClick={() => setMenu(true)} aria-label="More options">
            <MoreHorizontal size={19} />
          </button>
        </div>
      </div>

      <textarea
        data-field="title"
        className="hero-title-input"
        value={title}
        rows={1}
        maxLength={300}
        aria-label="Title"
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        readOnly={node.archived}
      />

      <div className="hero-meta">
        <Dropdown
          label="Status"
          variant="pill"
          value={node.status}
          disabled={node.archived}
          options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s], icon: <i className="status-dot" data-s={s} /> }))}
          onChange={(v) => save({ status: v as NodeStatus })}
        />
        <Dropdown
          label="Kind of page"
          variant="pill"
          value={node.type}
          disabled={node.archived}
          options={NODE_TYPE_ORDER.map((t) => {
            const T = NODE_KINDS[t];
            return { value: t, label: T.label, icon: <T.Icon size={14} strokeWidth={2.4} /> };
          })}
          onChange={(v) => save({ type: v as NodeType })}
        />
        <button type="button" className="pill" onClick={() => setDates(true)} disabled={node.archived} style={{ cursor: 'pointer' }}>
          <CalendarRange size={14} />
          {node.start_date || node.due_date
            ? [node.start_date && shortDate(node.start_date), node.due_date && shortDate(node.due_date)].filter(Boolean).join(' to ')
            : 'Add Dates'}
        </button>
        {due && <span className={`pill ${due.tone === 'late' ? 'late' : due.tone === 'soon' ? 'soon' : ''}`}>{due.text}</span>}
        <Dropdown
          label="Priority"
          variant="pill"
          value={String(node.priority ?? 0)}
          disabled={node.archived}
          options={PRIORITY}
          onChange={(v) => save({ priority: v === '0' ? null : Number(v) })}
        />
        {saveState !== 'idle' && (
          <span className="save-state" role="status">
            {saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Not saved'}
          </span>
        )}
      </div>

      <div className="hero-body">
        <textarea
          data-field="body"
          className="textarea bare"
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          onBlur={flushBody}
          placeholder="Describe what this looks like when it is real, why it matters, and how you will know it is done."
          aria-label="Description"
          readOnly={node.archived}
        />
      </div>

      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      <Sheet open={menu} onClose={() => { setMenu(false); setConfirmArchive(false); }} title="Page Options">
        <div className="stack" style={{ gap: 10 }}>
          {node.archived ? (
            <button type="button" className="btn block" onClick={() => archive(false)} disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <ArchiveRestore size={18} />} Restore This Page
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn block"
                onClick={() => {
                  setMenu(false);
                  setMoving(true);
                }}
              >
                <FolderInput size={18} /> Move To Another Place
              </button>
              {confirmArchive ? (
                <div className="card" style={{ background: 'var(--surface-2)', border: 0 }}>
                  <p style={{ fontWeight: 600, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    This page and everything under it will be archived. Links and history are kept, and you can restore it any time.
                  </p>
                  <div className="btn-row" style={{ marginTop: 14 }}>
                    <button type="button" className="btn small" onClick={() => setConfirmArchive(false)}>
                      Keep It
                    </button>
                    <button type="button" className="btn small danger" onClick={() => archive(true)} disabled={busy}>
                      {busy && <Loader2 size={16} className="spin" />} Archive
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn block danger" onClick={() => setConfirmArchive(true)}>
                  <Archive size={18} /> Archive This Page
                </button>
              )}
            </>
          )}
          {error && <div className="form-error">{error}</div>}
        </div>
      </Sheet>

      <DatesSheet open={dates} onClose={() => setDates(false)} node={node} onSave={save} />
      <MoveSheet open={moving} onClose={() => setMoving(false)} node={node} allSectors={allSectors} sectors={sectors} />
    </section>
  );
}

function DatesSheet({
  open,
  onClose,
  node,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  node: AlignNode;
  onSave: (patch: { start_date?: string | null; due_date?: string | null }) => Promise<boolean>;
}) {
  const [start, setStart] = useState(node.start_date ?? '');
  const [due, setDue] = useState(node.due_date ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setStart(node.start_date ?? '');
      setDue(node.due_date ?? '');
      setError(null);
    }
  }, [open, node.start_date, node.due_date]);

  async function save(clear = false) {
    if (!clear && start && due && start > due) {
      setError('The start date is after the due date.');
      return;
    }
    setSaving(true);
    const ok = await onSave(clear ? { start_date: null, due_date: null } : { start_date: start || null, due_date: due || null });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Dates">
      <div className="grid-fields" style={{ marginBottom: 14 }}>
        <label className="field">
          <span className="field-label">Starts</span>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Due</span>
          <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      {error && (
        <div className="form-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => save(true)} disabled={saving || (!node.start_date && !node.due_date)}>
          Clear Dates
        </button>
        <button type="button" className="btn primary" onClick={() => save(false)} disabled={saving}>
          {saving && <Loader2 size={17} className="spin" />} Save
        </button>
      </div>
    </Sheet>
  );
}
