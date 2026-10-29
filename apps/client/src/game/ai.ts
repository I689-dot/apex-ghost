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
  return { x, z, offset: off, ds, curvature };
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

export function carLimits(specs: CarSpecs, skill = 1, airDensity = RHO): CarLimits {
  return {
    airDensity,
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
  private laneIdx = 0;
  private laneStuck = 0;

  constructor(
    private readonly track: TrackData,
    private readonly vehicle: Vehicle,
    /** 0.82 (slow) … 0.97 (fast) */
    readonly skill: number,
    /** extra lateral offset from the racing line (m, + = left), so bots don't drive in single file */
    private readonly lane: number,
  ) {
    this.line = racingLineFor(track);
    this.limits = carLimits(vehicle.specs, skill, vehicle.airDensity);
    this.profile = speedProfile(this.line, this.limits);
  }

  private lastS = 0;

  /** Room to pass: no corner or braking zone in the next 150 m (pulling out mid-corner in the wet spun bots). */
  canPass(): boolean {
    const v = this.vehicle.telemetry.speed;
    for (let d = 0; d <= 150; d += 10) if (this.profile[indexAt(this.track, this.lastS + d)] < Math.max(v, 20) * 0.92) return false;
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

  /** Pit lane target point and speed, or null when not pitting (`follow` false: still on track, braking for the entry). */
  private pitPath(dt: number, x: number, z: number, s: number, speed: number): { follow: boolean; x: number; z: number; v: number } | null {
    const lane = this.track.pitLane;
    if (!lane || (!this.pitRequest && !this.inPitLane)) return null;
    const pts = lane.points;
    const n = pts.length;
    const limit = lane.speedLimitKmh / 3.6 - 0.8;
    if (!this.inPitLane) {
      // slow for the entry, aiming for the lane from 150 m. The traced lane is only roughly where the real one is
      // (the Nürburgring's jumps 6 m sideways in 2 m where it leaves the track, right at the end of the pit wall),
      // so in the lane the car's body ignores the circuit's walls: following the trace, the bots clipped a wall's
      // end, ran on the wrong side of it and stuck; now they may brush through a corner of one instead.
      const d = wrapDelta(s, lane.entryS, this.track.length);
      if (d < 0 || d > 600) return null;
      const v = Math.sqrt(ENTRY_MS * ENTRY_MS + 2 * 6 * Math.max(0, d - 10));
      if (d > 150) return { follow: false, x: 0, z: 0, v };
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
    const extra = clamp(lineOff + lane + merge + this.passOff, -t.widthR[j] + 1.2, t.widthL[j] - 1.2) - lineOff;
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
      slide = clamp((Math.abs(betaR) - v.tire.p.alphaPeak) / v.tire.p.alphaPeak, 0, 1);
      const lim = 0.9 * v.tire.p.alphaPeak * (1 - 0.85 * slide);
      steerAngle = clamp(steerAngle, betaF - lim, betaF + lim);
    }
    const target = clamp(steerAngle / v.maxSteer, -1, 1);
    c.steer += (target - c.steer) * Math.min(1, dt * (12 + 24 * slide));

    // speed: the profile a little ahead (actuation lag); rebuilt when the track gets wetter or drier
    if (Math.abs(weatherGrip - this.profileGrip) > 0.02) {
      this.profileGrip = weatherGrip;
      // on a slippery track a driver keeps more in hand than the lost grip alone (wet kerbs, puddles, a slide
      // is harder to catch): 0.8 grip → 7 % more margin
      this.profile = speedProfile(this.line, this.limits, weatherGrip * (1 - 0.35 * Math.max(0, 1 - weatherGrip)));
    }
    let vt = this.profile[indexAt(t, s + 2 + speed * 0.12)];
    // in a car's dirty air (less downforce: Vehicle.wake) corners must be taken slower; straights keep the tow
    if (vt < this.limits.vMax * 0.9) vt *= 1 - 0.35 * (1 - v.wake.downforce);
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
        const a = v.tire.p.alphaPeak;
        thr *= clamp(1 - (betaR - 0.6 * a) / (0.5 * a), 0, 1);
      }
      // and squeeze the throttle on instead of stamping on it
      c.throttle = Math.min(thr, c.throttle + dt * THROTTLE_RISE);
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
