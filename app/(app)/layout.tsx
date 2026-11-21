import { getSidebar } from '@/lib/data';
import { requireSession } from '@/lib/auth';
import { sectorLookup } from '@/lib/sectors';
import Sidebar from '@/components/Sidebar';
import TabBar from '@/components/TabBar';
import QuickSwitcher from '@/components/QuickSwitcher';
import RefreshOnFocus from '@/components/RefreshOnFocus';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  const side = await getSidebar();

  return (
    <div className="shell">
      <Sidebar sectors={side.sectors} roots={side.roots} pinned={side.pinned} inbox={side.inbox} />
      <div className="main">{children}</div>
      <TabBar />
      <QuickSwitcher sectors={sectorLookup(side.sectors)} />
      <RefreshOnFocus />
    </div>
  );
}
