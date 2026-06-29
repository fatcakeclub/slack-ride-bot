/**
 * Raw shape returned by Strava's group-event endpoints. Snake_case because it
 * is the wire format — do not use this outside strava.ts.
 *
 * `id` is a string here on purpose: new-format event IDs are 19 digits and
 * exceed JS's safe integer range, so we preserve them as strings (see
 * parseStravaJson in strava.ts).
 */
export interface StravaGroupEventRaw {
  id: string;
  title: string;
  description?: string;
  activity_type: string;
  upcoming_occurrences?: string[]; // ISO 8601 datetimes
  women_only?: boolean;
  address?: string;
  start_latlng?: [number, number] | null; // [lat, lng] of the meeting spot
  route?: {
    name?: string;
    map_urls?: { url?: string; light_url?: string; dark_url?: string };
  } | null;
  club_id: number;
}

/** CamelCase domain model used throughout the app. */
export interface GroupEvent {
  id: string;
  title: string;
  description?: string;
  upcomingOccurrences: string[]; // ISO 8601, soonest first
  womenOnly: boolean;
  address?: string;
  lat?: number; // meeting-spot latitude
  lng?: number; // meeting-spot longitude
  routeName?: string;
  routeMapUrl?: string; // static thumbnail of the route
}

/** Map Strava's raw wire format to our camelCase domain model. */
export function toGroupEvent(raw: StravaGroupEventRaw): GroupEvent {
  const upcomingOccurrences = (raw.upcoming_occurrences ?? [])
    .filter((iso) => iso && !Number.isNaN(new Date(iso).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  const [lat, lng] = Array.isArray(raw.start_latlng) ? raw.start_latlng : [undefined, undefined];

  return {
    id: String(raw.id),
    title: (raw.title ?? '').trim(),
    description: raw.description,
    upcomingOccurrences,
    womenOnly: Boolean(raw.women_only),
    address: raw.address,
    lat,
    lng,
    routeName: raw.route?.name,
    routeMapUrl: raw.route?.map_urls?.url,
  };
}
