import Link from 'next/link';
import { ClipboardCheck, NotebookPen } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { getSectors } from '@/lib/data';
import { planHealth } from '@/lib/capacity';
import { REVIEW_COLS, reviewsDue } from '@/lib/review';
import { NODE_KINDS, VERDICT_LABEL } from '@/lib/kinds';
import { shortDate, todayISO } from '@/lib/format';
import type { NodeType, Review } from '@/lib/types';
import TopBar from '@/components/TopBar';
import EmptyState from '@/components/EmptyState';
import PlanHealthPanel from '@/components/plan/PlanHealthPanel';

export const dynamic = 'force-dynamic';

const tone = (v: string) => (v === 'continue' ? ' good' : v === 'modify' ? ' soon' : ' late');

export default async function ReviewsPage() {
  await requireSession();
  const today = todayISO();
  const [due, recentRes, health, sectors, activeRes] = await Promise.all([
    reviewsDue(14),
    db().from('align_reviews').select(REVIEW_COLS).order('created_at', { ascending: false }).limit(30),
    planHealth(),
    getSectors(),
    db().from('align_nodes').select('id', { count: 'exact', head: true }).eq('archived', false).in('type', ['strategy', 'experiment']).in('status', ['active', 'planned']),
  ]);
  const recent = (recentRes.data ?? []) as Review[];
  const ids = [...new Set(recent.map((r) => r.node_id))];
  const { data: nodes } = ids.length ? await db().from('align_nodes').select('id, title, type, sector_id').in('id', ids) : { data: [] };
  const nodeMap = new Map(((nodes ?? []) as { id: string; title: string; type: NodeType; sector_id: string | null }[]).map((n) => [n.id, n]));
  const colour = (id: string | null) => sectors.find((s) => s.id === id)?.colour ?? '#8a8a8a';
  const overdue = due.filter((d) => (d.review_date ?? d.due_date ?? '9') <= today).length;
  const executed = recent.filter((r) => r.execution !== null);
  const avgExec = executed.length ? executed.reduce((n, r) => n + Number(r.execution), 0) / executed.length : null;

  return (
    <>
      <TopBar title="Reviews" />
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Reviews</h1>
            <p>Judge both sides: was it done, and did it work. Doing everything with no progress means the strategy needs changing, not more effort.</p>
          </div>
        </div>

        <div className="bal four" style={{ marginBottom: 18 }}>
          <div className="stat">
            <div className="stat-label">Due now</div>
            <div className={`stat-value${overdue ? ' late' : ''}`}>{overdue}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Due in 2 weeks</div>
            <div className="stat-value">{due.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Strategies running</div>
            <div className="stat-value">{activeRes.count ?? 0}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Carried out, recent reviews</div>
            <div className="stat-value">{avgExec === null ? 'None' : `${Math.round(avgExec * 100)}%`}</div>
          </div>
        </div>

        <div className="two-col">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">
                  Due For Review <span className="count">{due.length}</span>
                </h2>
              </div>
              {due.length === 0 ? (
                <EmptyState Icon={ClipboardCheck} title="Nothing Due" body="Strategies and experiments show up here when their review date comes around. Give each one a review date when you create it." />
              ) : (
                <div className="rv-list">
                  {due.map((d) => {
                    const K = NODE_KINDS[d.type];
                    const when = d.review_date ?? d.due_date;
                    const late = when !== null && when <= today;
                    return (
                      <Link key={d.id} href={`/n/${d.id}?review=1`} className="rv-item" style={{ ['--c' as string]: colour(d.sector_id) }}>
                        <K.Icon size={15} className="rv-icon" />
                        <span className="rv-title">
                          <b>{d.title}</b>
                          <span className="dim">{K.label}</span>
                        </span>
                        {d.verdict && <span className={`tag${tone(d.verdict)}`}>{VERDICT_LABEL[d.verdict]}</span>}
                        <span className={`tag${late ? ' late' : ' soon'}`}>{when ? (late ? `Due ${shortDate(when)}` : shortDate(when)) : 'No date'}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">
                  Recent Verdicts <span className="count">{recent.length}</span>
                </h2>
              </div>
              {recent.length === 0 ? (
                <EmptyState Icon={NotebookPen} title="No Reviews Yet" body="When you or ChatGPT review a strategy, the verdict and the evidence behind it are kept here and on the page." />
              ) : (
                <div className="rv-list">
                  {recent.map((r) => {
                    const n = nodeMap.get(r.node_id);
                    return (
                      <Link key={r.id} href={`/n/${r.node_id}`} className="rv-item rv-past" style={{ ['--c' as string]: colour(n?.sector_id ?? null) }}>
                        <span className={`tag${tone(r.verdict)}`}>{VERDICT_LABEL[r.verdict]}</span>
                        <span className="rv-title">
                          <b>{n?.title ?? 'Removed page'}</b>
                          <span className="dim">{r.summary}</span>
                        </span>
                        <span className="mono dim">{r.execution === null ? '' : `${Math.round(Number(r.execution) * 100)}%`}</span>
                        <span className="mono dim">{shortDate(r.created_at.slice(0, 10))}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
          <PlanHealthPanel health={health} />
        </div>
      </div>
    </>
  );
}
