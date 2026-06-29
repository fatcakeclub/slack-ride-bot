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
    webhookUrl: required('SLACK_WEBHOOK_URL'), // #ride-calls-only
    // Optional second webhook bound to #ftwnb. Women-only rides route here.
    // If unset, women-only rides fall back to the general channel.
    ftwnbWebhookUrl: process.env.SLACK_WEBHOOK_URL_FTWNB || undefined,
  },
  /** Bypass the noon-hour guard for dev / manual runs. */
  skipNoonGuard: Boolean(process.env.SKIP_NOON_GUARD),
};
