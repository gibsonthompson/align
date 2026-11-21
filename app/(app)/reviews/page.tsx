import { NotebookPen } from 'lucide-react';
import TopBar from '@/components/TopBar';
import ComingSoon from '@/components/ComingSoon';

export default function ReviewsPage() {
  return (
    <>
      <TopBar title="Reviews" />
      <div className="content narrow">
      <ComingSoon
        phase={7}
        Icon={NotebookPen}
        title="Look Back, Then Adjust"
        body="Reviews will walk your structure and record what you decide about each goal back onto its page."
        items={['Daily Check-In', 'Weekly Review', '90-Day Review', 'Annual Review']}
      />
      </div>
    </>
  );
}
