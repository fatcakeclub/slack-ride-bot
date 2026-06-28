import { config } from './config';
import { occurrenceTomorrowLA } from './filter';
import { withRetry } from './retry';
import { postFailureNotice, postToSlack } from './slack';
import { fetchUpcomingEvents, getAccessToken } from './strava';
import { isNoonHourLA, laDay } from './time';

async function run(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Strava → Slack ride-call run`);

  if (!config.skipNoonGuard && !isNoonHourLA()) {
    console.log('Not the noon hour in LA — skipping this trigger.');
    return;
  }

  const accessToken = await getAccessToken();
  const events = await withRetry(() => fetchUpcomingEvents(accessToken));
  const withOccurrences = events.filter((e) => e.upcomingOccurrences.length > 0).length;
  console.log(`Fetched ${events.length} club events (${withOccurrences} with upcoming occurrences)`);

  if (process.env.DEBUG_OCCURRENCES) {
    const now = new Date();
    console.log(`[debug] nowISO=${now.toISOString()} todayLA=${laDay(now)} tomorrowLA=${laDay(new Date(now.getTime() + 86400000))}`);
    const future = events
      .flatMap((e) => e.upcomingOccurrences.map((iso) => ({ iso, title: e.title })))
      .filter((o) => new Date(o.iso).getTime() >= now.getTime())
      .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())
      .slice(0, 20);
    console.log(`[debug] ${future.length} future occurrence(s); soonest 20:`);
    for (const o of future) {
      console.log(`[debug-future] dayLA=${laDay(new Date(o.iso))} iso=${o.iso} title=${o.title}`);
    }
  }

  const ridesTomorrow = events
    .map((event) => ({ event, occurrence: occurrenceTomorrowLA(event) }))
    .filter((r): r is { event: typeof r.event; occurrence: string } => r.occurrence !== null);
  console.log(`${ridesTomorrow.length} ride(s) happening tomorrow`);

  for (const { event, occurrence } of ridesTomorrow) {
    await withRetry(() => postToSlack(event, occurrence));
    await new Promise((r) => setTimeout(r, 500)); // gentle on Slack rate limits
  }

  console.log('Run complete');
}

run().catch(async (err) => {
  console.error('Fatal error:', err);
  try {
    await postFailureNotice(err instanceof Error ? err.message : String(err));
  } catch {
    // Swallow — the original error is already logged above.
  }
  process.exit(1);
});
