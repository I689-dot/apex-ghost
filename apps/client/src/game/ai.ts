import { nearestCenterlineIndex, progressAt, wrapDelta, type CarSpecs, type TrackData } from '@apex/shared';
import type { Controls } from '../physics/input';
import type { Vehicle } from '../physics/vehicle';
import { laneGeometry } from './pitLane';

const G = 9.81;

/** Bots drive with the assists a GT3 car carries. */
export const BOT_ASSISTS = { abs: true, tc: 2 as const, stability: true, steering: false };

const RHO = 1.225;
/** Fastest throttle application (per second): 0 → full in 0.25 s. */
const THROTTLE_RISE = 4;
/** Distance over which a bot merges from its grid box (or a reset) onto its racing line (m). */
const BLEND_M = 260;
/** How fast a bot moves sideways to pass (m per second of lateral target shift). */
const PASS_RATE = 2.5;
/** Speed into the pit lane entry (m/s, ~30 km/h). */
const ENTRY_MS = 8.3;

/**
 * A racing line: lateral offset of the centreline at every centreline point, found by minimising
 * curvature (iterative smoothing towards the neighbours' midpoint, clamped to the track edges minus a
 * margin). Real drivers use the whole width: out-in-out through corners, straight lines through kinks.
 */
export interface RacingLine {
  /** Line points (x, z) per centreline index. */
  x: Float32Array;
  z: Float32Array;
  /** Lateral offset from the centreline (+ = left), and the allowed range. */
  offset: Float32Array;
  /** Distance from point i to i+1 along the line. */
  ds: Float32Array;
  /** Signed curvature (1/m, + = turning left). */
  curvature: Float32Array;
  /**
   * Where the car's centre may go (m from the centreline, + = left): the asphalt and the flat kerbs beside it, less
   * half a car (tools/sim/raceline.ts, from the collision). Without them, the stored road width less 1.2 m.
   */
  lo?: Float32Array;
  hi?: Float32Array;
  /** A cautious line (minimum curvature 2 m inside the asphalt edges, no kerbs): the bots' own lines blend the two. */
  alt?: Float32Array;
}

/** Left normal of the centreline at each point (cached per track). */
const normalCache = new WeakMap<TrackData, { nx: Float32Array; nz: Float32Array }>();
function normals(track: TrackData): { nx: Float32Array; nz: Float32Array } {
  let c = normalCache.get(track);
  if (c) return c;
  const cl = track.centerline;
  const n = cl.length / 3;
  const nx = new Float32Array(n);
  const nz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = ((i - 1 + n) % n) * 3;
    const b = ((i + 1) % n) * 3;
    const tx = cl[b] - cl[a];
    const tz = cl[b + 2] - cl[a + 2];
    const l = Math.hypot(tx, tz) || 1;
    nx[i] = tz / l;
    nz[i] = -tx / l;
  }
  c = { nx, nz };
  normalCache.set(track, c);
  return c;
}

/**
 * The line's shape from its offsets: points, segment lengths and curvature (a ±10 m three-point stencil, lightly
 * smoothed: the 5 m resampled line still has small kinks). `from`/`to` (inclusive, may wrap) recompute only the
 * part a change of offsets between them reaches.
 */
function shapeLine(track: TrackData, line: RacingLine, raw: Float32Array, from = 0, to = -1): void {
  const cl = track.centerline;
  const n = cl.length / 3;
  const { nx, nz } = normals(track);
  const { x, z, offset: off, ds, curvature } = line;
  const all = to < 0;
  const span = all ? n : Math.min(n, to - from + 1);
  const each = (a: number, len: number, f: (i: number) => void) => {
    for (let k = 0; k < Math.min(n, len); k++) f((((a + k) % n) + n) % n);
  };
  each(from, span, (i) => {
    x[i] = cl[i * 3] + nx[i] * off[i];
    z[i] = cl[i * 3 + 2] + nz[i] * off[i];
  });
  each(from - 1, span + 1, (i) => {
    const j = (i + 1) % n;
    ds[i] = Math.hypot(x[j] - x[i], z[j] - z[i]) || 0.01;
  });
  const k = 2; // ±10 m stencil
  each(from - k, span + 2 * k, (i) => {
    const a = (i - k + n) % n;
    const c = (i + k) % n;
    const abx = x[i] - x[a];
    const abz = z[i] - z[a];
    const bcx = x[c] - x[i];
    const bcz = z[c] - z[i];
    const cross = abx * bcz - abz * bcx;
    const la = Math.hypot(abx, abz);
    const lb = Math.hypot(bcx, bcz);
    const lc = Math.hypot(x[a] - x[c], z[a] - z[c]);
    // x/z with +X left: a left turn has a negative cross product in this frame
    raw[i] = la * lb * lc > 1e-6 ? (-2 * cross) / (la * lb * lc) : 0;
  });
  each(from - k - 1, span + 2 * k + 2, (i) => {
    curvature[i] = (raw[(i - 1 + n) % n] + 2 * raw[i] + raw[(i + 1) % n]) / 4;
  });
}

/** A racing line from its lateral offsets (m from the centreline, + = left). */
export function lineFromOffsets(track: TrackData, offset: Float32Array): RacingLine {
  const n = track.centerline.length / 3;
  const line: RacingLine = { x: new Float32Array(n), z: new Float32Array(n), offset, ds: new Float32Array(n), curvature: new Float32Array(n) };
  shapeLine(track, line, new Float32Array(n));
  return line;
}

/**
 * Minimum curvature line (the classic approximation of the fastest line: iterative smoothing towards the neighbours'
 * midpoint, clamped to the track edges minus `margin`, or to `bounds` when given).
 */
