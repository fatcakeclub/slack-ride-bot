import { IncomingWebhook } from '@slack/webhook';
import type { IncomingWebhookSendArguments } from '@slack/webhook';
import { config } from './config';
import { TZ } from './time';
import type { GroupEvent } from './types';

const general = new IncomingWebhook(config.slack.webhookUrl); // #ride-calls-only
const ftwnb = config.slack.ftwnbWebhookUrl
  ? new IncomingWebhook(config.slack.ftwnbWebhookUrl)
  : null; // #ftwnb

const activityEmoji: Record<string, string> = {
  Ride: '🚴',
  GravelRide: '🚵',
  MountainBikeRide: '⛰️',
  VirtualRide: '🖥️',
};

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
  occurrenceIso: string
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

  const emoji = activityEmoji[event.activityType] ?? '🚴';
  const stravaUrl = `https://www.strava.com/clubs/${config.strava.clubId}/group_events/${event.id}`;

  const shortDesc = event.description
    ? event.description.length > 300
      ? event.description.slice(0, 297) + '...'
      : event.description
    : null;

  const blocks: NonNullable<IncomingWebhookSendArguments['blocks']> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} Tomorrow: ${event.title}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*📅 Date*\n${dateStr}` },
        { type: 'mrkdwn', text: `*⏰ Time*\n${timeStr}` },
      ],
    },
  ];

  if (event.address) {
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*📍 Meet*\n${event.address}` },
        { type: 'mrkdwn', text: `*🏃 Type*\n${event.activityType}` },
      ],
    });
  }

  if (shortDesc) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: shortDesc } });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'View on Strava', emoji: true },
        url: stravaUrl,
        style: 'primary',
      },
    ],
  });

  return {
    text: `${emoji} Ride call — ${event.title} tomorrow (${dateStr})`,
    blocks,
  };
}

export async function postToSlack(event: GroupEvent, occurrenceIso: string): Promise<void> {
  const payload = formatRideMessage(event, occurrenceIso);
  const targets = destinationsFor(event);
  for (const { hook } of targets) {
    await hook.send(payload);
  }
  console.log(`✅ Posted "${event.title}" → ${targets.map((t) => t.name).join(', ')}`);
}

/** Operational failure notice — always goes to the general channel only. */
export async function postFailureNotice(message: string): Promise<void> {
  await general.send({ text: `⚠️ Strava ride-call job failed: \`${message}\`` });
}
