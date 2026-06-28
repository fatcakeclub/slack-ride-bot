import { config } from './config';
import { toGroupEvent } from './types';
import type { GroupEvent, StravaGroupEventRaw } from './types';

/**
 * Persist a rotated refresh token. Strava may issue a new refresh token on each
 * exchange; if it is not written back, the job breaks after the first rotation.
 *
 * TODO: implement persistence to the GitHub Actions secret via the GitHub REST
 * API (PAT with `secrets` write scope) or an external secret store. Until then
 * this only warns so the rotation is visible in the logs.
 */
async function persistRefreshToken(newToken: string): Promise<void> {
  console.warn(
    'Strava issued a new refresh token. Update the STRAVA_REFRESH_TOKEN secret ' +
      'or the next run will fail. (persistRefreshToken is not yet wired up.)'
  );
  void newToken;
}

export async function getAccessToken(): Promise<string> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.strava.clientId,
      client_secret: config.strava.clientSecret,
      refresh_token: config.strava.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; refresh_token?: string };
  if (data.refresh_token && data.refresh_token !== config.strava.refreshToken) {
    await persistRefreshToken(data.refresh_token);
  }
  return data.access_token;
}

export async function fetchUpcomingEvents(accessToken: string): Promise<GroupEvent[]> {
  const res = await fetch(
    `https://www.strava.com/api/v3/clubs/${config.strava.clubId}/group_events`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Strava API error: ${res.status} ${await res.text()}`);
  }
  const raw = (await res.json()) as StravaGroupEventRaw[];

  if (process.env.DEBUG_RAW && raw.length > 0) {
    console.log(`[raw] keys of first event: ${Object.keys(raw[0]).join(', ')}`);
    console.log(`[raw] first event full: ${JSON.stringify(raw[0])}`);
    for (const e of raw as any[]) {
      const occ = e.upcoming_occurrences ?? [];
      console.log(
        `[raw-summary] title=${e.title} | women_only=${e.women_only} | recurrence_rule=${JSON.stringify(e.recurrence_rule)} | nOcc=${occ.length} | last=${occ[occ.length - 1]}`
      );
    }
  }

  return raw.map(toGroupEvent);
}