export function buildRacingLine(track: TrackData, margin = 2.0, iterations = 3000, bounds?: { lo: Float32Array; hi: Float32Array }): RacingLine {
  const cl = track.centerline;
  const n = cl.length / 3;
  const { nx, nz } = normals(track);
  const lo = new Float32Array(n);
  const hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lo[i] = bounds ? bounds.lo[i] : -Math.max(0, track.widthR[i] - margin);
    hi[i] = bounds ? bounds.hi[i] : Math.max(0, track.widthL[i] - margin);
  }
  const off = new Float32Array(n);
  for (let i = 0; i < n; i++) off[i] = Math.min(hi[i], Math.max(lo[i], 0));
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const place = (i: number) => {
    x[i] = cl[i * 3] + nx[i] * off[i];
    z[i] = cl[i * 3 + 2] + nz[i] * off[i];
  };
  for (let i = 0; i < n; i++) place(i);
  // coarse-to-fine: wide stencils settle the long-scale shape, narrow ones the local detail
  for (const k of [8, 4, 2, 1]) {
    for (let it = 0; it < iterations / 4; it++) {
      for (let i = 0; i < n; i++) {
        const a = (i - k + n) % n;
        const b = (i + k) % n;
        const mx = (x[a] + x[b]) / 2;
        const mz = (z[a] + z[b]) / 2;
        const want = (mx - cl[i * 3]) * nx[i] + (mz - cl[i * 3 + 2]) * nz[i];
        let o = off[i] + (want - off[i]) * 0.6;
        o = o < lo[i] ? lo[i] : o > hi[i] ? hi[i] : o;
        off[i] = o;
        place(i);
      }
    }
  }
  return lineFromOffsets(track, off);
}

/** A small seeded random generator (mulberry32): the same bot drives the same way every session. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());

/**
 * Minimum lap time line, as the race engineers' lap-time simulations find it (TUM's global trajectory optimisation:
 * a minimum-curvature line is only an approximation; the time-optimal one is up to a few % faster). Starting from a
 * line inside `lo`…`hi`, smooth bumps of offset (30-260 m long, raised cosine) are tried one at a time and kept when
 * the quasi-steady-state lap time (speedProfile with the power-limited acceleration pass) improves, with a small
 * penalty on curvature changes so the line stays drivable. What it learns is what drivers are taught: before a long
 * straight the car turns in later, apexes later and opens the exit (the exit speed is carried down the whole straight);
 * where a corner leads into a braking zone the entry matters more; compromise the first of two corners for the second.
 *
 * Offline (tools/sim/raceline.ts): a few hundred thousand lap evaluations.
 */
export function optimiseLapTime(
  track: TrackData,
  start: Float32Array,
  lo: Float32Array,
  hi: Float32Array,
  car: CarLimits,
  evals: number,
  seed = 1,
  onProgress?: (e: number, lapS: number) => void,
): Float32Array {
  const n = track.centerline.length / 3;
  // the offsets tried (`off`), and the line scored: their 5-point (25 m) moving average. A car drives no kink shorter
  // than that (and the ±10 m curvature stencil sees the odd and the even points apart: scored on the raw offsets, the
  // search found "lines" 20 s faster made of kinks the stencil misread)
  const off = Float32Array.from(start, (v, i) => Math.min(hi[i], Math.max(lo[i], v)));
  const sm = new Float32Array(n);
  const H = 2;
  const smooth = (i: number) => {
    let a = 0;
    for (let d = -H; d <= H; d++) a += off[(i + d + n) % n];
    sm[i] = Math.min(hi[i], Math.max(lo[i], a / (2 * H + 1)));
  };
  for (let i = 0; i < n; i++) smooth(i);
  const line: RacingLine = { x: new Float32Array(n), z: new Float32Array(n), offset: sm, ds: new Float32Array(n), curvature: new Float32Array(n) };
  const raw = new Float32Array(n);
  shapeLine(track, line, raw);
  // the line's smoothness: the change of curvature per point, squared (a zig-zag the 10 m stencil hardly sees still
  // turns the wheel)
  const LAMBDA = 60;
  const cost = () => {
    let rough = 0;
    const c = line.curvature;
    for (let i = 0; i < n; i++) {
      const d = c[(i + 1) % n] - c[i];
      rough += d * d;
    }
    return profileLapTime(line, speedProfile(line, car, 1, true)) + LAMBDA * rough;
  };
  const restyle = (c: number, w: number) => {
    for (let d = -w - H; d <= w + H; d++) smooth((c + d + n) % n);
    shapeLine(track, line, raw, c - w - H, c + w + H);
  };
  let best = cost();
  const rnd = seededRandom(seed);
  const WIDTHS = [3, 5, 8, 12, 18, 26];
  const saved = new Float32Array(2 * 26 + 1);
  for (let e = 0; e < evals; e++) {
    const sigma = 0.05 + 0.55 * (1 - e / evals);
    const w = WIDTHS[Math.floor(rnd() * WIDTHS.length)];
    const c = Math.floor(rnd() * n);
    const amp = gauss(rnd) * sigma;
    let moved = false;
    for (let d = -w; d <= w; d++) {
      const i = (c + d + n) % n;
      saved[d + w] = off[i];
      const b = 0.5 * (1 + Math.cos((Math.PI * d) / (w + 1)));
      const o = Math.min(hi[i], Math.max(lo[i], off[i] + amp * b));
      if (o !== off[i]) moved = true;
      off[i] = o;
    }
    if (!moved) continue;
    restyle(c, w);
    const t = cost();
    if (t < best - 1e-7) best = t;
    else {
      for (let d = -w; d <= w; d++) off[(c + d + n) % n] = saved[d + w];
      restyle(c, w);
    }
    if (onProgress && e % 5000 === 0) onProgress(e, best);
  }
  return Float32Array.from(sm);
}

/** A racing line file (assets/racelines/<layout>.json, tools/sim/raceline.ts): offsets in cm per centreline point. */
export interface RacelineFile {
  v: 1;
  id: string;
  n: number;
  length: number;
  /** The fastest line (minimum lap time, kerbs used), the cautious line, the car centre's bounds. */
  opt: number[];
  alt: number[];
  lo: number[];
  hi: number[];
}

/** The racing line from its file, or null when the file is for another version of the layout. */
export function racingLineFromFile(track: TrackData, f: RacelineFile): RacingLine | null {
  const n = track.centerline.length / 3;
  if (!f || f.v !== 1 || f.n !== n || Math.abs(f.length - track.length) > 1 || [f.opt, f.alt, f.lo, f.hi].some((a) => a?.length !== n)) return null;
  const line = lineFromOffsets(
    track,
    Float32Array.from(f.opt, (v) => v / 100),
  );
  line.alt = Float32Array.from(f.alt, (v) => v / 100);
  line.lo = Float32Array.from(f.lo, (v) => v / 100);
  line.hi = Float32Array.from(f.hi, (v) => v / 100);
  return line;
}

