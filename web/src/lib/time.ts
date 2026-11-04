// Show the table's hours and reopen times in the visitor's own time zone.

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatLocalTime(date: Date): string {
  return timeFormat.format(date);
}

// "6h 12m", "12m", or "under a minute"
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'under a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Wall-clock fields of `date` as seen in `timeZone`, packed into a UTC timestamp.
function wallClockAsUTC(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

// The instant that is `hour`:00 today in `timeZone` (hour 24 is the next midnight).
// shortcut: uses today's UTC offset, so it is off by an hour on DST-change days; fine for a label.
export function zonedHourToday(hour: number, timeZone: string, now = new Date()): Date {
  const wall = new Date(wallClockAsUTC(now, timeZone));
  const guess = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), hour);
  const offset = wallClockAsUTC(now, timeZone) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(guess - offset);
}

// "9:00 AM–9:00 PM" in the visitor's zone, or null when the table has no hours.
export function localHoursLabel(table?: { openHour?: number; closeHour?: number; timezone?: string }): string | null {
  if (!table?.timezone || table.openHour === undefined || table.closeHour === undefined) return null;
  const open = zonedHourToday(table.openHour, table.timezone);
  const close = zonedHourToday(table.closeHour, table.timezone);
  return `${formatLocalTime(open)}–${formatLocalTime(close)}`;
}
