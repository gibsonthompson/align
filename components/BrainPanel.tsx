'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, BrainCircuit, Check, ChevronDown, Loader2, Plus, RotateCw, Send, X } from 'lucide-react';
import { addFact, brainAccept, brainDismiss, brainRun, removeFact } from '@/app/actions';
import { NODE_KINDS } from '@/lib/kinds';
import { shortDate, spanLabel, timeAgo } from '@/lib/format';
import type { BrainMessage, BrainProposal, BrainReply, Fact, NodeType, ObjectType } from '@/lib/types';
import EmptyState from '@/components/EmptyState';

type Reply = BrainReply & { closed?: boolean };

interface Draft {
  on: boolean;
  title: string;
  done_criteria: string;
  effort: string;
  cadence: string;
}

const isLeaf = (t: NodeType) => t === 'action' || t === 'task';

// The planning brain on a page: asks what only Gibson can answer, proposes the
// next more specific layer, and keeps drilling until a step is truly actionable.
export default function BrainPanel({
  object,
  nodeType,
  sectorId,
  messages,
  facts,
  configured,
  model,
  autoRun,
}: {
  object: { type: ObjectType; id: string };
  nodeType?: NodeType;
  sectorId: string | null;
  messages: BrainMessage[];
  facts: Fact[];
  configured: boolean;
  model: string;
  autoRun?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [running, startRun] = useTransition();
  const [accepting, startAccept] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, { pick: string[]; text: string }>>({});
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const [newFact, setNewFact] = useState('');
  const autoRan = useRef(false);

  const brainTurns = messages.filter((m) => m.role === 'brain');
  const latest = brainTurns[brainTurns.length - 1] ?? null;
  const reply = (latest?.data ?? null) as Reply | null;
  const open = Boolean(reply && !reply.closed);
  const earlier = messages.slice(0, latest ? messages.indexOf(latest) : messages.length);

  // Fresh drafts for the newest proposals.
  const latestDrafts: Draft[] = useMemo(() => {
    if (!latest || !reply) return [];
    return (
      drafts[latest.id] ??
      (reply.proposals ?? []).map((p) => ({
        on: p.status !== 'skipped',
        title: p.title,
        done_criteria: p.done_criteria,
        effort: p.effort_minutes ? String(p.effort_minutes) : '',
        cadence: p.cadence,
      }))
    );
  }, [latest, reply, drafts]);

  useEffect(() => {
    setAnswers({});
  }, [latest?.id]);

  function run(input: { answers?: { question: string; answer: string }[]; message?: string } = {}) {
    setError(null);
    startRun(async () => {
      const res = await brainRun(object.type, object.id, input);
      if (!res.ok) return setError(res.error);
      setMessage('');
      setAnswers({});
      router.refresh();
    });
  }

  // Coming from "keep going": run straight away on a fresh page.
  useEffect(() => {
    if (autoRun && configured && !autoRan.current && messages.length === 0) {
      autoRan.current = true;
      router.replace(pathname, { scroll: false });
      run();
    }
  }, [autoRun, configured]); // eslint-disable-line react-hooks/exhaustive-deps

  function sendAnswers() {
    if (!reply) return;
    const list = reply.questions
      .map((q, i) => {
        const a = answers[i];
        const parts = [...(a?.pick ?? []), a?.text?.trim() ?? ''].filter(Boolean);
        return parts.length ? { question: q.question, answer: parts.join('. ') } : null;
      })
      .filter((x): x is { question: string; answer: string } => Boolean(x));
    if (!list.length && !message.trim()) return setError('Answer at least one question, or write a message.');
    run({ answers: list, message });
  }

  function setDraft(i: number, patch: Partial<Draft>) {
    if (!latest) return;
    setDrafts((d) => {
      const cur = [...latestDrafts];
      cur[i] = { ...cur[i], ...patch };
      return { ...d, [latest.id]: cur };
    });
  }

  function accept() {
    if (!latest || !reply) return;
    const picks = latestDrafts
      .map((d, index) => ({ d, index }))
      .filter(({ d, index }) => d.on && reply.proposals[index]?.status !== 'added')
      .map(({ d, index }) => ({
        index,
        title: d.title,
        done_criteria: d.done_criteria,
        effort_minutes: d.effort ? Number(d.effort) : null,
        cadence: d.cadence,
      }));
    if (!picks.length) return setError('Pick at least one to add.');
    setError(null);
    startAccept(async () => {
      const res = await brainAccept(latest.id, picks);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  function dismiss() {
    if (!latest) return;
    setError(null);
    startAccept(async () => {
      const res = await brainDismiss(latest.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  const state = !latest
    ? { label: 'Not run yet', tone: '' }
    : reply?.actionable
      ? { label: 'Ready to do', tone: 'good' }
      : open && reply?.questions?.length
        ? { label: 'Needs your answers', tone: 'soon' }
        : open && reply?.proposals?.some((p) => p.status !== 'added' && p.status !== 'skipped')
          ? { label: 'Has suggestions', tone: '' }
          : { label: 'Up to date', tone: '' };

  const openProposals = reply?.proposals?.some((p) => !p.status || p.status === 'open');
  const added = (reply?.proposals ?? []).filter((p) => p.status === 'added' && p.created_id);
  const runLabel = object.type === 'node' && nodeType && isLeaf(nodeType) ? 'Check if this is actionable' : 'Break this down';

  return (
    <section className="brain" aria-label="Brain">
      <div className="brain-head">
        <span className="brain-mark" aria-hidden>
          <BrainCircuit size={14} />
        </span>
        <h2 className="panel-title">
          Brain
          <span className={`tag ${state.tone}`}>{state.label}</span>
        </h2>
        <div className="panel-actions" style={{ marginLeft: 'auto' }}>
          <span className="mono dim hide-sm" style={{ fontSize: 10.5 }}>
            {model}
          </span>
          {latest && configured && (
            <button type="button" className="btn ghost" onClick={() => run()} disabled={running}>
              <RotateCw size={13} /> Run Again
            </button>
          )}
        </div>
      </div>

      <div className="brain-body">
        {!configured ? (
          <EmptyState
            Icon={BrainCircuit}
            title="Connect The Brain"
            body="Add OPENAI_API_KEY in Vercel and redeploy. Optional: ALIGN_BRAIN_MODEL to pick a different model."
          />
        ) : running ? (
          <div className="brain-thinking" role="status">
            <Loader2 size={16} className="spin" />
            Reading the whole path above this page and working out the next step. This can take up to a minute.
          </div>
        ) : !latest ? (
          <div>
            <p className="brain-assess" style={{ color: 'var(--text-2)' }}>
              The brain reads everything above this page, what is already under it and what it knows about you. If it needs a choice only you can make, it asks first. Then it proposes the next, more specific layer, with a finish line on each, until you reach something you can do today.
            </p>
            <button type="button" className="btn primary lg" style={{ marginTop: 14 }} onClick={() => run()}>
              <BrainCircuit size={15} /> {runLabel}
            </button>
          </div>
        ) : (
          <>
            <div>
              <p className="brain-assess">{reply?.assessment}</p>
              {!reply?.actionable && reply?.gap && (
                <p className="brain-gap" style={{ marginTop: 8 }}>
                  <span className="tag">Gap</span>
                  {reply.gap}
                </p>
              )}
              {reply?.critique?.trim() && (
                <p className="brain-gap brain-critique" style={{ marginTop: 8 }}>
                  <span className="tag">Challenge</span>
                  {reply.critique}
                </p>
              )}
              {reply?.capacity_note?.trim() && (
                <p className="brain-gap" style={{ marginTop: 8 }}>
                  <span className="tag">Capacity</span>
                  {reply.capacity_note}
                </p>
              )}
            </div>

            {open && (reply?.questions?.length ?? 0) > 0 && (
              <div>
                <div className="brain-section-label">Answer these first</div>
                {reply!.questions.map((q, i) => {
                  const a = answers[i] ?? { pick: [], text: '' };
                  return (
                    <div className="q" key={i}>
                      <p className="q-text">{q.question}</p>
                      {q.why && <p className="q-why">{q.why}</p>}
                      {q.options.length > 0 && (
                        <div className="q-options">
                          {q.options.map((o) => {
                            const on = a.pick.includes(o);
                            return (
                              <button
                                key={o}
                                type="button"
                                className="opt"
                                aria-pressed={on}
                                onClick={() =>
                                  setAnswers((s) => ({ ...s, [i]: { ...a, pick: on ? a.pick.filter((x) => x !== o) : [...a.pick, o] } }))
                                }
                              >
                                {o}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <input
                        className="input"
                        style={{ marginTop: q.options.length ? 0 : 10 }}
                        value={a.text}
                        placeholder={q.options.length ? 'Or in your own words' : 'Your answer'}
                        aria-label={q.question}
                        onChange={(e) => setAnswers((s) => ({ ...s, [i]: { ...a, text: e.target.value } }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            sendAnswers();
                          }
                        }}
                      />
                    </div>
                  );
                })}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button type="button" className="btn primary" onClick={sendAnswers}>
                    <Send size={13} /> Send Answers
                  </button>
                </div>
              </div>
            )}

            {(reply?.proposals?.length ?? 0) > 0 && (openProposals || added.length > 0) && (
              <div>
                <div className="brain-section-label">
                  <span>{openProposals ? 'Proposed next layer' : 'Added'}</span>
                  {openProposals && <span>Edit anything before adding</span>}
                </div>
                {reply!.proposals.map((p, i) => {
                  if (!openProposals && p.status !== 'added') return null;
                  return (
                    <ProposalCard
                      key={i}
                      p={p}
                      draft={latestDrafts[i]}
                      editable={openProposals === true && p.status !== 'added'}
                      onChange={(patch) => setDraft(i, patch)}
                    />
                  );
                })}
                {openProposals && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                    <button type="button" className="btn ghost" onClick={dismiss} disabled={accepting}>
                      Dismiss All
                    </button>
                    <button type="button" className="btn primary" onClick={accept} disabled={accepting}>
                      {accepting ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                      Add {latestDrafts.filter((d, i) => d?.on && reply!.proposals[i]?.status !== 'added').length} Pages
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>

      {configured && latest && !running && (
        <form
          className="brain-compose"
          onSubmit={(e) => {
            e.preventDefault();
            if (open && reply?.questions?.length) sendAnswers();
            else if (message.trim()) run({ message });
          }}
        >
          <textarea
            className="textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell it more, correct it, or ask for something different"
            aria-label="Message to the brain"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
          />
          <button type="submit" className="btn" disabled={!message.trim() && !(open && reply?.questions?.length)}>
            <Send size={13} /> Send
          </button>
        </form>
      )}

      {earlier.length > 0 && (
        <div className="brain-history">
          <button type="button" className="btn ghost block" style={{ borderRadius: 0, justifyContent: 'flex-start', height: 36 }} onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
            <ChevronDown size={13} style={{ transform: showHistory ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
            Earlier conversation <span className="mono dim">{earlier.length}</span>
          </button>
          {showHistory &&
            earlier.map((m) => (
              <div className="turn" key={m.id}>
                <div className="who">
                  <span>{m.role === 'user' ? 'You' : 'Brain'}</span>
                  <span>{timeAgo(m.created_at)}</span>
                </div>
                <p style={{ whiteSpace: 'pre-wrap' }}>{m.role === 'user' ? m.content : (m.data as Reply).assessment}</p>
                {m.role === 'brain' && ((m.data as Reply).proposals?.length ?? 0) > 0 && (
                  <p className="dim" style={{ marginTop: 4, fontSize: 12 }}>
                    Proposed: {(m.data as Reply).proposals.map((p) => `${p.title}${p.status === 'added' ? ' (added)' : ''}`).join('; ')}
                  </p>
                )}
              </div>
            ))}
        </div>
      )}

      <div className="brain-history">
        <button type="button" className="btn ghost block" style={{ borderRadius: 0, justifyContent: 'flex-start', height: 36 }} onClick={() => setShowFacts((s) => !s)} aria-expanded={showFacts}>
          <ChevronDown size={13} style={{ transform: showFacts ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
          What it knows about you <span className="mono dim">{facts.length}</span>
        </button>
        {showFacts && (
          <>
            {facts.map((f) => (
              <FactRow key={f.id} f={f} />
            ))}
            <form
              className="add-row"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newFact.trim()) return;
                const res = await addFact(newFact, sectorId);
                if (!res.ok) return setError(res.error);
                setNewFact('');
                router.refresh();
              }}
            >
              <input className="input" value={newFact} onChange={(e) => setNewFact(e.target.value)} placeholder="Add something it should always know" aria-label="New fact" maxLength={500} />
              <button type="submit" className="btn" disabled={!newFact.trim()}>
                Add
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}

function dates(p: BrainProposal): string {
  if (p.start_date) return spanLabel(p.start_date, p.due_date ?? null, p.type);
  return p.due_date ? `On ${shortDate(p.due_date)}` : '';
}

function ProposalCard({ p, draft, editable, onChange }: { p: BrainProposal; draft: Draft; editable: boolean; onChange: (patch: Partial<Draft>) => void }) {
  const K = NODE_KINDS[p.type];
  if (!draft) return null;
  if (!editable) {
    return (
      <div className="prop-card" data-status={p.status}>
        <span className="check" role="img" aria-label="Added" aria-checked="true" style={{ background: 'var(--green)', borderColor: 'var(--green)', color: '#000' }}>
          <Check size={12} strokeWidth={3.4} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="tag">{K.label}</span>
            {p.start_date || p.due_date ? <span className="tag">{dates(p)}</span> : null}
            <b style={{ fontWeight: 600 }}>{p.title}</b>
          </div>
          {p.done_criteria && <p className="pc-body">Done when: {p.done_criteria}</p>}
          {p.created_id && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Link href={`/n/${p.created_id}`} className="btn">
                Open
              </Link>
              {!(isLeaf(p.type) && p.done_criteria) && (
                <Link href={`/n/${p.created_id}?brain=1`} className="btn primary">
                  Keep Going <ArrowRight size={13} />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="prop-card" data-on={draft.on}>
      <button type="button" className="check" role="checkbox" aria-checked={draft.on} aria-label={draft.on ? `Leave out ${draft.title}` : `Include ${draft.title}`} onClick={() => onChange({ on: !draft.on })}>
        <Check size={12} strokeWidth={3.4} />
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="tag">
            <K.Icon size={11} /> {K.label}
          </span>
          {p.start_date || p.due_date ? <span className="tag">{dates(p)}</span> : null}
        </div>
        <textarea
          className="pc-title"
          rows={1}
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value.replace(/\n/g, ' ') })}
          aria-label="Title"
          maxLength={300}
        />
        {p.body && <p className="pc-body">{p.body}</p>}
        {p.rationale && <p className="pc-body">Why it should work: {p.rationale}</p>}
        {p.hypothesis && <p className="pc-body">Hypothesis: {p.hypothesis}</p>}
        {p.success_criteria && <p className="pc-body">Judged by: {p.success_criteria}</p>}
        {p.review_date && <p className="pc-body">Review on {shortDate(p.review_date)}</p>}
        <div className={`pc-grid${p.type === 'commitment' ? ' three' : ''}`}>
          <label className="pc-field">
            <span>Done when</span>
            <input className="input" value={draft.done_criteria} onChange={(e) => onChange({ done_criteria: e.target.value })} />
          </label>
          {p.type === 'commitment' && (
            <label className="pc-field">
              <span>Cadence</span>
              <input className="input" value={draft.cadence} onChange={(e) => onChange({ cadence: e.target.value })} />
            </label>
          )}
          <label className="pc-field">
            <span>Minutes</span>
            <input className="input" inputMode="numeric" value={draft.effort} onChange={(e) => onChange({ effort: e.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="None" />
          </label>
        </div>
        {p.why && <p className="pc-why">{p.why}</p>}
      </div>
    </div>
  );
}

function FactRow({ f }: { f: Fact }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="fact">
      <p>{f.fact}</p>
      <span className="mono dim" style={{ fontSize: 10.5 }}>
        {f.source === 'gibson' ? 'You' : 'Learned'}
      </span>
      <button
        type="button"
        className="btn icon ghost"
        style={{ width: 24, height: 24 }}
        aria-label={`Forget: ${f.fact}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await removeFact(f.id);
          setBusy(false);
          if (res.ok) router.refresh();
        }}
      >
        {busy ? <Loader2 size={12} className="spin" /> : <X size={13} />}
      </button>
    </div>
  );
}
