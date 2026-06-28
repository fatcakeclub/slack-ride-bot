/** Centralized, validated environment configuration. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  strava: {
    clubId: required('STRAVA_CLUB_ID'),
    clientId: required('STRAVA_CLIENT_ID'),
    clientSecret: required('STRAVA_CLIENT_SECRET'),
    refreshToken: required('STRAVA_REFRESH_TOKEN'),
  },
  slack: {
    webhookUrl: required('SLACK_WEBHOOK_URL'),
    // Optional override. Modern incoming webhooks are bound to a channel at
    // creation and ignore this; kept configurable for legacy webhooks and for
    // surfacing the intended channel in logs.
    channel: process.env.SLACK_CHANNEL || undefined,
  },
  /** Bypass the noon-hour guard for dev / manual runs. */
  skipNoonGuard: Boolean(process.env.SKIP_NOON_GUARD),
};
