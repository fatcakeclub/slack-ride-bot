import { laDay } from './time';
import type { GroupEvent } from './types';

/**
 * If any of the event's upcoming occurrences falls on tomorrow's LA calendar
 * day, return that occurrence's ISO datetime; otherwise null.
 *
 * The job runs around noon LA, so now + 24h lands at noon tomorrow LA — the
 * same calendar day as any ride happening tomorrow, which keeps the comparison
 * robust across DST.
 */
export function occurrenceTomorrowLA(event: GroupEvent, now = new Date()): string | null {
  const tomorrowDay = laDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  return (
    event.upcomingOccurrences.find((iso) => laDay(new Date(iso)) === tomorrowDay) ?? null
  );
}
