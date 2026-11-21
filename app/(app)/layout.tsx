import { requireSession } from '@/lib/auth';
import { getSectors } from '@/lib/data';
import { sectorLookup } from '@/lib/sectors';
import TabBar from '@/components/TabBar';
import QuickSwitcher from '@/components/QuickSwitcher';
import RefreshOnFocus from '@/components/RefreshOnFocus';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const sectors = await getSectors();

  return (
    <>
      <div className="app">{children}</div>
      <TabBar />
      <QuickSwitcher sectors={sectorLookup(sectors)} />
      <RefreshOnFocus />
    </>
  );
}
