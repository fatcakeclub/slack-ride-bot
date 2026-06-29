import { config } from './config';
import { toGroupEvent } from './types';
import type { GroupEvent, StravaGroupEventRaw } from './types';

/**
 * Parse a Strava JSON response while preserving 19-digit event/route IDs.
 * These exceed JS's safe integer range, so JSON.parse would silently round
 * them. We quote them first so they survive as exact strings.
 */
function parseStravaJson<T>(text: string): T {
  return JSON.parse(text.replace(/"(id|route_id)":\s*(\d{16,})/g, '"$1":"$2"'));
}

/**
 * Persist a rotated refresh token. Strava may issue a new refresh token on each
 * exchange; if it is not written back, the job breaks after the first rotation.
 *
 * TODO: write the new token back to the GitHub Actions secret via the GitHub
 * REST API (PAT with `secrets` write scope). Until then this only warns.
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

/**
 * Enumerate the club's group events. Requires a read_all-scoped token to see
 * new-format events. The occurrences in this list are stale for recurring
 * events (they show the event's start date), so we only use it to discover
 * event IDs — fresh occurrences come from fetchEventDetail.
 */
export async function listEventIds(accessToken: string): Promise<string[]> {
  const res = await fetch(
    `https://www.strava.com/api/v3/clubs/${config.strava.clubId}/group_events`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Strava list error: ${res.status} ${await res.text()}`);
  }
  const raw = parseStravaJson<StravaGroupEventRaw[]>(await res.text());
  return raw.map((e) => String(e.id));
}

/**
 * Fetch a single event's detail. Unlike the list endpoint, this returns the
 * freshly-computed next upcoming occurrence(s) for recurring events.
 */
export async function fetchEventDetail(
  accessToken: string,
  id: string
): Promise<GroupEvent> {
  const res = await fetch(`https://www.strava.com/api/v3/group_events/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Strava detail error for ${id}: ${res.status} ${await res.text()}`);
  }
  return toGroupEvent(parseStravaJson<StravaGroupEventRaw>(await res.text()));
}