/**
 * How a bot drives (seeded per bot, so the same bot is the same driver every session): drivers differ in pace, in the
 * line they take (the time-optimal line using the kerbs, the cautious geometric one, or between), where they brake,
 * how much they trust the downforce in fast corners, how they squeeze the throttle, how keen they are to pass, how
 * consistent they are lap to lap (and how often they make a mistake), and how they cope in the wet.
 */
export interface BotPersona {
  /** Where in the field's pace spread (0 slowest … 1 fastest). */
  pace: number;
  /** Share of the fastest line in its own (the rest the cautious line): 0.3 … 1. */
  line: number;
  /** Braking grip it plans with (late brakers above 1). */
  brake: number;
  /** Downforce it trusts in fast corners. */
  aero: number;
  /** How fast it squeezes the throttle on (full in 1 / rise s). */
  throttleRise: number;
  /** 0 patient … 1 opportunist: how early it pulls out to pass. */
  aggression: number;
  /** 0 erratic … 1 metronome: corner-to-corner and lap-to-lap variation and how often it makes a mistake. */
  consistency: number;
  /** Wet-weather skill (grip it dares to use in the wet). */
  wet: number;
}

/** A neutral driver: the fastest line, no variation, no mistakes (the tools' tests). */
export const NEUTRAL_PERSONA: BotPersona = { pace: 1, line: 1, brake: 1, aero: 1, throttleRise: THROTTLE_RISE, aggression: 0.5, consistency: 1, wet: 1 };

export function botPersona(seed: number): BotPersona {
  const r = seededRandom(Math.imul(seed, 2654435761) ^ 0x5bd1e995);
  return {
    pace: r(),
    line: 0.3 + 0.7 * r(),
    brake: 0.95 + 0.07 * r(),
    aero: 0.96 + 0.08 * r(),
    throttleRise: 3 + 3 * r(),
    aggression: r(),
    consistency: 0.35 + 0.65 * r(),
    wet: 0.97 + 0.06 * r(),
  };
}

/** A string's hash (FNV-1a): a bot's persona seed from its id. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** What the speed profile needs to know about the car. */
export interface CarLimits {
  massKg: number;
  /** Effective friction coefficient of the whole car (≈ 0.8 × tyre peak μ after load transfer). */
  mu: number;
  /** Braking friction coefficient (ABS keeps the tyres near their peak). */
  muBrake: number;
  dragArea: number;
  downforceArea: number;
  /** Wheel power (W) for the acceleration pass. */
  powerW: number;
  vMax: number;
  /** Air density (kg/m³): downforce and drag at this circuit's altitude and temperature. */
  airDensity: number;
}

/**
 * Share of the tyres' grip the bots plan with, cornering and braking (tools/sim/ailap.ts tunes it: AI_CORNER, AI_BRAKE).
 * Tuned on the shipped lap-time-optimised lines (Spa, Porsche 992, skill 0.97: 0.80 / 0.92 → 2:27.3, nothing hit, no
 * track-limit warning; 0.86 brushed walls, 0.92 spun). The old minimum-curvature line hid how much this was: its
 * curvature spikes slowed the bots in the fast corners whatever the grip.
 */
export const AI_GRIP = { corner: 0.8, brake: 0.92 };

export function carLimits(specs: CarSpecs, skill = 1, airDensity = RHO): CarLimits {
  return {
    airDensity,
    massKg: specs.massKg,
    mu: specs.tyreGrip * AI_GRIP.corner * skill,
    muBrake: specs.tyreGrip * AI_GRIP.brake * skill,
    dragArea: specs.dragArea,
    downforceArea: specs.downforceArea,
    powerW: specs.powerKw * 1000 * 0.85,
    vMax: specs.topSpeedKmh / 3.6,
  };
}

/**
 * Quasi-steady-state speed profile along the racing line:
 *  - cornering limit with downforce: v²·κ = μ·(g + k·v²), k = ½ρ·ClA / m;
 *  - a backward pass for braking that shares grip with cornering (friction ellipse) and adds drag;
 *  - optionally a forward pass for power-limited acceleration (for lap-time estimates).
 */
export function speedProfile(line: RacingLine, car: CarLimits, weatherGrip = 1, forward = false): Float32Array {
  const n = line.ds.length;
  const v = new Float32Array(n);
  const k = (0.5 * car.airDensity * car.downforceArea) / car.massKg;
  const kd = (0.5 * car.airDensity * car.dragArea) / car.massKg;
  const mu = car.mu * weatherGrip;
  const muB = car.muBrake * weatherGrip;
  for (let i = 0; i < n; i++) {
    const kap = Math.abs(line.curvature[i]);
    const den = kap - mu * k;
    v[i] = den <= 1e-6 ? car.vMax : Math.min(car.vMax, Math.sqrt((mu * G) / den));
  }
  const avail = (i: number, vv: number, m: number) => {
    const grip = m * (G + k * vv * vv);
    const lat = vv * vv * Math.abs(line.curvature[i]);
    return Math.sqrt(Math.max(0, grip * grip - lat * lat));
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = n - 1; j >= 0; j--) {
      const next = (j + 1) % n;
      const vn = v[next];
      const dec = avail(next, vn, muB) + kd * vn * vn;
      v[j] = Math.min(v[j], Math.sqrt(vn * vn + 2 * dec * line.ds[j]));
    }
  }
  if (forward) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const vi = Math.max(v[i], 1);
        const acc = Math.min(car.powerW / (car.massKg * vi), avail(i, vi, mu)) - kd * vi * vi - 0.013 * G;
        v[next] = Math.min(v[next], Math.sqrt(Math.max(0, vi * vi + 2 * acc * line.ds[i])));
      }
    }
  }
  return v;
}

