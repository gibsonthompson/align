'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, ClipboardCheck, FlaskConical, Loader2, Route, Target } from 'lucide-react';
import { loadReviewEvidence, recordReviewAction, saveStrategyFields } from '@/app/plan-actions';
import { addDaysISO, shortDate, todayISO } from '@/lib/format';
import { VERDICT_LABEL } from '@/lib/kinds';
import type { AlignNode, Review } from '@/lib/types';
import type { ReviewEvidence } from '@/lib/review';
import Sheet from '@/components/Sheet';

type Verdict = 'continue' | 'modify' | 'replace' | 'stop';
type Effective = 'yes' | 'partly' | 'no' | 'unclear';

const VERDICTS: { v: Verdict; hint: string }[] = [
  { v: 'continue', hint: 'It is working. Keep going as is.' },
  { v: 'modify', hint: 'Right idea, change how it is done.' },
  { v: 'replace', hint: 'Swap it for a different approach.' },
  { v: 'stop', hint: 'Drop it. It is not worth the time.' },
];
const EFFECTIVE: { v: Effective; label: string }[] = [
  { v: 'yes', label: 'Worked' },
  { v: 'partly', label: 'Partly' },
  { v: 'no', label: 'Did not' },
  { v: 'unclear', label: 'Unclear' },
];
const verdictTone = (v: string) => (v === 'continue' ? ' good' : v === 'stop' || v === 'replace' ? ' late' : v === 'modify' ? ' soon' : '');
const pctText = (n: number | null) => (n === null ? 'Not measured' : `${Math.round(n * 100)}%`);

