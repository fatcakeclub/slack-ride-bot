import { config } from './config';
import { isTomorrowLA } from './filter';
import { withRetry } from './retry';
import { postFailureNotice, postToSlack } from './slack';
import { fetchUpcomingEvents, getAccessToken } from './strava';
import { isNoonHourLA } from './time';

async function run(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Strava → Slack ride-call run`);

  if (!config.skipNoonGuard && !isNoonHourLA()) {
    console.log('Not the noon hour in LA — skipping this trigger.');
    return;
  }

  const accessToken = await getAccessToken();
  const events = await withRetry(() => fetchUpcomingEvents(accessToken));
  console.log(`Fetched ${events.length} club events`);

  const ridesTomorrow = events.filter((e) => isTomorrowLA(e));
  console.log(`${ridesTomorrow.length} ride(s) happening tomorrow`);

  for (const event of ridesTomorrow) {
    await withRetry(() => postToSlack(event));
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
