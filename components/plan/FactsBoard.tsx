'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock3, EyeOff, Loader2, Pencil, Plus, X } from 'lucide-react';
import { addFactFull, archiveFactFull, confirmFact, editFact, type FactInput } from '@/app/plan-actions';
import { shortDate } from '@/lib/format';
import type { Fact, FactKind, Sector } from '@/lib/types';
import Dropdown from '@/components/Dropdown';
import EmptyState from '@/components/EmptyState';

export const KINDS: { value: FactKind; label: string; plural: string; hint: string }[] = [
  { value: 'value', label: 'Value', plural: 'Values', hint: 'What matters to you and why' },
  { value: 'preference', label: 'Preference', plural: 'Preferences', hint: 'What you like, dislike or prefer' },
  { value: 'constraint', label: 'Constraint', plural: 'Constraints', hint: 'Limits on time, money, health, place' },
  { value: 'resource', label: 'Resource', plural: 'Resources', hint: 'Gear, skills, money, people, access' },
  { value: 'routine', label: 'Routine', plural: 'Routines', hint: 'How your days and weeks run' },
  { value: 'environment', label: 'Environment', plural: 'Environment', hint: 'Home, workspace, city, where days happen' },
  { value: 'community', label: 'Community', plural: 'Communities', hint: 'Groups, clubs, teams, churches' },
  { value: 'fact', label: 'Fact', plural: 'Other Facts', hint: 'Anything else true about you' },
  { value: 'assumption', label: 'Assumption', plural: 'Assumptions', hint: 'Believed but not confirmed yet' },
];

type State = 'confirmed' | 'assumed' | 'stale' | 'expired';

function stateOf(f: Fact, today: string): State {
  if (f.durability === 'temporary' && f.valid_until && f.valid_until < today) return 'expired';
  if (f.verified === false || f.kind === 'assumption') return 'assumed';
  const seen = (f.confirmed_at ?? f.updated_at ?? f.created_at ?? '').slice(0, 10);
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 180);
  if (seen && seen < cutoff.toISOString().slice(0, 10)) return 'stale';
  return 'confirmed';
}

const STATE_TAG: Record<State, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed', cls: '' },
  assumed: { label: 'Assumed', cls: ' soon' },
  stale: { label: 'Check again', cls: ' soon' },
  expired: { label: 'Ended', cls: ' late' },
};

const blank = (kind: FactKind = 'fact'): FactInput => ({ fact: '', kind, verified: true, temporary: false, valid_until: null, sensitive: false, sector_id: null });

