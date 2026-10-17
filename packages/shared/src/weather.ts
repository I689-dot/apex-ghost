import { mulberry32 } from './prng';

export const WEATHER_KINDS = ['clear', 'cloudy', 'overcast', 'light_rain', 'heavy_rain', 'fog'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  overcast: 'Overcast',
  light_rain: 'Light rain',
  heavy_rain: 'Heavy rain',
  fog: 'Fog',
};

interface KindParams {
  clouds: number;
  rain: number;
  fog: number;
}

const PARAMS: Record<WeatherKind, KindParams> = {
  clear: { clouds: 0.08, rain: 0, fog: 0.02 },
  cloudy: { clouds: 0.45, rain: 0, fog: 0.05 },
  overcast: { clouds: 0.9, rain: 0, fog: 0.12 },
  light_rain: { clouds: 0.92, rain: 0.35, fog: 0.22 },
  heavy_rain: { clouds: 1, rain: 1, fog: 0.4 },
  fog: { clouds: 0.75, rain: 0, fog: 1 },
};

export interface WeatherPlan {
  seed: number;
  /** Local time at race start in hours (6.25 = dawn … 21.5 = night). */
  startHour: number;
  /** Game-time speed-up; 6 ⇒ a 6-minute race covers 36 minutes of daylight change. */
  timeScale: number;
  /** Day of year, used for the sun path. */
  dayOfYear: number;
  kind: WeatherKind;
  /** Optional gradual change during the race. */
  change: { to: WeatherKind; atSec: number; durationSec: number } | null;
  /** Track starts damp if it rained before the race. */
  initialWetness: number;
}

export interface WeatherState {
  hour: number;
  clouds: number;
  rain: number;
  fog: number;
  /** Water on the track 0..1 (lags behind rain). */
  wetness: number;
  /** Tyre-grip multiplier from water on the track. */
  grip: number;
  /** Fog visibility in metres. */
  visibility: number;
}

const NEXT: Record<WeatherKind, WeatherKind[]> = {
  clear: ['cloudy'],
  cloudy: ['overcast', 'light_rain', 'clear'],
  overcast: ['light_rain', 'cloudy'],
  light_rain: ['heavy_rain', 'overcast'],
  heavy_rain: ['light_rain'],
  fog: ['cloudy', 'overcast'],
};

