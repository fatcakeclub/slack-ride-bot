/**
 * Raw shape returned by Strava's `/clubs/{id}/group_events` endpoint.
 * Snake_case because that is the wire format — do not use this outside strava.ts.
 */
export interface StravaGroupEventRaw {
  id: number;
  title: string;
  description?: string;
  activity_type: string; // e.g. "Ride"
  upcoming_occurrence: string; // ISO 8601 datetime of the next occurrence
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
  upcomingOccurrence: string; // ISO 8601
  address?: string;
  lat?: number;
  lng?: number;
  routeIds?: number[];
  clubId: number;
}

/** Map Strava's raw wire format to our camelCase domain model. */
export function toGroupEvent(raw: StravaGroupEventRaw): GroupEvent {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    activityType: raw.activity_type,
    upcomingOccurrence: raw.upcoming_occurrence,
    address: raw.address,
    lat: raw.lat,
    lng: raw.lng,
    routeIds: raw.route_ids,
    clubId: raw.club_id,
  };
}
