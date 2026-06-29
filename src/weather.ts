import { TZ } from './time';

export interface Forecast {
  tempF: number;
  precipProb: number; // %
  description: string;
  emoji: string;
}

// WMO weather codes → friendly description + emoji.
function describe(code: number): { description: string; emoji: string } {
  if (code === 0) return { description: 'clear', emoji: '☀️' };
  if (code <= 2) return { description: 'partly cloudy', emoji: '🌤️' };
  if (code === 3) return { description: 'overcast', emoji: '☁️' };
  if (code <= 48) return { description: 'foggy', emoji: '🌫️' };
  if (code <= 57) return { description: 'drizzle', emoji: '🌦️' };
  if (code <= 67) return { description: 'rain', emoji: '🌧️' };
  if (code <= 77) return { description: 'snow', emoji: '❄️' };
  if (code <= 82) return { description: 'showers', emoji: '🌦️' };
  if (code <= 86) return { description: 'snow showers', emoji: '🌨️' };
  return { description: 'thunderstorms', emoji: '⛈️' };
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

/**
 * Best-effort forecast for a ride's start coordinates and time, via Open-Meteo
 * (free, no API key). Returns null if coordinates are missing or the lookup
 * fails — weather is a nice-to-have and must never block a ride call.
 */
export async function fetchForecast(
  lat: number | undefined,
  lng: number | undefined,
  occurrenceIso: string
): Promise<Forecast | null> {
  if (lat === undefined || lng === undefined) return null;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&hourly=temperature_2m,precipitation_probability,weather_code` +
      `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(TZ)}&forecast_days=3`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[] };
    };
    const h = data.hourly;
    if (!h) return null;

    const key = laHourKey(occurrenceIso); // e.g. "2026-06-29T06"
    const i = h.time.findIndex((t) => t.startsWith(key));
    if (i === -1) return null;

    const { description, emoji } = describe(h.weather_code[i]);
    return {
      tempF: Math.round(h.temperature_2m[i]),
      precipProb: h.precipitation_probability[i] ?? 0,
      description,
      emoji,
    };
  } catch {
    return null;
  }
}