/** Lap time (s) of a quasi-steady-state profile (forward pass included). */
export function profileLapTime(line: RacingLine, v: Float32Array): number {
  let t = 0;
  for (let i = 0; i < v.length; i++) t += line.ds[i] / Math.max(1, (v[i] + v[(i + 1) % v.length]) / 2);
  return t;
}

/** Racing lines are the same for every car: build once per track. */
let lineCache: { track: TrackData; line: RacingLine } | null = null;
export function racingLineFor(track: TrackData): RacingLine {
  if (lineCache?.track !== track) lineCache = { track, line: buildRacingLine(track) };
  return lineCache.line;
}

/** Store a racing line built elsewhere (racingLinePrep.ts: in a worker while the session downloads). */
export function primeRacingLine(track: TrackData, line: RacingLine): void {
  if (lineCache?.track !== track) lineCache = { track, line };
}

/** Another car, as the traffic logic sees it: position, speed (m/s) and heading (unit x / z). */
export interface TrafficCar {
  x: number;
  y: number;
  z: number;
  speed: number;
  fx: number;
  fz: number;
}

/** What the cars around a bot leave it: a speed cap, the room either side, the car to pass, one alongside. */
export interface TrafficView {
  cap: number;
  roomL: number;
  roomR: number;
  block: { along: number; lat: number } | null;
  beside: boolean;
}

/** Lateral offset of a pass (m). */
export const PASS_OFFSET = 3.6;

/**
 * Traffic for a bot (the racecraft of the sims' AI and the racing rules: Sony's GT Sophy, the "attacker / defender"
 * space rules):
 *  - a car ahead in its path: never closer than it can stop behind (its speed, the gap past 8.5 m, 8 m/s² of
 *    braking), looked for as far as its own stopping distance;
 *  - a car alongside (any overlap of the two bodies): that side is a wall a car's width away (2.3 m between
 *    centres), and moving away from one that is too close, at most 0.8 m;
 *  - a faster car coming up behind, already on one side: it keeps that side (no closing the door);
 *  - a slower car ahead it may pass (`block`), and whether one is beside it (to hold its side while passing).
 * `passing`: the bot is pulled out to pass (its path is narrower).
 */
export function trafficView(me: TrafficCar, passing: boolean, others: TrafficCar[]): TrafficView {
  const { fx, fz } = me;
  let cap = Infinity;
  let block: { along: number; lat: number } | null = null;
  let beside = false;
  let roomL = Infinity;
  let roomR = Infinity;
  const range = Math.max(40, (me.speed * me.speed) / 16 + 15);
  for (const o of others) {
    // not the same piece of road: a car on the other leg of a hairpin (driving the other way) or on a bridge /
    // underpass looked like a car ahead, and the bots braked for nothing; a stopped car is avoided whichever way
    if (Math.abs(o.y - me.y) > 2.5 || (o.speed > 5 && o.fx * fx + o.fz * fz < 0.3)) continue;
    const dx = o.x - me.x;
    const dz = o.z - me.z;
    const along = dx * fx + dz * fz;
    const lat = dx * fz - dz * fx; // + = left of the bot
    if (Math.abs(along) < 5.2 && Math.abs(lat) < 4.2) {
      const room = Math.max(-0.8, Math.abs(lat) - 2.3);
      if (lat > 0) roomL = Math.min(roomL, room);
      else roomR = Math.min(roomR, room);
    } else if (along <= -5.2 && along > -14 && o.speed > me.speed + 1.5 && Math.abs(lat) > 1.1 && Math.abs(lat) < 4.2) {
      const room = Math.max(0, Math.abs(lat) - 2.3);
      if (lat > 0) roomL = Math.min(roomL, room);
      else roomR = Math.min(roomR, room);
    }
    // alongside on the side we moved to: hold that side until it is behind us; and while pulled out to pass, the
    // car being passed is still ahead of us a lane over (it left the "in our path" check once we moved out, and the
    // pass was given up a second later, still behind it: the bots never got past a slower car)
    if (along > -6 && along <= 3 && Math.abs(lat) < 3.4) beside = true;
    if (passing && along > 0 && along < 30 && Math.abs(lat) < 6.5) beside = true;
    if (along <= 0 || along > range || Math.abs(lat) > 2.6) continue;
    if (Math.abs(lat) < (passing ? 2.05 : 2.3)) {
      // 8 m/s² and 8.5 m: a GT3 ahead brakes at up to 15 m/s², and at 10 / 7.5 the bots still ran into the back
      // of one that braked earlier and harder than they expected (tools/sim/traffic.ts)
      const c = along > 8.5 ? Math.sqrt(o.speed * o.speed + 2 * 8 * (along - 8.5)) : Math.max(0, o.speed - (8.5 - along) * 1.5);
      cap = Math.min(cap, c);
    }
    if (along <= 3 || along > 40 || (o.speed > me.speed - 1.5 && along > 14)) continue; // as fast as us and not close: just follow
    if (!block || along < block.along) block = { along, lat };
  }
  return { cap, roomL, roomR, block, beside };
}

