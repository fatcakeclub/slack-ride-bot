import { IncomingWebhook } from '@slack/webhook';
import type { IncomingWebhookSendArguments } from '@slack/webhook';
import { config } from './config';
import { TZ } from './time';
import type { GroupEvent } from './types';

const webhook = new IncomingWebhook(config.slack.webhookUrl);

const activityEmoji: Record<string, string> = {
  Ride: '🚴',
  GravelRide: '🚵',
  MountainBikeRide: '⛰️',
  VirtualRide: '🖥️',
};

export function formatRideMessage(event: GroupEvent): IncomingWebhookSendArguments {
  const date = new Date(event.upcomingOccurrence);

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
    // Honored by legacy webhooks; modern channel-bound webhooks ignore it.
    ...(config.slack.channel ? { channel: config.slack.channel } : {}),
  };
}

export async function postToSlack(event: GroupEvent): Promise<void> {
  await webhook.send(formatRideMessage(event));
  console.log(`✅ Posted ride call: ${event.title} (${event.upcomingOccurrence})`);
}

export async function postFailureNotice(message: string): Promise<void> {
  await webhook.send({
    text: `⚠️ Strava ride-call job failed: \`${message}\``,
    ...(config.slack.channel ? { channel: config.slack.channel } : {}),
  });
}