// Everything Align knows about Gibson, grouped by kind, with what is confirmed,
// what is only assumed, what has gone stale, and what was marked private.
export default function FactsBoard({ facts, sectors, today }: { facts: Fact[]; sectors: Sector[]; today: string }) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const tops = sectors.filter((s) => !s.parent_id);
  const sectorName = (id: string | null) => sectors.find((s) => s.id === id)?.name ?? null;
  const needs = facts.filter((f) => stateOf(f, today) !== 'confirmed');
  const shown = filter === 'attention' ? needs : facts;
  const groups = useMemo(() => KINDS.map((k) => ({ ...k, items: shown.filter((f) => (f.kind ?? 'fact') === k.value) })).filter((g) => g.items.length), [shown]);

  return (
    <section>
      <div className="mpanel-head">
        <h2 className="panel-title">
          What Align Knows About You <span className="count">{facts.length}</span>
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="segmented" role="group" aria-label="Show">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </button>
            <button type="button" aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>
              Needs A Look {needs.length ? `(${needs.length})` : ''}
            </button>
          </div>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {adding && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <FactForm initial={blank()} sectors={tops} onDone={() => setAdding(false)} />
        </section>
      )}

      {groups.length === 0 ? (
        <section className="panel">
          <EmptyState
            Icon={Check}
            title={filter === 'attention' ? 'Everything Is Confirmed' : 'Nothing Saved Yet'}
            body={
              filter === 'attention'
                ? 'No assumptions waiting, nothing stale, nothing ended.'
                : 'Run the intake in ChatGPT, or add what matters by hand: your values, constraints, resources, routines and the places and people your days run through.'
            }
          />
        </section>
      ) : (
        <div className="fact-grid" data-odd={groups.length % 2 === 1}>
          {groups.map((g) => (
            <section key={g.value} className="panel">
              <div className="panel-head">
                <h3 className="panel-title">
                  {g.plural} <span className="count">{g.items.length}</span>
                </h3>
                <span className="panel-note">{g.hint}</span>
              </div>
              <div className="fact-list">
                {g.items.map((f) => (
                  <FactItem key={f.id} f={f} state={stateOf(f, today)} sector={sectorName(f.sector_id)} sectors={tops} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function FactItem({ f, state, sector, sectors }: { f: Fact; state: State; sector: string | null; sectors: Sector[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tag = STATE_TAG[state];

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Failed.');
      else router.refresh();
    });
  }

  if (editing)
    return (
      <div className="fact-item editing">
        <FactForm
          id={f.id}
          initial={{ fact: f.fact, kind: f.kind ?? 'fact', verified: f.verified !== false, temporary: f.durability === 'temporary', valid_until: f.valid_until ?? null, sensitive: Boolean(f.sensitive), sector_id: f.sector_id }}
          sectors={sectors}
          onDone={() => setEditing(false)}
        />
      </div>
    );

  return (
    <div className="fact-item" data-state={state}>
      <div className="fact-text">
        <p>{f.fact}</p>
        <div className="fact-meta">
          {state !== 'confirmed' && <span className={`tag${tag.cls}`}>{tag.label}</span>}
          {f.durability === 'temporary' && (
            <span className="tag">
              <Clock3 size={10} /> {f.valid_until ? `Until ${shortDate(f.valid_until)}` : 'Temporary'}
            </span>
          )}
          {f.sensitive && (
            <span className="tag" title="Kept out of the brain and out of ChatGPT unless you ask">
              <EyeOff size={10} /> Private
            </span>
          )}
          {sector && <span className="dim">{sector}</span>}
          <span className="dim mono">{f.source === 'chatgpt' ? 'ChatGPT' : f.source === 'brain' ? 'Brain' : 'You'}</span>
        </div>
        {error && <div className="inline-error">{error}</div>}
      </div>
      <div className="fact-actions">
        {state !== 'confirmed' && state !== 'expired' && (
          <button type="button" className="btn icon ghost" title="Confirm it is true" aria-label="Confirm" onClick={() => run(() => confirmFact(f.id))} disabled={busy}>
            <Check size={14} />
          </button>
        )}
        <button type="button" className="btn icon ghost" title="Edit" aria-label="Edit" onClick={() => setEditing(true)} disabled={busy}>
          <Pencil size={13} />
        </button>
        <button type="button" className="btn icon ghost" title="Remove (kept on record)" aria-label="Remove" onClick={() => run(() => archiveFactFull(f.id))} disabled={busy}>
          {busy ? <Loader2 size={13} className="spin" /> : <X size={14} />}
        </button>
      </div>
    </div>
  );
}

function FactForm({ id, initial, sectors, onDone }: { id?: string; initial: FactInput; sectors: Sector[]; onDone: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<FactInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (p: Partial<FactInput>) => setV((x) => ({ ...x, ...p }));

  function submit() {
    setError(null);
    start(async () => {
      const res = id ? await editFact(id, v) : await addFactFull(v);
      if (!res.ok) return setError(res.error);
      onDone();
      router.refresh();
    });
  }

  return (
    <form
      className="fact-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea className="textarea" rows={2} autoFocus value={v.fact} maxLength={500} placeholder="Plain statement, like: Has 45 minutes before work on weekdays" onChange={(e) => set({ fact: e.target.value })} />
      <div className="fact-form-row">
        <Dropdown label="Kind" value={v.kind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} onChange={(k) => set({ kind: k as FactKind, verified: k === 'assumption' ? false : v.verified })} />
        <Dropdown
          label="Sector"
          value={v.sector_id ?? ''}
          options={[{ value: '', label: 'Whole life' }, ...sectors.map((s) => ({ value: s.id, label: s.name, colour: s.colour }))]}
          onChange={(s) => set({ sector_id: s || null })}
        />
      </div>
      <div className="fact-form-row">
        <div className="segmented" role="group" aria-label="Confirmed or assumed">
          <button type="button" aria-pressed={v.verified && v.kind !== 'assumption'} onClick={() => set({ verified: true, kind: v.kind === 'assumption' ? 'fact' : v.kind })}>
            Confirmed
          </button>
          <button type="button" aria-pressed={!v.verified || v.kind === 'assumption'} onClick={() => set({ verified: false })}>
            Assumed
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Lasting or temporary">
          <button type="button" aria-pressed={!v.temporary} onClick={() => set({ temporary: false, valid_until: null })}>
            Lasting
          </button>
          <button type="button" aria-pressed={v.temporary} onClick={() => set({ temporary: true })}>
            Temporary
          </button>
        </div>
      </div>
      <div className="fact-form-row">
        {v.temporary ? (
          <label className="strat-date">
            <span>Until</span>
            <input type="date" className="input" value={v.valid_until ?? ''} style={{ colorScheme: 'dark', width: 160 }} onChange={(e) => set({ valid_until: e.target.value || null })} />
          </label>
        ) : (
          <span className="dim" style={{ fontSize: 12 }}>
            Lasting facts are flagged to re-check after six months.
          </span>
        )}
        <label className="rv-check" style={{ margin: 0 }}>
          <input type="checkbox" checked={v.sensitive} onChange={(e) => set({ sensitive: e.target.checked })} />
          <span>Private: keep it out of the brain and ChatGPT unless I ask</span>
        </label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="btn-row">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy && <Loader2 size={14} className="spin" />} {id ? 'Save' : 'Add Fact'}
        </button>
      </div>
    </form>
  );
}