function pickWeighted<T>(rand: () => number, entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

/** Host's choices; anything left out (or 'random') is rolled from the seed. */
export type WeatherChoice = 'random' | WeatherKind;
export type TimeChoice = 'random' | 'dawn' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export type ChangeChoice = 'random' | 'off' | 'on';

export const TIME_HOURS: Record<Exclude<TimeChoice, 'random'>, number> = {
  dawn: 6.5,
  morning: 9.5,
  midday: 13,
  afternoon: 16.5,
  evening: 19.75,
  night: 22.5,
};
export const TIME_LABEL: Record<TimeChoice, string> = {
  random: 'Random',
  dawn: 'Dawn 06:30',
  morning: 'Morning 09:30',
  midday: 'Midday 13:00',
  afternoon: 'Afternoon 16:30',
  evening: 'Evening 19:45',
  night: 'Night 22:30',
};

export interface WeatherOptions {
  weather?: WeatherChoice;
  time?: TimeChoice;
  /** 'off': conditions stay as they start; 'on': they always change during the session. */
  changes?: ChangeChoice;
}

/**
 * Everything is derived from the seed (and the host's choices), so all clients and the server agree, and the
 * lobby can show the exact forecast before the session.
 */
export function planWeather(seed: number, opts: WeatherOptions = {}): WeatherPlan {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  let kind = pickWeighted<WeatherKind>(rand, [
    ['clear', 28],
    ['cloudy', 22],
    ['overcast', 14],
    ['light_rain', 15],
    ['heavy_rain', 10],
    ['fog', 11],
  ]);
  const rolledHour = Math.round((6.25 + rand() * 15.25) * 4) / 4; // 06:15 … 21:30 (dawn to night, never pitch black)
  const dayOfYear = 120 + Math.floor(rand() * 150); // May … late September
  const rolledChange = rand() < 0.35;
  if (opts.weather && opts.weather !== 'random') kind = opts.weather;
  const startHour = opts.time && opts.time !== 'random' ? TIME_HOURS[opts.time] : rolledHour;
  const hasChange = opts.changes === 'on' ? true : opts.changes === 'off' ? false : rolledChange;
  const options = NEXT[kind];
  const change = hasChange
    ? { to: options[Math.floor(rand() * options.length)], atSec: 60 + Math.floor(rand() * 180), durationSec: 60 + Math.floor(rand() * 90) }
    : null;
  // Rainy races start on a wet track; an overcast race sometimes follows earlier rain.
  const dampAfterRain = kind === 'overcast' && rand() < 0.3;
  const initialWetness = PARAMS[kind].rain > 0 ? PARAMS[kind].rain : dampAfterRain ? 0.35 : 0;
  return { seed, startHour, timeScale: 6, dayOfYear, kind, change, initialWetness };
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function rainAt(plan: WeatherPlan, t: number): number {
  const a = PARAMS[plan.kind].rain;
  if (!plan.change) return a;
  const k = smooth((t - plan.change.atSec) / plan.change.durationSec);
  return lerp(a, PARAMS[plan.change.to].rain, k);
}

/**
 * Weather at `t` seconds after the race start. Wetness integrates rain with a ~40 s
 * soaking constant and ~240 s drying constant; integrated numerically at 1 s steps so
 * it stays deterministic and cheap (called a few times per second at most).
 */
export function weatherAt(plan: WeatherPlan, tSec: number): WeatherState {
  const t = Math.max(0, tSec);
  const k = plan.change ? smooth((t - plan.change.atSec) / plan.change.durationSec) : 0;
  const a = PARAMS[plan.kind];
  const b = plan.change ? PARAMS[plan.change.to] : a;
  const clouds = lerp(a.clouds, b.clouds, k);
  const fog = lerp(a.fog, b.fog, k);
  const rain = rainAt(plan, t);

  let wet = Math.max(plan.initialWetness, PARAMS[plan.kind].rain);
  const steps = Math.min(Math.floor(t), 3600);
  for (let s = 0; s < steps; s++) {
    const r = rainAt(plan, s);
    wet += r > wet ? (r - wet) / 40 : (r - wet) / 240;
  }
  const frac = t - steps;
  if (frac > 0) {
    const r = rainAt(plan, steps);
    wet += (r > wet ? (r - wet) / 40 : (r - wet) / 240) * frac;
  }
  wet = Math.min(1, Math.max(0, wet));
  const hour = (plan.startHour + (t * plan.timeScale) / 3600) % 24;
  return {
    hour,
    clouds,
    rain,
    fog,
    wetness: wet,
    grip: gripFromWetness(wet, rain),
    visibility: lerp(6000, 140, Math.pow(fog, 0.8)),
  };
}

export function gripFromWetness(wetness: number, rain: number): number {
  // Damp ≈ -10 %, fully wet ≈ -27 %, standing water in heavy rain ≈ -32 %.
  return 1 - 0.27 * wetness - 0.05 * rain * wetness;
}

/** Solar elevation/azimuth in radians for Nürburg (50.33 N, 6.94 E), CEST clock. */
export function sunPosition(dayOfYear: number, hour: number): { elevation: number; azimuth: number } {
  const lat = (50.335 * Math.PI) / 180;
  const decl = ((-23.44 * Math.PI) / 180) * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  // CEST is UTC+2; longitude 6.94E → solar noon ≈ 13:32 local
  const solarHour = hour - 2 + 6.94 / 15;
  const ha = ((solarHour - 12) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const elevation = Math.asin(sinEl);
  const cosAz = (Math.sin(decl) - Math.sin(elevation) * Math.sin(lat)) / (Math.cos(elevation) * Math.cos(lat));
  let azimuth = Math.acos(Math.min(1, Math.max(-1, cosAz)));
  if (ha > 0) azimuth = 2 * Math.PI - azimuth;
  return { elevation, azimuth };
}

export function formatHour(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
