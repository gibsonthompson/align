import { CalendarDays } from 'lucide-react';
import TopBar from '@/components/TopBar';
import ComingSoon from '@/components/ComingSoon';

export default function CalendarPage() {
  return (
    <>
      <TopBar title="Calendar" />
      <div className="content narrow">
      <ComingSoon
        phase={5}
        Icon={CalendarDays}
        title="The Time View Of Your Life"
        body="Every block on the calendar will belong to something in your life map and open the page it serves."
        items={['Day, Week And Month Views', 'Quarter And Year Timelines', 'Habit Slots', 'Drag To Reschedule', 'Sector Balance Per Week', 'Google Calendar Sync']}
      />
      </div>
    </>
  );
}
