import { TZ } from './time';

export interface Forecast {
  tempMinF: number;
  tempMaxF: number;
  precipProb: number; // max % across sampled points
  description: string;
  emoji: string;
  windMph: number; // strongest sustained wind across points
  gustMph: number;
  windDir: string; // compass direction the wind blows from, at the windiest point
  aqi?: number; // US AQI, max across points
  aqiCategory?: string;
}

interface Point {
  lat: number;
  lng: number;
}

// WMO weather codes → friendly description + emoji.
function describe(code: number): { description: string; emoji: string } {
  if (code === 0) return { description: 'clear', emoji: '☀️' };
  if (code <= 2) return { description: 'partly cloudy', emoji: '🌤️' };
  if (code === 3) return { description: 'overcast', emoji: '☁️' };
  if (code <= 48) return { description: 'foggy', emoji: '🌁' };
  if (code <= 57) return { description: 'drizzle', emoji: '🌦️' };
  if (code <= 67) return { description: 'rain', emoji: '🌧️' };
  if (code <= 77) return { description: 'snow', emoji: '❄️' };
  if (code <= 82) return { description: 'showers', emoji: '🌦️' };
  if (code <= 86) return { description: 'snow showers', emoji: '🌨️' };
  return { description: 'thunderstorms', emoji: '⛈️' };
}

function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

function aqiCategory(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

/** Decode a Google/Strava encoded polyline into [lat, lng] pairs. */
function decodePolyline(str: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

/** Sample start / middle / end of the route, or fall back to the meeting point. */
function samplePoints(lat: number | undefined, lng: number | undefined, polyline?: string): Point[] {
  if (polyline) {
    const c = decodePolyline(polyline);
    if (c.length >= 2) {
      const pick = [c[0], c[Math.floor(c.length / 2)], c[c.length - 1]];
      return pick.map(([la, ln]) => ({ lat: la, lng: ln }));
    }
  }
  if (lat !== undefined && lng !== undefined) return [{ lat, lng }];
  return [];
}

/** The LA-local "YYYY-MM-DDTHH" bucket for an ISO instant. */
function laHourKey(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

/** Normalize Open-Meteo's response: an array for multi-point, an object for one. */
function asArray<T>(data: T | T[]): T[] {
  return Array.isArray(data) ? data : [data];
}

async function fetchAqiByPoint(points: Point[], key: string): Promise<number[]> {
  const lats = points.map((p) => p.lat).join(',');
  const lngs = points.map((p) => p.lng).join(',');
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lngs}` +
    `&hourly=us_aqi&timezone=${encodeURIComponent(TZ)}&forecast_days=3`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { hourly?: { time: string[]; us_aqi: number[] } } | Array<{ hourly?: { time: string[]; us_aqi: number[] } }>;
  const out: number[] = [];
  for (const loc of asArray(data)) {
    const i = loc.hourly?.time.findIndex((t) => t.startsWith(key)) ?? -1;
    if (i >= 0 && loc.hourly) out.push(loc.hourly.us_aqi[i]);
  }
  return out.filter((n) => typeof n === 'number' && !Number.isNaN(n));
}

interface HourlyWx {
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
  weather_code: number[];
  wind_speed_10m: number[];
  wind_gusts_10m: number[];
  wind_direction_10m: number[];
}

/**
 * Best-effort forecast for a ride, sampled along the route (start/mid/end) at
 * the ride's start hour. Returns null if there are no usable coordinates or the
 * weather lookup fails — weather is a nice-to-have and must never block a post.
 * Air quality is fetched separately and simply omitted if it fails.
 */
export async function fetchForecast(
  lat: number | undefined,
  lng: number | undefined,
  polyline: string | undefined,
  occurrenceIso: string
): Promise<Forecast | null> {
  const points = samplePoints(lat, lng, polyline);
  if (points.length === 0) return null;

  const key = laHourKey(occurrenceIso); // e.g. "2026-06-29T06"

  try {
    const lats = points.map((p) => p.lat).join(',');
    const lngs = points.map((p) => p.lng).join(',');
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
      `&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(TZ)}&forecast_days=3`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { hourly?: HourlyWx } | Array<{ hourly?: HourlyWx }>;

    const temps: number[] = [];
    const precips: number[] = [];
    const codes: number[] = [];
    let windMph = 0;
    let gustMph = 0;
    let windDeg = 0;

    for (const loc of asArray(data)) {
      const h = loc.hourly;
      if (!h) continue;
      const i = h.time.findIndex((t) => t.startsWith(key));
      if (i < 0) continue;
      temps.push(h.temperature_2m[i]);
      precips.push(h.precipitation_probability[i] ?? 0);
      codes.push(h.weather_code[i]);
      if (h.wind_speed_10m[i] > windMph) {
        windMph = h.wind_speed_10m[i];
        windDeg = h.wind_direction_10m[i];
      }
      gustMph = Math.max(gustMph, h.wind_gusts_10m[i] ?? 0);
    }
    if (temps.length === 0) return null;

    const { description, emoji } = describe(Math.max(...codes));

    const aqis = await fetchAqiByPoint(points, key).catch(() => []);
    const aqi = aqis.length ? Math.round(Math.max(...aqis)) : undefined;

    return {
      tempMinF: Math.round(Math.min(...temps)),
      tempMaxF: Math.round(Math.max(...temps)),
      precipProb: Math.max(...precips),
      description,
      emoji,
      windMph: Math.round(windMph),
      gustMph: Math.round(gustMph),
      windDir: compass(windDeg),
      aqi,
      aqiCategory: aqi !== undefined ? aqiCategory(aqi) : undefined,
    };
  } catch {
    return null;
  }
}
