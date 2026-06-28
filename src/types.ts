/**
 * Raw shape returned by Strava's `/clubs/{id}/group_events` endpoint.
 * Snake_case because that is the wire format — do not use this outside strava.ts.
 *
 * Strava returns the next occurrences as a plural array (`upcoming_occurrences`);
 * the singular field is kept as a defensive fallback in case the shape varies.
 */
export interface StravaGroupEventRaw {
  id: number;
  title: string;
  description?: string;
  activity_type: string; // e.g. "Ride"
  upcoming_occurrences?: string[]; // ISO 8601 datetimes of the next occurrences
  upcoming_occurrence?: string; // fallback (singular)
  address?: string;
  lat?: number;
  lng?: number;
  route_ids?: number[];
  club_id: number;
}

/** CamelCase domain model used throughout the app. */
export interface GroupEvent {
  id: number;
  title: string;
  description?: string;
  activityType: string;
  upcomingOccurrences: string[]; // ISO 8601, soonest first
  address?: string;
  lat?: number;
  lng?: number;
  routeIds?: number[];
  clubId: number;
}

/** Map Strava's raw wire format to our camelCase domain model. */
export function toGroupEvent(raw: StravaGroupEventRaw): GroupEvent {
  const occurrences = (raw.upcoming_occurrences ?? []).slice();
  if (raw.upcoming_occurrence) occurrences.push(raw.upcoming_occurrence);

  // Keep only valid datetimes, sorted soonest-first.
  const upcomingOccurrences = occurrences
    .filter((iso) => iso && !Number.isNaN(new Date(iso).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    activityType: raw.activity_type,
    upcomingOccurrences,
    address: raw.address,
    lat: raw.lat,
    lng: raw.lng,
    routeIds: raw.route_ids,
    clubId: raw.club_id,
  };
}
