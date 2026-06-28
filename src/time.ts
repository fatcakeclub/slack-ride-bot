export const TZ = 'America/Los_Angeles';

/** Current hour (0–23) in LA time. */
export function laHour(now = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour: '2-digit',
      hour12: false,
    }).format(now),
    10
  );
}

/**
 * True only during the noon hour in LA. GitHub Actions cron is UTC-only and
 * ignores DST, so the workflow fires at both candidate UTC hours and relies on
 * this guard to let exactly one run through year-round.
 */
export function isNoonHourLA(now = new Date()): boolean {
  return laHour(now) === 12;
}

/** YYYY-MM-DD for a date, evaluated in LA time. */
export function laDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
