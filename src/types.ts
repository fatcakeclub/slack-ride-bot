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
  activity_type: string; // e.g. "Ride"
  upcoming_occurrences?: string[]; // ISO 8601 datetimes
  women_only?: boolean;
  address?: string;
  lat?: number;
  lng?: number;
  club_id: number;
}

/** CamelCase domain model used throughout the app. */
export interface GroupEvent {
  id: string;
  title: string;
  description?: string;
  activityType: string;
  upcomingOccurrences: string[]; // ISO 8601, soonest first
  womenOnly: boolean;
  address?: string;
  lat?: number;
  lng?: number;
}

/** Map Strava's raw wire format to our camelCase domain model. */
export function toGroupEvent(raw: StravaGroupEventRaw): GroupEvent {
  const upcomingOccurrences = (raw.upcoming_occurrences ?? [])
    .filter((iso) => iso && !Number.isNaN(new Date(iso).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return {
    id: String(raw.id),
    title: (raw.title ?? '').trim(),
    description: raw.description,
    activityType: raw.activity_type,
    upcomingOccurrences,
    womenOnly: Boolean(raw.women_only),
    address: raw.address,
    lat: raw.lat,
    lng: raw.lng,
  };
}
