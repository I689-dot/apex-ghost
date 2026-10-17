import { nearestCenterlineIndex, progressAt, type CarSpecs, type TrackData } from '@apex/shared';
import type { Controls } from '../physics/input';
import type { Vehicle } from '../physics/vehicle';

const G = 9.81;

/** Bots drive with the assists a GT3 car carries. */
export const BOT_ASSISTS = { abs: true, tc: 2 as const, stability: true, steering: false };

const RHO = 1.225;

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
  /** Banking (rad, + = left side higher) per point, from the track data; zeros when it has none. */
  bank: Float32Array;
}

export function buildRacingLine(track: TrackData, margin = 2.0, iterations = 3000): RacingLine {
  const cl = track.centerline;
  const n = cl.length / 3;
  const nx = new Float32Array(n);
  const nz = new Float32Array(n);
  const lo = new Float32Array(n);
  const hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = ((i - 1 + n) % n) * 3;
    const b = ((i + 1) % n) * 3;
    const tx = cl[b] - cl[a];
    const tz = cl[b + 2] - cl[a + 2];
    const l = Math.hypot(tx, tz) || 1;
    // left normal
    nx[i] = tz / l;
    nz[i] = -tx / l;
    lo[i] = -Math.max(0, track.widthR[i] - margin);
    hi[i] = Math.max(0, track.widthL[i] - margin);
  }
  const off = new Float32Array(n);
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
  const ds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ds[i] = Math.hypot(x[j] - x[i], z[j] - z[i]) || 0.01;
  }
  const curvature = new Float32Array(n);
  const k = 2; // ±10 m stencil
  for (let i = 0; i < n; i++) {
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
    curvature[i] = la * lb * lc > 1e-6 ? (-2 * cross) / (la * lb * lc) : 0;
  }
  // light smoothing of the curvature (the 5 m resampled line still has small kinks)
  const tmp = Float32Array.from(curvature);
  for (let i = 0; i < n; i++) curvature[i] = (tmp[(i - 1 + n) % n] + 2 * tmp[i] + tmp[(i + 1) % n]) / 4;
  const bank = track.bank && track.bank.length === n ? Float32Array.from(track.bank) : new Float32Array(n);
  return { x, z, offset: off, ds, curvature, bank };
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
}

export function carLimits(specs: CarSpecs, skill = 1): CarLimits {
  return {
    massKg: specs.massKg,
    mu: specs.tyreGrip * 0.8 * skill,
    muBrake: specs.tyreGrip * 0.86 * skill,
    dragArea: specs.dragArea,
    downforceArea: specs.downforceArea,
    powerW: specs.powerKw * 1000 * 0.85,
    vMax: specs.topSpeedKmh / 3.6,
  };
}

/**
 * Quasi-steady-state speed profile along the racing line:
 *  - cornering limit with downforce: v²·κ = μ·(g + k·v²), k = ½ρ·ClA / m; on a banked corner (angle θ towards
 *    the inside) gravity helps: v²·(κ(cos θ − μ sin θ) − μk) = g(sin θ + μ cos θ);
 *  - a backward pass for braking that shares grip with cornering (friction ellipse) and adds drag;
 *  - optionally a forward pass for power-limited acceleration (for lap-time estimates).
 */
