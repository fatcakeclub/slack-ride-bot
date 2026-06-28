import { TZ } from './time';
import type { GroupEvent } from './types';

/** YYYY-MM-DD for a date, evaluated in LA time. */
function laDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * True if the event occurs on tomorrow's LA calendar day. The job runs around
 * noon LA, so now + 24h lands at noon tomorrow LA — the same calendar day as
 * any ride happening tomorrow, which keeps the comparison robust across DST.
 */
export function isTomorrowLA(event: GroupEvent, now = new Date()): boolean {
  const occurrenceDay = laDay(new Date(event.upcomingOccurrence));
  const tomorrowDay = laDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  return occurrenceDay === tomorrowDay;
}
