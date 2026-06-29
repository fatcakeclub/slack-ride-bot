export const TZ = 'America/Los_Angeles';

/** YYYY-MM-DD for a date, evaluated in LA time. */
export function laDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
