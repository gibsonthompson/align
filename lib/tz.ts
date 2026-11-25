// Wall-clock time in Gibson's time zone, the same on the server and in the browser.
// A calendar position is a date (YYYY-MM-DD) plus minutes after midnight there.

export const TZ = 'America/New_York';

let fmt: Intl.DateTimeFormat | null = null;
function parts(ms: number) {
  fmt ??= new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

// Minutes the zone is ahead of UTC at an instant (-300 in winter, -240 in summer).
function offsetAt(ms: number): number {
  const p = parts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

// A wall-clock date and minute in the zone, as an instant.
export function zonedToUtc(date: string, minutes: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = offsetAt(guess);
  let t = guess - first * 60000;
  const second = offsetAt(t);
  if (second !== first) t = guess - second * 60000;
  return new Date(t);
}

// An instant, as a wall-clock date and minute in the zone.
export function utcToZoned(ts: string | number | Date): { date: string; minutes: number } {
  const ms = new Date(ts).getTime();
  const local = new Date(ms + offsetAt(ms) * 60000);
  return { date: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export function nowZoned(): { date: string; minutes: number } {
  return utcToZoned(Date.now());
}

// "9:00 AM", "12:15 PM". 1440 reads as midnight.
export function clock(minutes: number, compact = false): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? 'AM' : 'PM';
  // Compact drops ":00" on the hour, nothing else: "6 AM", "6:30 AM".
  if (compact) return mm ? `${h12}:${String(mm).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}

// "1h 30m", "45m".
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// "HH:MM" to minutes, or null.
export function parseClock(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59 || (h === 24 && mm)) return null;
  return h * 60 + mm;
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
