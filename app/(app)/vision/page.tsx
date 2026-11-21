import { Images } from 'lucide-react';
import TopBar from '@/components/TopBar';
import ComingSoon from '@/components/ComingSoon';

export default function VisionPage() {
  return (
    <>
      <TopBar title="Vision" />
      <ComingSoon
        phase={6}
        Icon={Images}
        title="Pictures Of What It Looks Like"
        body="Images on every sector and goal, plus your HQ vision board photos brought over and filed by sector."
        items={['Sector And Goal Boards', 'The Full Gallery', 'Morning Feed Mode', 'Achieved Wall', 'Before And After', 'HQ Photo Import']}
      />
    </>
  );
}
