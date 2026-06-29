import sodium from 'libsodium-wrappers';
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
 * Persist a rotated refresh token back to the GitHub Actions secret so the next
 * run keeps working. Strava may issue a new refresh token on a token exchange;
 * if it is not written back, the stored secret goes stale and the job fails.
 *
 * Needs GH_SECRETS_PAT (a PAT with Secrets: read/write on this repo). Never
 * throws — a failure here must not break the current run, which already has a
 * valid access token; it logs loudly instead.
 */
async function persistRefreshToken(newToken: string): Promise<void> {
  const pat = process.env.GH_SECRETS_PAT;
  const repo = process.env.GITHUB_REPOSITORY; // "owner/repo", set by Actions
  if (!pat || !repo) {
    console.warn(
      '⚠️ Strava rotated the refresh token but GH_SECRETS_PAT/GITHUB_REPOSITORY ' +
        'are unset — cannot persist. Update STRAVA_REFRESH_TOKEN manually or the ' +
        'next run will fail.'
    );
    return;
  }
  try {
    const base = `https://api.github.com/repos/${repo}/actions/secrets`;
    const headers = {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const keyRes = await fetch(`${base}/public-key`, { headers });
    if (!keyRes.ok) throw new Error(`public-key ${keyRes.status} ${await keyRes.text()}`);
    const { key, key_id } = (await keyRes.json()) as { key: string; key_id: string };

    await sodium.ready;
    const encrypted = sodium.crypto_box_seal(
      sodium.from_string(newToken),
      sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
    );
    const encrypted_value = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

    const putRes = await fetch(`${base}/STRAVA_REFRESH_TOKEN`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_value, key_id }),
    });
    if (!putRes.ok) throw new Error(`PUT secret ${putRes.status} ${await putRes.text()}`);
    console.log('🔁 Persisted rotated STRAVA_REFRESH_TOKEN to GitHub secret.');
  } catch (err) {
    console.error(
      '⚠️ Failed to persist rotated refresh token — update STRAVA_REFRESH_TOKEN ' +
        `manually before the next run. ${err instanceof Error ? err.message : err}`
    );
  }
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
