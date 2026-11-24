import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { getSectors } from '@/lib/data';
import { getCapacity, getFacts, getLifestyle, factState } from '@/lib/profile';
import { planHealth } from '@/lib/capacity';
import { todayISO } from '@/lib/format';
import TopBar from '@/components/TopBar';
import CapacityForm from '@/components/plan/CapacityForm';
import FactsBoard from '@/components/plan/FactsBoard';
import PlanHealthPanel from '@/components/plan/PlanHealthPanel';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  await requireSession();
  const [facts, capacity, life, sectors, health] = await Promise.all([getFacts({ includeSensitive: true }), getCapacity(), getLifestyle(), getSectors(), planHealth()]);
  const today = todayISO();
  const needs = facts.filter((f) => factState(f, today) !== 'confirmed').length;
  const privateCount = facts.filter((f) => f.sensitive).length;
  const rated = sectors.filter((s) => !s.parent_id && s.importance && s.satisfaction).length;
  const tops = sectors.filter((s) => !s.parent_id).length;

  return (
    <>
      <TopBar title="Profile" />
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Profile</h1>
            <p>Who you are, what you have to give, and what every plan is checked against.</p>
          </div>
          <Link href="/vision" className="btn">
            {life.vision ? 'Your Lifestyle Vision' : 'Write Your Lifestyle Vision'}
          </Link>
        </div>

        <div className="bal four" style={{ marginBottom: 18 }}>
          <div className="stat">
            <div className="stat-label">Facts known</div>
            <div className="stat-value">{facts.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Need a look</div>
            <div className={`stat-value${needs ? ' late' : ''}`}>{needs}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Plannable hours a week</div>
            <div className="stat-value">{Math.round(health.hours.plannable)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Sectors rated</div>
            <div className="stat-value">
              {rated}
              <span className="dim" style={{ fontSize: 15 }}>
                /{tops}
              </span>
            </div>
          </div>
        </div>

        <div className="two-col" style={{ marginBottom: 22 }}>
          <CapacityForm capacity={capacity} />
          <PlanHealthPanel health={health} compact />
        </div>

        <FactsBoard facts={facts} sectors={sectors} today={today} />
        {privateCount > 0 && (
          <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>
            {privateCount} private {privateCount === 1 ? 'fact is' : 'facts are'} shown here only. The brain and ChatGPT leave them out unless you ask.
          </p>
        )}
      </div>
    </>
  );
}
