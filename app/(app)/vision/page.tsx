import { requireSession } from '@/lib/auth';
import { getSectors } from '@/lib/data';
import { getLifestyle } from '@/lib/profile';
import { planHealth } from '@/lib/capacity';
import TopBar from '@/components/TopBar';
import LifestyleEditor from '@/components/plan/LifestyleEditor';
import IdealWeek from '@/components/plan/IdealWeek';

export const dynamic = 'force-dynamic';

export default async function VisionPage() {
  await requireSession();
  const [life, sectors, health] = await Promise.all([getLifestyle(), getSectors(), planHealth()]);
  return (
    <>
      <TopBar title="Vision" />
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Vision</h1>
            <p>The life the goals are for: how a great week actually runs, and what no plan is allowed to take.</p>
          </div>
        </div>
        <LifestyleEditor lifestyle={life} />
        <IdealWeek slots={life.ideal_week} sectors={sectors} planned={health.bySector.map((s) => ({ sector_id: s.sector_id, minutes: s.minutes }))} />
      </div>
    </>
  );
}
