import Link from 'next/link';
import { AlertTriangle, CircleCheck, Info } from 'lucide-react';
import type { PlanHealth, PlanIssue } from '@/lib/capacity';

const SEV_LABEL: Record<PlanIssue['severity'], string> = { high: 'Fix', medium: 'Check', low: 'Note' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const h1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });

// Does the week fit: hours planned against what he really has, by day and by
// sector, money this month, and every conflict the plan check found.
export default function PlanHealthPanel({ health, compact = false }: { health: PlanHealth; compact?: boolean }) {
  const { hours, capacity } = health;
  const scale = Math.max(hours.free, hours.planned, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const over = hours.planned > hours.plannable;
  const dayMax = Math.max(capacity.max_day_hours * 60, ...health.byDay.map((d) => d.minutes), 1);
  const sectors = health.bySector.filter((s) => s.minutes > 0 || s.budget_hours !== null);
  const issues = compact ? health.issues.filter((i) => i.severity !== 'low') : health.issues;

  return (
    <section className="panel plan-health">
      <div className="panel-head">
        <h2 className="panel-title">Does The Week Fit</h2>
        <Link href="/profile#capacity" className="panel-note">
          {health.configured ? `${capacity.work_hours_per_week} work hours, ${capacity.buffer_percent}% kept free` : 'Set your capacity'}
        </Link>
      </div>
      <div className="panel-body ph-body">
        <div className="ph-load">
          <div className="ph-figures">
            <div>
              <span className="ph-big" data-over={over}>
                {h1(hours.planned)}
              </span>
              <span className="dim"> of {h1(hours.plannable)} plannable hours</span>
            </div>
            <span className={`tag${over ? (hours.planned > hours.free ? ' late' : ' soon') : ' good'}`}>
              {hours.planned > hours.free ? 'Over capacity' : over ? 'Using the buffer' : `${h1(hours.left)} hours open`}
            </span>
          </div>
          <div className="ph-bar" role="img" aria-label={`${h1(hours.planned)} hours planned, ${h1(hours.plannable)} plannable, ${h1(hours.free)} free`}>
            <i className="ph-plannable" style={{ width: pct(hours.plannable) }} />
            <i className="ph-buffer" style={{ left: pct(hours.plannable), width: `calc(${pct(hours.free)} - ${pct(hours.plannable)})` }} />
            <i className="ph-planned" data-over={over} style={{ width: pct(hours.planned) }} />
          </div>
          <div className="ph-legend">
            <span>
              <i className="ph-key planned" /> Planned
            </span>
            <span>
              <i className="ph-key plannable" /> Plannable
            </span>
            <span>
              <i className="ph-key buffer" /> Kept free
            </span>
          </div>
        </div>

        <div className="ph-days" aria-label="Planned hours by day">
          {health.byDay.map((d, i) => (
            <div key={d.date} className="ph-day" data-over={d.minutes > capacity.max_day_hours * 60} title={`${d.date}: ${h1(d.minutes / 60)} hours, ${d.blocks} blocks`}>
              <div className="ph-col">
                <i style={{ height: `${(d.minutes / dayMax) * 100}%` }} />
                <span className="ph-limit" style={{ bottom: `${((capacity.max_day_hours * 60) / dayMax) * 100}%` }} />
              </div>
              <span className="mono">{h1(d.minutes / 60)}</span>
              <span className="dim">{DOW[i]}</span>
            </div>
          ))}
        </div>

        {!compact && sectors.length > 0 && (
          <div className="ph-sectors">
            {sectors.map((s) => {
              const budget = s.budget_hours;
              const hrs = s.minutes / 60;
              const pctOf = budget ? Math.min(100, (hrs / budget) * 100) : 0;
              return (
                <div key={s.sector_id} className="ph-sector" style={{ ['--c' as string]: s.colour }}>
                  <span className="ph-sector-name">
                    <i className="swatch" aria-hidden /> {s.name}
                  </span>
                  <span className="mono">
                    {h1(hrs)}
                    {budget !== null ? ` / ${h1(budget)}` : ''} h
                  </span>
                  {budget !== null && (
                    <div className="ph-mini" data-over={hrs > budget * 1.1}>
                      <i style={{ width: `${pctOf}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {(health.money.total > 0 || health.money.budget !== null) && (
          <div className="ph-money">
            <span className="dim">Planned spending this month</span>
            <b className="mono" data-over={health.money.budget !== null && health.money.total > health.money.budget}>
              ${Math.round(health.money.total).toLocaleString('en-US')}
              {health.money.budget !== null && <span className="dim"> of ${Math.round(health.money.budget).toLocaleString('en-US')}</span>}
            </b>
          </div>
        )}
      </div>

      <div className="ph-issues">
        {issues.length === 0 ? (
          <div className="ph-issue ok">
            <CircleCheck size={14} /> <span>Nothing collides. The plan fits the week.</span>
          </div>
        ) : (
          issues.slice(0, compact ? 6 : 30).map((i, n) => (
            <div key={n} className="ph-issue" data-sev={i.severity}>
              {i.severity === 'low' ? <Info size={14} /> : <AlertTriangle size={14} />}
              <span className="ph-issue-text">
                <span className={`tag${i.severity === 'high' ? ' late' : i.severity === 'medium' ? ' soon' : ''}`}>{SEV_LABEL[i.severity]}</span> {i.message}
                {i.page_ids?.length ? (
                  <span className="ph-links">
                    {i.page_ids.slice(0, 4).map((id, k) => (
                      <Link key={id} href={`/n/${id}`}>
                        Open{i.page_ids!.length > 1 ? ` ${k + 1}` : ''}
                      </Link>
                    ))}
                  </span>
                ) : null}
              </span>
            </div>
          ))
        )}
        {compact && health.issues.length > issues.length && (
          <Link href="/reviews" className="ph-more">
            {health.issues.length - issues.length} smaller notes on the Reviews page
          </Link>
        )}
      </div>
    </section>
  );
}
