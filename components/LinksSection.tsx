'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Link2, Loader2, Plus, Search, X } from 'lucide-react';
import { createLink, deleteLink, findObjects } from '@/app/actions';
import { groupLabel, kindLabel, LINK_RELATIONS, relationLabel } from '@/lib/kinds';
import type { LinkRow, ObjectRef, ObjectType, Relation } from '@/lib/types';
import ObjectRow, { type SectorLookup } from '@/components/ObjectRow';
import EmptyState from '@/components/EmptyState';
import Sheet from '@/components/Sheet';

const GROUP_ORDER = [
  'Five-Year Visions',
  '12-Month Milestones',
  '90-Day Objectives',
  'Weekly Commitments',
  'Daily Actions',
  'Projects',
  'Phases',
  'Micro Goals',
  'Tasks',
  'Sectors And Areas',
];

// Everything connected sideways, grouped by type. Links read from both ends.
export default function LinksSection({
  self,
  selfTitle,
  links,
  sectors,
}: {
  self: { type: ObjectType; id: string };
  selfTitle: string;
  links: LinkRow[];
  sectors: SectorLookup;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, LinkRow[]>();
    for (const l of links) {
      const g = groupLabel(l);
      map.set(g, [...(map.get(g) ?? []), l]);
    }
    return [...map.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));
  }, [links]);

  async function remove(linkId: string) {
    setRemoving(linkId);
    setError(null);
    const res = await deleteLink(linkId);
    setRemoving(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">
          Linked
          <span className="count">{links.length}</span>
        </h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {links.length > 0 && (
            <button type="button" className={`btn${editing ? '' : ' ghost'}`} onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            <Plus size={14} /> Link
          </button>
        </div>
      </div>

      {links.length === 0 ? (
        <EmptyState
          Icon={Link2}
          title="Nothing Linked Yet"
          body="Connect this to the goals it supports, the projects it depends on, or anything related."
        />
      ) : (
        groups.map(([label, rows]) => (
          <div key={label}>
            <div className="group-head">
              <span>{label}</span>
              <span>{rows.length}</span>
            </div>
            <div className="rows">
              {rows.map((l) => (
                <ObjectRow
                  key={l.link_id}
                  item={l}
                  sectors={sectors}
                  end={
                    <span className="row-end">
                      <span className="tag">{relationLabel(l.relation, l.direction)}</span>
                      {editing && (
                        <button
                          type="button"
                          className="btn icon"
                          aria-label={`Unlink ${l.title}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            remove(l.link_id);
                          }}
                        >
                          {removing === l.link_id ? <Loader2 size={14} className="spin" /> : <X size={15} />}
                        </button>
                      )}
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        ))
      )}
      {error && <div className="inline-error" role="alert">{error}</div>}
      <LinkSheet open={open} onClose={() => setOpen(false)} self={self} selfTitle={selfTitle} sectors={sectors} existing={links} />
    </section>
  );
}

function LinkSheet({
  open,
  onClose,
  self,
  selfTitle,
  sectors,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  self: { type: ObjectType; id: string };
  selfTitle: string;
  sectors: SectorLookup;
  existing: LinkRow[];
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ObjectRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<ObjectRef | null>(null);
  const [relation, setRelation] = useState<Relation>('supports');
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (!open) {
      setQ('');
      setTarget(null);
      setError(null);
      setRelation('supports');
    }
  }, [open]);

  useEffect(() => {
    if (!open || target) return;
    const mine = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(
      async () => {
        const res = await findObjects(q);
        if (mine !== seq.current) return;
        setLoading(false);
        if (res.ok) setItems((res.data ?? []).filter((o) => !(o.object_type === self.type && o.id === self.id)));
        else setError(res.error);
      },
      q ? 140 : 0,
    );
    return () => window.clearTimeout(t);
  }, [q, open, target, self.type, self.id]);

  const already = (o: ObjectRef) => existing.some((l) => l.object_type === o.object_type && l.id === o.id);

  function save() {
    if (!target) return;
    setError(null);
    startSave(async () => {
      const res = await createLink(self, { type: target.object_type, id: target.id }, relation);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={target ? 'How Do They Connect' : 'Link To Any Page'}>
      {!target ? (
        <>
          <div className="field" style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-3)' }}>
              {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            </span>
            <input
              data-autofocus
              className="input"
              style={{ paddingLeft: 34 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search goals, projects, sectors"
              aria-label="Find a page to link"
              autoComplete="off"
            />
          </div>
          {!q && items.length > 0 && <div className="field-label" style={{ margin: '4px 0 6px' }}>Recently Viewed</div>}
          <div className="panel" style={{ background: 'var(--panel)' }}>
            {items.length === 0 && !loading ? (
              <div className="switcher-empty">{q ? 'Nothing matches that yet.' : 'Start typing to find a page.'}</div>
            ) : (
              <div className="rows">
                {items.map((o) => (
                  <ObjectRow
                    key={`${o.object_type}:${o.id}`}
                    item={o}
                    sectors={sectors}
                    asButton
                    onClick={() => setTarget(o)}
                    end={already(o) ? <span className="tag">Linked</span> : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <button type="button" className="btn ghost" style={{ marginBottom: 12, marginLeft: -8 }} onClick={() => setTarget(null)}>
            <ArrowLeft size={15} /> Pick a different page
          </button>
          <div className="panel panel-body" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)' }}>
              <b style={{ color: 'var(--text)' }}>{selfTitle}</b>{' '}
              {relation === 'supports' ? 'supports' : relation === 'depends_on' ? 'depends on' : 'is related to'}{' '}
              <b style={{ color: 'var(--text)' }}>{target.title}</b>
              <span className="mono dim" style={{ fontSize: 11.5 }}>
                {' '}
                ({kindLabel(target)})
              </span>
            </p>
          </div>
          <div className="field">
            <span className="field-label">Connection</span>
            <div className="segmented" role="group" aria-label="How they connect">
              {LINK_RELATIONS.map((r) => (
                <button key={r.value} type="button" aria-pressed={relation === r.value} onClick={() => setRelation(r.value)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div className="form-error" role="alert" style={{ marginBottom: 14 }}>
              {error}
            </div>
          )}
          <button type="button" className="btn primary block lg" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={18} className="spin" /> : <Link2 size={18} />} Link Them
          </button>
        </>
      )}
    </Sheet>
  );
}
