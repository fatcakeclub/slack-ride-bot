import { IncomingWebhook } from '@slack/webhook';
import type { IncomingWebhookSendArguments } from '@slack/webhook';
import { config } from './config';
import { mrkdwnEscape } from './text';
import { TZ } from './time';
import type { GroupEvent } from './types';
import type { Forecast } from './weather';

const general = new IncomingWebhook(config.slack.webhookUrl); // #ride-calls-only
const ftwnb = config.slack.ftwnbWebhookUrl
  ? new IncomingWebhook(config.slack.ftwnbWebhookUrl)
  : null; // #ftwnb
const testHook = config.slack.testWebhookUrl
  ? new IncomingWebhook(config.slack.testWebhookUrl)
  : null;

/**
 * Which channels a ride call should post to. Women-only rides go to #ftwnb;
 * everything else to #ride-calls-only. If the #ftwnb webhook is not configured,
 * women-only rides fall back to the general channel so nothing is dropped.
 */
function destinationsFor(event: GroupEvent): { name: string; hook: IncomingWebhook }[] {
  if (event.womenOnly) {
    return ftwnb
      ? [{ name: '#ftwnb', hook: ftwnb }]
      : [{ name: '#ride-calls-only (ftwnb fallback)', hook: general }];
  }
  return [{ name: '#ride-calls-only', hook: general }];
}

export function formatRideMessage(
  event: GroupEvent,
  occurrenceIso: string,
  forecast: Forecast | null
): IncomingWebhookSendArguments {
  const date = new Date(occurrenceIso);

  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: TZ,
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: TZ,
  });

  const stravaUrl = `https://www.strava.com/clubs/${config.strava.clubId}/group_events/${event.id}`;

  const shortDesc = event.description
    ? event.description.length > 300
      ? event.description.slice(0, 297) + '...'
      : event.description
    : null;

  // Meet location: hyperlink to the precise coordinates when we have them,
  // otherwise fall back to whatever address text Strava gave.
  let meet: string | null = null;
  if (event.lat !== undefined && event.lng !== undefined) {
    const maps = `https://www.google.com/maps/search/?api=1&query=${event.lat},${event.lng}`;
    const label = mrkdwnEscape(event.address || 'Open in Google Maps');
    meet = `<${maps}|${label}>`;
  } else if (event.address) {
    meet = mrkdwnEscape(event.address);
  }

  const fields: { type: 'mrkdwn'; text: string }[] = [
    { type: 'mrkdwn', text: `*📅 Date*\n${dateStr}` },
    { type: 'mrkdwn', text: `*⏰ Time*\n${timeStr}` },
  ];
  if (forecast) {
    fields.push({
      type: 'mrkdwn',
      text: `*${forecast.emoji} Weather*\n${forecast.tempF}°F, ${forecast.description}, ${forecast.precipProb}% rain`,
    });
  }
  if (meet) {
    fields.push({ type: 'mrkdwn', text: `*📍 Meet*\n${meet}` });
  }

  const blocks: NonNullable<IncomingWebhookSendArguments['blocks']> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🚴 Tomorrow: ${event.title}`, emoji: true },
    },
    { type: 'section', fields },
  ];

  if (shortDesc) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: mrkdwnEscape(shortDesc) } });
  }

  if (event.routeMapUrl) {
    blocks.push({
      type: 'image',
      image_url: event.routeMapUrl,
      alt_text: event.routeName ? `Route: ${event.routeName}` : 'Route map',
    });
  }

  // A markdown link, not an actions/button block. Buttons are interactive
  // components: Slack POSTs a payload on click and warns when no Interactivity
  // Request URL is configured. A link has none of that — and still opens Strava.
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `🔗 *<${stravaUrl}|View this ride on Strava>*` },
  });

  return {
    text: `🚴 Ride call — ${event.title} tomorrow (${dateStr})`,
    blocks,
  };
}

export async function postToSlack(
  event: GroupEvent,
  occurrenceIso: string,
  forecast: Forecast | null
): Promise<void> {
  const payload = formatRideMessage(event, occurrenceIso, forecast);
  const targets = destinationsFor(event);
  const targetNames = targets.map((t) => t.name).join(', ');

  // Test mode: redirect everything to the test webhook (a DM), annotated with
  // the channel(s) it would have posted to in production.
  if (testHook) {
    await testHook.send({
      ...payload,
      blocks: [
        { type: 'context', elements: [{ type: 'mrkdwn', text: `🧪 *TEST* — would post to *${targetNames}*` }] },
        ...(payload.blocks ?? []),
      ],
    });
    console.log(`🧪 Test-posted "${event.title}" (intended: ${targetNames})`);
    return;
  }

  for (const { hook } of targets) {
    await hook.send(payload);
  }
  console.log(`✅ Posted "${event.title}" → ${targetNames}`);
}

/** Operational failure notice — always goes to the general channel only. */
export async function postFailureNotice(message: string): Promise<void> {
  await general.send({ text: `⚠️ Strava ride-call job failed: \`${message}\`` });
}