// The reasoning behind a strategy or experiment, its review date, the verdicts
// so far, and a review that looks at the evidence before deciding.
export default function StrategyPanel({ node, reviews, autoReview = false }: { node: AlignNode; reviews: Review[]; autoReview?: boolean }) {
  const router = useRouter();
  const isExp = node.type === 'experiment';
  const isStrategy = node.type === 'strategy';
  const [rationale, setRationale] = useState(node.rationale);
  const [hypothesis, setHypothesis] = useState(node.hypothesis);
  const [success, setSuccess] = useState(node.success_criteria);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const today = todayISO();
  const due = node.review_date ?? (isExp ? node.due_date : null);
  const overdue = due !== null && due <= today && !['done', 'abandoned'].includes(node.status);

  useEffect(() => {
    const f = (document.activeElement as HTMLElement | null)?.dataset?.field;
    if (f !== 'rationale') setRationale(node.rationale);
    if (f !== 'hypothesis') setHypothesis(node.hypothesis);
    if (f !== 'success') setSuccess(node.success_criteria);
  }, [node.rationale, node.hypothesis, node.success_criteria]);

  useEffect(() => {
    if (autoReview) setOpen(true);
  }, [autoReview]);

  async function save(patch: Parameters<typeof saveStrategyFields>[1]) {
    setError(null);
    const res = await saveStrategyFields(node.id, patch);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  const Icon = isExp ? FlaskConical : isStrategy ? Route : Target;

  return (
    <section className="panel strat">
      <div className="panel-head">
        <h2 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={15} /> {isExp ? 'The Experiment' : isStrategy ? 'Why This Should Work' : 'Reviews'}
        </h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {node.verdict && <span className={`tag${verdictTone(node.verdict)}`}>{VERDICT_LABEL[node.verdict]}</span>}
          {!node.archived && (
            <button type="button" className={`btn${overdue ? ' primary' : ''}`} onClick={() => setOpen(true)}>
              <ClipboardCheck size={14} /> Review Now
            </button>
          )}
        </div>
      </div>

      <div className="panel-body strat-body">
        {isStrategy && (
          <label className="field">
            <span className="field-label">The rationale: why this should move the goal, and what it costs</span>
            <textarea
              data-field="rationale"
              className="textarea"
              rows={3}
              value={rationale}
              maxLength={5000}
              placeholder="The mechanism. What changes because of this, and why that moves the number or the outcome above."
              onChange={(e) => setRationale(e.target.value)}
              onBlur={() => rationale !== node.rationale && save({ rationale })}
            />
          </label>
        )}
        {isExp && (
          <div className="strat-grid">
            <label className="field">
              <span className="field-label">Hypothesis</span>
              <textarea
                data-field="hypothesis"
                className="textarea"
                rows={3}
                value={hypothesis}
                maxLength={2000}
                placeholder="If I do X for N weeks, Y will change by Z."
                onChange={(e) => setHypothesis(e.target.value)}
                onBlur={() => hypothesis !== node.hypothesis && save({ hypothesis })}
              />
            </label>
            <label className="field">
              <span className="field-label">Judged by</span>
              <textarea
                data-field="success"
                className="textarea"
                rows={3}
                value={success}
                maxLength={2000}
                placeholder="Exactly what counts as it working at the end."
                onChange={(e) => setSuccess(e.target.value)}
                onBlur={() => success !== node.success_criteria && save({ success_criteria: success })}
              />
            </label>
          </div>
        )}
        <div className="strat-meta">
          <label className="strat-date">
            <CalendarClock size={14} />
            <span>Review on</span>
            <input
              type="date"
              className="input"
              value={node.review_date ?? ''}
              style={{ colorScheme: 'dark', width: 150 }}
              onChange={(e) => save({ review_date: e.target.value || null })}
              aria-label="Review date"
            />
          </label>
          {isExp && node.start_date && node.due_date && (
            <span className="dim">
              Trial runs {shortDate(node.start_date)} to {shortDate(node.due_date)}
            </span>
          )}
          {overdue && <span className="tag soon">Review due</span>}
        </div>
        {node.verdict_note && (
          <p className="strat-note">
            <span className="dim">Last verdict: </span>
            {node.verdict_note}
          </p>
        )}
        {error && <div className="inline-error">{error}</div>}
      </div>

      {reviews.length > 0 && (
        <div className="strat-history">
          {reviews.map((r) => (
            <div key={r.id} className="strat-review">
              <div className="strat-review-head">
                <span className={`tag${verdictTone(r.verdict)}`}>{VERDICT_LABEL[r.verdict]}</span>
                <span className="mono dim">{shortDate(r.created_at.slice(0, 10))}</span>
                <span className="dim">Done {pctText(r.execution)}</span>
                <span className="dim">Worked: {EFFECTIVE.find((e) => e.v === r.effective)?.label}</span>
                {r.source === 'chatgpt' && <span className="tag">ChatGPT</span>}
              </div>
              <p>{r.summary}</p>
              {r.changes && <p className="dim">Changes: {r.changes}</p>}
            </div>
          ))}
        </div>
      )}

      <ReviewSheet node={node} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

function ReviewSheet({ node, open, onClose }: { node: AlignNode; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [ev, setEv] = useState<ReviewEvidence | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [effective, setEffective] = useState<Effective>('unclear');
  const [summary, setSummary] = useState('');
  const [changes, setChanges] = useState('');
  const [next, setNext] = useState(addDaysISO(todayISO(), 14));
  const [pause, setPause] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setEv(null);
    setLoadErr(null);
    loadReviewEvidence(node.id).then((res) => {
      if (!res.ok) return setLoadErr(res.error);
      const e = res.data!;
      setEv(e);
      setEffective(e.effectiveness === 'improving' ? 'yes' : e.effectiveness === 'worse' ? 'no' : e.effectiveness === 'flat' ? 'partly' : 'unclear');
    });
  }, [open, node.id]);

  function submit() {
    if (!verdict) return setError('Pick a verdict.');
    if (!summary.trim()) return setError('Write a line on what happened and why.');
    setError(null);
    start(async () => {
      const res = await recordReviewAction(node.id, {
        verdict,
        effective,
        summary,
        changes,
        next_review_date: verdict === 'continue' || verdict === 'modify' ? next || null : null,
        pause_children: pause,
      });
      if (!res.ok) return setError(res.error);
      setVerdict(null);
      setSummary('');
      setChanges('');
      onClose();
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Review: ${node.title}`}>
      {!ev && !loadErr && (
        <div className="dim" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0 16px' }}>
          <Loader2 size={14} className="spin" /> Gathering what happened
        </div>
      )}
      {loadErr && <div className="form-error">{loadErr}</div>}
      {ev && (
        <div className="rv-evidence">
          <div className="dim" style={{ fontSize: 12 }}>
            {shortDate(ev.period.from)} to {shortDate(ev.period.to)}, {ev.period.days} {ev.period.days === 1 ? 'day' : 'days'}
          </div>
          <div className="bal four rv-stats">
            <div className="stat">
              <div className="stat-label">Carried out</div>
              <div className={`stat-value${ev.execution !== null && ev.execution >= 0.7 ? ' good' : ev.execution !== null && ev.execution < 0.5 ? ' late' : ''}`}>{pctText(ev.execution)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Actions done</div>
              <div className="stat-value">
                {ev.actions.done}
                <span className="dim" style={{ fontSize: 14 }}>/{ev.actions.planned}</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Blocks done</div>
              <div className="stat-value">
                {ev.calendar.done}
                <span className="dim" style={{ fontSize: 14 }}>/{ev.calendar.blocks}</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">The numbers</div>
              <div className={`stat-value${ev.effectiveness === 'improving' ? ' good' : ev.effectiveness === 'worse' ? ' late' : ''}`} style={{ fontSize: 17 }}>
                {ev.effectiveness === 'improving' ? 'Moving' : ev.effectiveness === 'worse' ? 'Wrong way' : ev.effectiveness === 'flat' ? 'Flat' : 'None tracked'}
              </div>
            </div>
          </div>
          {(ev.habits.length > 0 || ev.measures.length > 0) && (
            <div className="rv-lines">
              {ev.habits.map((h) => (
                <div key={h.title}>
                  <span className="dim">Habit</span> {h.title}: {h.done} of {h.target}
                </div>
              ))}
              {ev.measures.map((m) => (
                <div key={m.name}>
                  <span className="dim">Measure</span> {m.name}: {m.start ?? 'none'} to {m.end ?? 'none'} {m.unit}
                  {m.toward_target === true ? ', toward the target' : m.toward_target === false ? ', away from the target' : ''}
                </div>
              ))}
            </div>
          )}
          <p className="rv-diagnosis">{ev.diagnosis}</p>
        </div>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <span className="field-label">Verdict</span>
        <div className="rv-verdicts">
          {VERDICTS.map((x) => (
            <button key={x.v} type="button" className="rv-verdict" aria-pressed={verdict === x.v} onClick={() => setVerdict(x.v)}>
              <b>{VERDICT_LABEL[x.v]}</b>
              <span>{x.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <span className="field-label">Did it work</span>
        <div className="segmented" role="group" aria-label="Did it work">
          {EFFECTIVE.map((x) => (
            <button key={x.v} type="button" aria-pressed={effective === x.v} onClick={() => setEffective(x.v)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="field-label">What happened, and why this verdict</span>
        <textarea className="textarea" rows={3} value={summary} maxLength={5000} onChange={(e) => setSummary(e.target.value)} />
      </label>
      {verdict === 'modify' && (
        <label className="field" style={{ marginTop: 12 }}>
          <span className="field-label">What changes</span>
          <textarea className="textarea" rows={2} value={changes} maxLength={5000} onChange={(e) => setChanges(e.target.value)} />
        </label>
      )}
      {(verdict === 'continue' || verdict === 'modify') && (
        <label className="field" style={{ marginTop: 12 }}>
          <span className="field-label">Next review</span>
          <input type="date" className="input" value={next} min={todayISO()} style={{ colorScheme: 'dark', width: 170 }} onChange={(e) => setNext(e.target.value)} />
        </label>
      )}
      {(verdict === 'replace' || verdict === 'stop') && (
        <label className="rv-check">
          <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} />
          <span>Pause the open work under it. It stays on record as abandoned with its reasoning{verdict === 'replace' ? '; add the replacement under the goal above' : ''}.</span>
        </label>
      )}
      {error && (
        <div className="form-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button type="button" className="btn lg" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn lg primary" onClick={submit} disabled={busy}>
          {busy && <Loader2 size={14} className="spin" />} Save Review
        </button>
      </div>
    </Sheet>
  );
}