/** Racing AI: pure-pursuit steering along the racing line (plus its own small offset) and a speed profile. */
export class AiDriver {
  readonly controls: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, digital: false };
  private profile: Float32Array;
  private profileGrip = 1;
  private readonly line: RacingLine;
  private readonly limits: CarLimits;
  private hint = -1;
  private stuck = 0;
  private wrongWay = 0;
  private offTrack = 0;
  /** Set when the AI teleported itself back onto the track (forwarded as the reset flag). */
  resetRequested = false;
  dbgVt = 0;
  /**
   * Joining the racing line: from the grid (or a reset) the bot first holds the line it stands on and merges
   * onto its racing line over BLEND_M. Steering straight for the line at the green light swerved every car
   * across the grid, through the cars still waiting in their boxes.
   */
  private blendOff = 0;
  private blendLeft = 0;
  private needBlend = true;
  /** Passing: lateral offset (m, + = left) asked for by the traffic logic, and the one applied now. */
  passTarget = 0;
  private passOff = 0;
  private laneNow = 0;
  private roomy = 1;
  /**
   * Room beside it (m it may move its path left / right of where it is now), set each step by the traffic logic
   * (session.followCap): a car alongside is a wall a car's width away, and a faster car coming up on one side is
   * left its side (the racing rule: no moving across into a car that is already there, no squeezing it off).
   */
  roomL = Infinity;
  roomR = Infinity;
  /** How far the room beside it pushed it off its line (m): it lifts a little for the tighter line. */
  private squeeze = 0;
  /**
   * Pit stop asked for by the session: stop in the box, or straight through (a drive-through). The bot brakes for
   * the entry, follows the lane's centre line at the limiter, stops at `pitBox` (a lane point) until pitServed(),
   * and merges back onto its racing line after the exit.
   */
  pitRequest: 'stop' | 'through' | null = null;
  pitBox = 0;
  /** How far its box is from the traced lane, towards the garage (m: PitLaneMonitor.measureBoxes). */
  pitBoxShift = 0;
  inPitLane = false;
  private boxDone = false;
  /** Where along the pit lane the car is (lane point index). */
  get laneIndex(): number {
    return this.laneIdx;
  }

  private laneIdx = 0;
  private laneStuck = 0;

  /** Lap-to-lap variation: a speed factor per 150 m of the lap (drawn again each lap), and this lap's mistake. */
  private noise: Float32Array | null = null;
  private mistake: { apexS: number; kind: 'late' | 'exit' } | null = null;
  private readonly rnd: () => number;

  constructor(
    private readonly track: TrackData,
    private readonly vehicle: Vehicle,
    /** 0.82 (slow) … 0.97 (fast) */
    readonly skill: number,
    /** extra lateral offset from the racing line (m, + = left), so bots don't drive in single file */
    private readonly lane: number,
    readonly persona: BotPersona = NEUTRAL_PERSONA,
    seed = 1,
  ) {
    const base = racingLineFor(track);
    // its own line: between the fastest line and the cautious one (both inside the same bounds, so is the blend)
    if (base.alt && persona.line < 0.995) {
      const w = persona.line;
      const own = lineFromOffsets(
        track,
        Float32Array.from(base.offset, (o, i) => base.alt![i] + (o - base.alt![i]) * w),
      );
      own.lo = base.lo;
      own.hi = base.hi;
      this.line = own;
    } else this.line = base;
    this.limits = carLimits(vehicle.specs, skill, vehicle.airDensity);
    this.limits.muBrake *= persona.brake;
    this.limits.downforceArea *= persona.aero;
    this.profile = speedProfile(this.line, this.limits);
    this.rnd = seededRandom(seed);
  }

  /**
   * A new lap: the corner-to-corner variation drawn again (σ 0.2 % for a metronome … 1.5 % for an erratic driver), and
   * perhaps a mistake somewhere on it (a late braking that runs wide, or a slow, scrappy exit), more likely for an
   * inconsistent driver and on a wet track.
   */
  private newLap(weatherGrip: number): void {
    const p = this.persona;
    if (p.consistency >= 0.999) return;
    const L = this.track.length;
    const bins = Math.ceil(L / 150) + 1;
    const sigma = 0.002 + 0.013 * (1 - p.consistency);
    this.noise ??= new Float32Array(bins);
    for (let k = 0; k < bins; k++) this.noise[k] = 1 + Math.max(-2.5, Math.min(2.5, gauss(this.rnd))) * sigma;
    this.mistake = null;
    const chance = (0.03 + 0.25 * (1 - p.consistency)) * (weatherGrip < 0.9 ? 2 : 1);
    if (this.rnd() < chance) {
      // the next real corner (a slow point of the profile) after a random place on the lap
      const n = this.profile.length;
      const vMax = this.limits.vMax;
      let i = Math.floor(this.rnd() * n);
      for (let k = 0; k < n; k++, i = (i + 1) % n) {
        const v = this.profile[i];
        if (v < 0.75 * vMax && v <= this.profile[(i + 3) % n] && v <= this.profile[(i - 3 + n) % n]) break;
      }
      this.mistake = { apexS: this.track.cumS[i] ?? 0, kind: this.rnd() < 0.55 ? 'late' : 'exit' };
    }
  }

  /** This bot's variation of the planned speed at lap distance s (1: as planned). */
  private variation(s: number, vt: number, inTraffic: boolean): number {
    let f = 1;
    if (this.noise && vt < this.limits.vMax * 0.93) {
      const u = (((s % this.track.length) + this.track.length) % this.track.length) / 150;
      const k = Math.floor(u);
      const a = this.noise[k % this.noise.length];
      const b = this.noise[(k + 1) % this.noise.length];
      f *= a + (b - a) * (u - k);
    }
    const m = this.mistake;
    if (m) {
      const d = wrapDelta(s, m.apexS, this.track.length);
      // never with a car close by (a mistake there takes someone else out: it waits for the next lap)
      if (inTraffic && d > 0 && d < 160) this.mistake = null;
      else if (m.kind === 'late' && d > -15 && d < 140) f *= d > 0 ? 1.065 : 1.035;
      else if (m.kind === 'exit' && d <= 0 && d > -110) f *= 0.9;
    }
    return f;
  }

  private lastS = 0;

  private passHold = 0;

  /**
   * The traffic around it (trafficView): the room either side, and passing: a slower car ahead makes it pull out
   * on the side away from it (where there is room, not into a corner) and keep that side until the car is behind.
   * No overtaking under a caution.
   */
  applyTraffic(view: TrafficView, caution: boolean, dt: number): void {
    this.roomL = view.roomL;
    this.roomR = view.roomR;
    const found = caution ? null : view.block;
    if (found && (this.passTarget !== 0 || this.canPass())) {
      if (this.passTarget === 0) this.passTarget = found.lat > 0.3 ? -PASS_OFFSET : found.lat < -0.3 ? PASS_OFFSET : this.roomySide() * PASS_OFFSET;
      this.passHold = 1;
    } else if (view.beside && this.passTarget !== 0) this.passHold = 1;
    else if ((this.passHold -= dt) <= 0) this.passTarget = 0;
  }

  /**
   * Room to pass: no corner or braking zone close ahead. Real passes are made down a straight in the slipstream and
   * finished on the brakes (alongside by the braking point, then braking later than the car being passed), so on a
   * dry track only the next 1.4 s of road must be free of a big slow-down (a fixed 150 m kept the bots stuck behind a
   * slower car for whole races: no straight at Zandvoort is clear for 150 m before its corner and there is no pass
   * without a corner); in the wet, 150 m as before (pulling out mid-corner in the wet spun bots).
   */
  canPass(): boolean {
    const v = this.vehicle.telemetry.speed;
    // an opportunist pulls out with 1.1 s of clear road, a patient driver waits for 1.7 s
    const horizon = this.profileGrip < 0.92 ? 150 : Math.max(50, Math.min(150, v * (1.7 - 0.6 * this.persona.aggression)));
    for (let d = 0; d <= horizon; d += 10) if (this.profile[indexAt(this.track, this.lastS + d)] < Math.max(v, 20) * 0.92) return false;
    return true;
  }

  /** Stopped at its box, waiting for the crew. */
  get atBox(): boolean {
    return this.inPitLane && this.pitRequest === 'stop' && !this.boxDone && this.vehicle.telemetry.speed < 0.5 && this.laneIdx >= this.pitBox - 4;
  }

  /** The crew is done: drive on to the pit exit. */
  pitServed(): void {
    this.boxDone = true;
  }

  /**
   * Towed (iRacing's tow after a wreck): put standing in its box, waiting for its crew; it drives out to the pit exit
   * once served, as after a stop. False without a pit lane.
   */
  towToBox(): boolean {
    const lane = this.track.pitLane;
    if (!lane || lane.points.length < 4) return false;
    const pts = lane.points;
    const k = clamp(this.pitBox, 1, pts.length - 3);
    const [ax, az] = laneGeometry(this.track).away[k];
    const yaw = Math.atan2(pts[k + 1][0] - pts[k][0], pts[k + 1][2] - pts[k][2]);
    this.vehicle.place(pts[k][0] + ax * this.pitBoxShift, pts[k][1] + 0.3, pts[k][2] + az * this.pitBoxShift, yaw);
    this.vehicle.setWalls(false);
    this.inPitLane = true;
    this.laneIdx = k;
    this.laneStuck = 0;
    this.boxDone = false;
    this.pitRequest = 'stop';
    this.passTarget = 0;
    this.stuck = this.offTrack = this.wrongWay = 0;
    this.hint = -1;
    this.needBlend = true;
    return true;
  }

  /** Pit lane target point and speed, or null when not pitting (`follow` false: still on track, braking for the entry). */
  private pitPath(dt: number, x: number, z: number, s: number, speed: number): { follow: boolean; x: number; z: number; v: number } | null {
    const lane = this.track.pitLane;
    if (!lane || (!this.pitRequest && !this.inPitLane)) return null;
    const pts = lane.points;
    const n = pts.length;
    const limit = lane.speedLimitKmh / 3.6 - 0.8;
    if (!this.inPitLane) {
      // slow for the entry on the racing line, aiming for the lane from 50 m (from further back the straight line to
      // the lane's first point cut the chicane before the Nürburgring's entry). The traced lane is only roughly where the real one is
      // (the Nürburgring's jumps 6 m sideways in 2 m where it leaves the track, right at the end of the pit wall),
      // so in the lane the car's body ignores the circuit's walls: following the trace, the bots clipped a wall's
      // end, ran on the wrong side of it and stuck; now they may brush through a corner of one instead.
      const d = wrapDelta(s, lane.entryS, this.track.length);
      if (d < 0 || d > 600) return null;
      const v = Math.sqrt(ENTRY_MS * ENTRY_MS + 2 * 6 * Math.max(0, d - 10));
      if (d > 50) return { follow: false, x: 0, z: 0, v };
      this.inPitLane = true;
      this.laneIdx = 0;
      this.boxDone = false;
      this.laneStuck = 0;
      this.vehicle.setWalls(false);
    }
    // where along the lane (only once on it: from the approach a point far into the lane can be the nearest)
    let best = Infinity;
    let bi = this.laneIdx;
    for (let i = Math.max(0, this.laneIdx - 3); i < Math.min(n, this.laneIdx + 30); i++) {
      const d = (pts[i][0] - x) ** 2 + (pts[i][2] - z) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (best < 15 * 15) this.laneIdx = bi;
    if (this.laneIdx >= n - 3) {
      // back on the circuit: onto the racing line again
      this.inPitLane = false;
      this.pitRequest = null;
      this.needBlend = true;
      this.vehicle.setWalls(true);
      return null;
    }
    const step = lane.length / (n - 1) || 2.5;
    const k = Math.min(n - 1, this.laneIdx + Math.max(2, Math.round((3 + 0.12 * speed) / step)));
    // through the entry jink slowly, then at the limiter
    let v = this.laneIdx < 8 ? ENTRY_MS : limit;
    if (this.pitRequest === 'stop' && !this.boxDone) {
      const d = (this.pitBox - this.laneIdx) * step;
      v = d <= 0.5 ? 0 : Math.min(v, Math.sqrt(2 * 3.5 * (d - 0.5)));
    }
    // safety net: held up against something in the lane (not waiting at the box) → back onto the lane's line, a
    // few metres on (the traced entries are rough: a bot can still catch a kerb or ledge at the Nürburgring's)
    this.laneStuck = v > 0 && speed < 1 ? this.laneStuck + dt : 0;
    if (this.laneStuck > 2.5) {
      const j = Math.min(n - 2, this.laneIdx + 2);
      const yaw = Math.atan2(pts[j + 1][0] - pts[j][0], pts[j + 1][2] - pts[j][2]);
      this.vehicle.place(pts[j][0], pts[j][1] + 0.3, pts[j][2], yaw);
      this.laneStuck = 0;
      this.resetRequested = true;
    }
    // across to the box in front of the garage over the last 12 m, back to the lane line over 15 m after it
    let w = 0;
    if (this.pitRequest === 'stop' && this.pitBoxShift > 0)
      w = this.boxDone ? clamp(1 - ((k - this.pitBox) * step) / 15, 0, 1) : clamp(1 - ((this.pitBox - k) * step) / 12, 0, 1);
    const [ax, az] = w > 0 ? laneGeometry(this.track).away[k] : [0, 0];
    return { follow: true, x: pts[k][0] + ax * this.pitBoxShift * w, z: pts[k][2] + az * this.pitBoxShift * w, v };
  }

  /** The side (+1 left, −1 right) with more track beside the line here. */
  roomySide(): number {
    return this.roomy;
  }

  /**
   * @param checkpointS lap distance of the last gate this bot passed (resets go there, like a player's reset,
   *   so the race tracker keeps counting its gates); without it the bot resets 10 m behind where it is.
   * @param speedCap highest speed allowed now (m/s): a car directly ahead.
   */
  update(dt: number, raceStarted: boolean, weatherGrip: number, checkpointS?: number, speedCap = Infinity): Controls {
    const c = this.controls;
    const v = this.vehicle;
    const t = this.track;
    const p = v.body.translation();
    const speed = v.telemetry.speed;
    const i = nearestCenterlineIndex(t, p.x, p.y, p.z, this.hint, 30);
    this.hint = i;
    const s = progressAt(t, i, p.x, p.z);
    const cl = t.centerline;
    const n = cl.length / 3;
    if (this.needBlend) {
      // where the car stands relative to its own racing line (+ = left)
      const k2 = (i + 1) % n;
      let ux = cl[k2 * 3] - cl[i * 3];
      let uz = cl[k2 * 3 + 2] - cl[i * 3 + 2];
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul;
      uz /= ul;
      this.blendOff = (p.x - this.line.x[i]) * uz - (p.z - this.line.z[i]) * ux - this.lane;
      this.blendLeft = BLEND_M;
      this.needBlend = false;
    }
    if (raceStarted) this.blendLeft = Math.max(0, this.blendLeft - speed * dt);
    const u = this.blendLeft / BLEND_M;
    const merge = this.blendOff * u * u * (3 - 2 * u);
    this.passOff += clamp(this.passTarget - this.passOff, -PASS_RATE * dt, PASS_RATE * dt);

    // target point ahead on the racing line (interpolated between line points)
    const L = this.line;
    const look = 4.5 + 0.24 * speed;
    const sa = s + look;
    const j = indexAt(t, sa);
    const j2 = (j + 1) % n;
    const segS = j2 === 0 ? t.length - t.cumS[j] : t.cumS[j2] - t.cumS[j];
    const f = clamp(((((sa % t.length) + t.length) % t.length) - t.cumS[j]) / (segS || 1), 0, 1);
    let tx = cl[j2 * 3] - cl[j * 3];
    let tz = cl[j2 * 3 + 2] - cl[j * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // the line plus lane, merge and passing offsets, kept on the asphalt (1.2 m inside the edges)
    const lineOff = L.offset[j] + (L.offset[j2] - L.offset[j]) * f;
    // the bot's own lane only on straights: shifted through a corner its path is tighter than the line the speed
    // profile was made for (a Ferrari 1.8 m to the side overheated its rear tyres, spun and ran wide every lap).
    // It moves back onto the line before a corner (radius under ~300 m within 120 m), 4 cm per metre travelled.
    let kMax = 0;
    for (let d = 0; d <= 120; d += 10) kMax = Math.max(kMax, Math.abs(L.curvature[indexAt(t, s + d)]));
    const laneTarget = this.lane * clamp(1 - kMax * 300, 0, 1);
    const laneStep = 0.04 * Math.max(speed, 5) * dt;
    this.laneNow += clamp(laneTarget - this.laneNow, -laneStep, laneStep);
    const lane = this.laneNow;
    // kept where the car fits: the asphalt and flat kerbs (the line file's bounds), else 1.2 m inside the edges
    const loB = L.lo ? Math.min(L.lo[j], lineOff) : -t.widthR[j] + 1.2;
    const hiB = L.hi ? Math.max(L.hi[j], lineOff) : t.widthL[j] - 1.2;
    let want = clamp(lineOff + lane + merge + this.passOff, loB, hiB);
    if (this.roomL < Infinity || this.roomR < Infinity) {
      // where the car is across the road now (+ = left of the centreline), and the room the cars beside leave
      const iN = (i + 1) % n;
      let ix = cl[iN * 3] - cl[i * 3];
      let iz = cl[iN * 3 + 2] - cl[i * 3 + 2];
      const il = Math.hypot(ix, iz) || 1;
      ix /= il;
      iz /= il;
      const myOff = (p.x - cl[i * 3]) * iz - (p.z - cl[i * 3 + 2]) * ix;
      const held = clamp(want, myOff - this.roomR, myOff + this.roomL);
      this.squeeze = Math.abs(held - want);
      want = clamp(held, Math.min(loB, -t.widthR[j] + 0.9), Math.max(hiB, t.widthL[j] - 0.9));
    } else this.squeeze = 0;
    const extra = want - lineOff;
    this.roomy = t.widthL[j] - lineOff > t.widthR[j] + lineOff ? 1 : -1;
    let px = L.x[j] + (L.x[j2] - L.x[j]) * f + tz * extra;
    let pz = L.z[j] + (L.z[j2] - L.z[j]) * f - tx * extra;
    const pit = this.pitPath(dt, p.x, p.z, s, speed);
    if (pit?.follow) {
      px = pit.x;
      pz = pit.z;
    }

    // into the car frame (+X left, +Z forward)
    const q = v.body.rotation();
    const fx = 2 * (q.x * q.z + q.y * q.w);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const lx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const lz = 2 * (q.x * q.z - q.y * q.w);
    const dx = px - p.x;
    const dz = pz - p.z;
    const localZ = dx * fx + dz * fz;
    const localX = dx * lx + dz * lz;
    const alpha = Math.atan2(localX, Math.max(0.5, localZ));
    let steerAngle = Math.atan((2 * v.wheelbase * Math.sin(alpha)) / Math.hypot(localX, localZ));
    // Same physical limit as the keyboard driver: keep the front tyres just below their peak slip angle.
    // Measured from the front axle's velocity direction, so it also counter-steers when the rear slides.
    const lin = v.body.linvel();
    const vF = lin.x * fx + lin.z * fz;
    const vL = lin.x * lx + lin.z * lz;
    const yawRate = v.body.angvel().y;
    let slide = 0;
    if (vF > 4) {
      const betaF = Math.atan2(vL + 0.5 * v.wheelbase * yawRate, vF);
      // Catching a slide: once the rear axle slips past the tyre's peak, the line no longer matters: point the
      // front wheels where the car is going (counter-steer), quickly. Following the line through a wet
      // chicane kept the fronts loaded at their limit while the rear swung round (a spin per lap).
      const betaR = Math.atan2(vL - 0.5 * v.wheelbase * yawRate, vF);
      const apR = v.peakSlip(false);
      slide = clamp((Math.abs(betaR) - apR) / apR, 0, 1);
      const lim = 0.9 * v.peakSlip(true) * (1 - 0.85 * slide);
      steerAngle = clamp(steerAngle, betaF - lim, betaF + lim);
    }
    const target = clamp(steerAngle / v.maxSteer, -1, 1);
    c.steer += (target - c.steer) * Math.min(1, dt * (12 + 24 * slide));

    // speed: the profile a little ahead (actuation lag); rebuilt when the track gets wetter or drier
    if (Math.abs(weatherGrip - this.profileGrip) > 0.02) {
      this.profileGrip = weatherGrip;
      // on a slippery track a driver keeps more in hand than the lost grip alone (wet kerbs, puddles, a slide
      // is harder to catch): 0.8 grip → 7 % more margin
      // (a driver good in the wet dares a little more of what grip there is, a poor one less)
      const wetSkill = 1 + (this.persona.wet - 1) * Math.min(1, Math.max(0, 1 - weatherGrip) / 0.2);
      this.profile = speedProfile(this.line, this.limits, weatherGrip * (1 - 0.35 * Math.max(0, 1 - weatherGrip)) * wetSkill);
    }
    if (raceStarted && s < this.lastS - t.length / 2) this.newLap(weatherGrip);
    if (raceStarted && !this.noise && this.persona.consistency < 0.999) this.newLap(weatherGrip);
    let vt = this.profile[indexAt(t, s + 2 + speed * 0.12)];
    vt *= this.variation(s + 2 + speed * 0.12, vt, speedCap < Infinity || this.roomL < Infinity || this.roomR < Infinity);
    // in a car's dirty air (less downforce: Vehicle.wake) corners must be taken slower; straights keep the tow
    if (vt < this.limits.vMax * 0.9) vt *= 1 - 0.35 * (1 - v.wake.downforce);
    // squeezed off its line by a car alongside: a tighter or wider line than the plan, so a little slower (a
    // driver side by side lifts rather than turning into the other car)
    if (this.squeeze > 0.3 && vt < this.limits.vMax * 0.95) vt *= 1 - Math.min(0.1, 0.04 * this.squeeze);
    vt = Math.min(vt, speedCap);
    if (pit) vt = Math.min(vt, pit.v);
    this.lastS = s;
    this.dbgVt = vt;
    const err = vt - speed;
    if (err > 0) {
      let thr = clamp(0.4 + err * 0.3, 0, 1);
      // Rear grip guard: on the exit of slow corners (worst in the wet, on hot or worn tyres) full throttle stepped
      // the rear out into a spin. Like a driver, back out of it as the rear axle's slip angle passes the tyre's peak.
      if (vF > 3) {
        const betaR = Math.abs(Math.atan2(vL - 0.5 * v.wheelbase * yawRate, vF));
        const a = v.peakSlip(false);
        thr *= clamp(1 - (betaR - 0.6 * a) / (0.5 * a), 0, 1);
      }
      // and squeeze the throttle on instead of stamping on it
      c.throttle = Math.min(thr, c.throttle + dt * this.persona.throttleRise);
      c.brake = 0;
    } else if (err > -0.6) {
      // a little over the target: ease off to a balancing throttle instead of snapping it shut (a sudden lift at
      // the limit mid-corner turned the car in and spun it)
      c.throttle = Math.max(clamp(0.3 + err * 0.5, 0, 1), c.throttle - dt * 6);
      c.brake = 0;
    } else {
      c.throttle = 0;
      // trail-braking: less brake with more lock, and off the brake while the rear is sliding (it spun bots on
      // entry once their rear tyres were hot)
      c.brake = clamp(-err * 0.35, 0, 1) * clamp(1.3 - Math.abs(c.steer), 0.35, 1) * (1 - 0.8 * slide);
    }
    if (!raceStarted) {
      c.throttle = 0;
      c.brake = 0;
    } else if (pit && pit.v === 0 && speed < 1.5) {
      // standing in the box (not on full brake: held at a standstill, that engages reverse)
      c.throttle = 0;
      c.brake = 0.6;
    }

    // recovery: stuck against something, or far off the circuit
    const lateral = Math.abs((p.x - cl[i * 3]) * tz - (p.z - cl[i * 3 + 2]) * tx);
    // (standing in the box and the lane beside the circuit are no trouble)
    this.stuck = raceStarted && speed < 2 && !this.inPitLane ? this.stuck + dt : 0;
    this.offTrack = lateral > 22 && !this.inPitLane ? this.offTrack + dt : 0;
    // spun and facing the wrong way: a three-point turn on track is slow and puts it in everyone's path
    this.wrongWay = raceStarted && fx * tx + fz * tz < -0.2 && speed < 12 ? this.wrongWay + dt : 0;
    if (this.stuck > 4 || this.offTrack > 3 || this.wrongWay > 3) {
      const k = indexAt(t, checkpointS !== undefined ? checkpointS + 2 : s - 10);
      const k2 = (k + 1) % n;
      const yaw = Math.atan2(cl[k2 * 3] - cl[k * 3], cl[k2 * 3 + 2] - cl[k * 3 + 2]);
      v.place(cl[k * 3], cl[k * 3 + 1] + 0.3, cl[k * 3 + 2], yaw);
      this.stuck = this.offTrack = this.wrongWay = 0;
      this.hint = -1;
      this.resetRequested = true;
      this.needBlend = true;
    }
    return c;
  }
}

function indexAt(t: TrackData, s: number): number {
  const L = t.length;
  s = ((s % L) + L) % L;
  let lo = 0;
  let hi = t.cumS.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (t.cumS[m] <= s) lo = m;
    else hi = m - 1;
  }
  return lo;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