export function speedProfile(line: RacingLine, car: CarLimits, weatherGrip = 1, forward = false): Float32Array {
  const n = line.ds.length;
  const v = new Float32Array(n);
  const k = (0.5 * RHO * car.downforceArea) / car.massKg;
  const kd = (0.5 * RHO * car.dragArea) / car.massKg;
  const mu = car.mu * weatherGrip;
  const muB = car.muBrake * weatherGrip;
  // banking towards the inside of the turn (+), against it (−)
  const theta = (i: number) => (line.curvature[i] > 0 ? -line.bank[i] : line.curvature[i] < 0 ? line.bank[i] : 0);
  for (let i = 0; i < n; i++) {
    const kap = Math.abs(line.curvature[i]);
    const th = theta(i);
    const den = kap * (Math.cos(th) - mu * Math.sin(th)) - mu * k;
    const num = G * (Math.sin(th) + mu * Math.cos(th));
    v[i] = den <= 1e-6 ? car.vMax : Math.min(car.vMax, Math.sqrt(Math.max(0, num) / den));
  }
  const avail = (i: number, vv: number, m: number) => {
    const th = theta(i);
    const kap = Math.abs(line.curvature[i]);
    const grip = m * (G * Math.cos(th) + k * vv * vv + vv * vv * kap * Math.sin(th));
    const lat = vv * vv * kap * Math.cos(th) - G * Math.sin(th);
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

/** Racing AI: pure-pursuit steering along the racing line (plus its own small offset) and a speed profile. */
export class AiDriver {
  readonly controls: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, digital: false };
  private profile: Float32Array;
  private profileGrip = 1;
  private readonly line: RacingLine;
  private readonly limits: CarLimits;
  private hint = -1;
  private stuck = 0;
  private offTrack = 0;
  /** Set when the AI teleported itself back onto the track (forwarded as the reset flag). */
  resetRequested = false;
  dbgVt = 0;

  constructor(
    private readonly track: TrackData,
    private readonly vehicle: Vehicle,
    /** 0.82 (slow) … 0.97 (fast) */
    readonly skill: number,
    /** extra lateral offset from the racing line (m, + = left), so bots don't drive in single file */
    private readonly lane: number,
  ) {
    this.line = racingLineFor(track);
    this.limits = carLimits(vehicle.specs, skill);
    this.profile = speedProfile(this.line, this.limits);
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
    const px = L.x[j] + (L.x[j2] - L.x[j]) * f + tz * this.lane;
    const pz = L.z[j] + (L.z[j2] - L.z[j]) * f - tx * this.lane;

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
    if (vF > 4) {
      const betaF = Math.atan2(vL + 0.5 * v.wheelbase * yawRate, vF);
      const lim = 0.9 * v.tire.p.alphaPeak;
      steerAngle = clamp(steerAngle, betaF - lim, betaF + lim);
    }
    const target = clamp(steerAngle / v.maxSteer, -1, 1);
    c.steer += (target - c.steer) * Math.min(1, dt * 12);

    // speed: the profile a little ahead (actuation lag); rebuilt when the track gets wetter or drier
    if (Math.abs(weatherGrip - this.profileGrip) > 0.02) {
      this.profileGrip = weatherGrip;
      this.profile = speedProfile(this.line, this.limits, weatherGrip);
    }
    const vt = Math.min(this.profile[indexAt(t, s + 2 + speed * 0.12)], speedCap);
    this.dbgVt = vt;
    const err = vt - speed;
    if (err > 0) {
      c.throttle = clamp(0.4 + err * 0.3, 0, 1);
      c.brake = 0;
    } else {
      c.throttle = 0;
      c.brake = err < -0.6 ? clamp(-err * 0.35, 0, 1) : 0;
    }
    if (!raceStarted) {
      c.throttle = 0;
      c.brake = 0;
    }

    // recovery: stuck against something, or far off the circuit
    const lateral = Math.abs((p.x - cl[i * 3]) * tz - (p.z - cl[i * 3 + 2]) * tx);
    this.stuck = raceStarted && speed < 2 ? this.stuck + dt : 0;
    this.offTrack = lateral > 22 ? this.offTrack + dt : 0;
    if (this.stuck > 4 || this.offTrack > 3) {
      const k = indexAt(t, checkpointS !== undefined ? checkpointS + 2 : s - 10);
      const k2 = (k + 1) % n;
      const yaw = Math.atan2(cl[k2 * 3] - cl[k * 3], cl[k2 * 3 + 2] - cl[k * 3 + 2]);
      v.place(cl[k * 3], cl[k * 3 + 1] + 0.3, cl[k * 3 + 2], yaw);
      this.stuck = this.offTrack = 0;
      this.hint = -1;
      this.resetRequested = true;
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
