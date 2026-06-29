import { config } from './config';
import { occurrenceTomorrowLA } from './filter';
import { withRetry } from './retry';
import { postFailureNotice, postToSlack } from './slack';
import { fetchEventDetail, getAccessToken, listEventIds } from './strava';
import { isNoonHourLA } from './time';
import { fetchForecast } from './weather';

async function run(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Strava → Slack ride-call run`);

  if (!config.skipNoonGuard && !isNoonHourLA()) {
    console.log('Not the noon hour in LA — skipping this trigger.');
    return;
  }

  const accessToken = await getAccessToken();

  // 1. Enumerate every club event ID (read_all scope surfaces new-format events).
  const ids = await withRetry(() => listEventIds(accessToken));
  console.log(`Discovered ${ids.length} club events`);

  // 2. Fetch each event's detail for its fresh next occurrence + women_only.
  //    (The list endpoint's occurrences are stale for recurring events.)
  const events = [];
  for (const id of ids) {
    try {
      events.push(await withRetry(() => fetchEventDetail(accessToken, id)));
    } catch (err) {
      // One bad event shouldn't sink the whole run.
      console.warn(`Skipping event ${id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 3. Keep events whose next occurrence is tomorrow (LA).
  const ridesTomorrow = events
    .map((event) => ({ event, occurrence: occurrenceTomorrowLA(event) }))
    .filter((r): r is { event: typeof r.event; occurrence: string } => r.occurrence !== null);
  console.log(`${ridesTomorrow.length} ride(s) happening tomorrow`);

  // 4. Enrich with a forecast (best-effort) and post each to the right channel(s).
  for (const { event, occurrence } of ridesTomorrow) {
    const forecast = await fetchForecast(event.lat, event.lng, event.routePolyline, occurrence);
    await withRetry(() => postToSlack(event, occurrence, forecast));
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
