const TZ = 'America/New_York';

// Today's date in his time zone, as YYYY-MM-DD.
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isISODate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// "Mar 4" this year, "Mar 4, 2027" otherwise.
export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const sameYear = iso.slice(0, 4) === todayISO().slice(0, 4);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

// "Due in 3 days", "Due today", "4 days overdue".
export function dueLabel(iso: string | null): { text: string; tone: 'late' | 'soon' | 'later' } | null {
  if (!iso) return null;
  const today = new Date(`${todayISO()}T12:00:00Z`).getTime();
  const due = new Date(`${iso.slice(0, 10)}T12:00:00Z`).getTime();
  const days = Math.round((due - today) / 86_400_000);
  if (days < 0) return { text: `${-days} ${days === -1 ? 'day' : 'days'} overdue`, tone: 'late' };
  if (days === 0) return { text: 'Due today', tone: 'soon' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon' };
  if (days <= 7) return { text: `Due in ${days} days`, tone: 'soon' };
  return { text: `Due ${shortDate(iso)}`, tone: 'later' };
}

// "Just now", "5 min ago", "3 hr ago", "Yesterday", "Mar 4".
export function timeAgo(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
}

export function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()));
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export function longToday(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ });
}
