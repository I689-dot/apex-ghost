import { INTERP_DELAY_MS, MAX_EXTRAPOLATION_MS, SNAP_DISTANCE_M, copyCarState, makeCarState, type CarState } from '@apex/shared';

const BUF = 32;
/** A stamp this far off the stream is a clock jump, not a late packet. */
const RESYNC_MS = 3000;
/** Drawn in the present (a driver's view): predicted at most this far past the newest sample (ms), then held. */
const PREDICT_MAX_MS = 500;
/** Prediction steps over that span (the path is integrated, not a straight line). */
const PREDICT_STEPS = 8;

/** Output of sampling a remote car at render time. */
export interface RemoteSample extends CarState {
  /** True while we are extrapolating past the newest packet. */
  extrapolating: boolean;
  /** Milliseconds since the newest packet (render time based). */
  staleMs: number;
}

/**
 * One remote car, from its stream of samples.
 *  - Watching (delay INTERP_DELAY_MS): drawn in the past, Hermite-interpolated between samples with the sent
 *    velocities, orientation slerped, extrapolated briefly when packets are late. Smoothest, and nothing to compare.
 *  - Driving (delay 0): drawn where it is now. A car drawn 150 ms (plus the network's delay) in the past is ~10 m
 *    behind its real place at 250 km/h, and the two drivers of a close fight each saw the other where he had been:
 *    both saw him behind, or both in front, never the same race. Racing sims predict the others to the present
 *    (dead reckoning): from the newest sample along a curved path (its yaw rate turns the velocity) with its
 *    measured acceleration, so both screens agree on who is ahead to within the prediction error (decimetres).
 * Corrections when a new sample disagrees are hidden with a decaying error offset (or a snap when far off).
 */
export class RemoteCarBuffer {
  private states: CarState[] = Array.from({ length: BUF }, makeCarState);
  private count = 0;
  private head = 0; // index of the newest state
  readonly out: RemoteSample = { ...makeCarState(), extrapolating: false, staleMs: 0 };
  private errX = 0;
  private errY = 0;
  private errZ = 0;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private hasLast = false;
  lastSeq = -1;
  lossCount = 0;
  recvCount = 0;

  push(s: CarState, seq: number): void {
    if (this.lastSeq >= 0) {
      const gap = (seq - this.lastSeq + 65536) % 65536;
      if (gap > 1 && gap < 1000) this.lossCount += gap - 1;
    }
    this.lastSeq = seq;
    this.recvCount++;
    const newest = this.states[this.head];
    if (this.count > 0 && s.t <= newest.t) {
      // out of order / duplicate; but a newest state seconds ahead of the stream is a bad stamp (a clock jump), and
      // keeping it would refuse every later packet: start over
      if (newest.t - s.t < RESYNC_MS) return;
      this.reset();
    }
    this.head = (this.head + 1) % BUF;
    copyCarState(this.states[this.head], s);
    if (this.count < BUF) this.count++;
  }

  get hasData(): boolean {
    return this.count > 0;
  }

  newestTime(): number {
    return this.count ? this.states[this.head].t : 0;
  }

  /** Sample at `serverNow - delayMs` (0: the present). `dt` (s) drives the error decay. */
  sample(serverNow: number, dt: number, delayMs = INTERP_DELAY_MS): RemoteSample | null {
    if (!this.count) return null;
    const t = serverNow - delayMs;
    const o = this.out;
    const newest = this.states[this.head];
    o.staleMs = t - newest.t;
    // find the pair a (<= t) and b (> t)
    let a: CarState | null = null;
    let b: CarState | null = null;
    for (let k = 0; k < this.count - 1; k++) {
      const ib = (this.head - k + BUF) % BUF;
      const ia = (ib - 1 + BUF) % BUF;
      if (this.states[ia].t <= t && this.states[ib].t > t) {
        a = this.states[ia];
        b = this.states[ib];
        break;
      }
    }
    if (a && b) {
      o.extrapolating = false;
      const span = (b.t - a.t) / 1000;
      const u = (t - a.t) / (b.t - a.t);
      hermite(o, a, b, u, span);
      slerp(o, a, b, u);
      o.vx = a.vx + (b.vx - a.vx) * u;
      o.vy = a.vy + (b.vy - a.vy) * u;
      o.vz = a.vz + (b.vz - a.vz) * u;
      o.steer = a.steer + (b.steer - a.steer) * u;
      o.rotF = lerpAngle(a.rotF, b.rotF, u);
      o.rotR = lerpAngle(a.rotR, b.rotR, u);
      for (let i = 0; i < 4; i++) o.susp[i] = a.susp[i] + (b.susp[i] - a.susp[i]) * u;
      o.flags = u < 0.5 ? a.flags : b.flags;
      o.t = t;
    } else {
      // older than everything (just joined) or newer than the newest: hold / extrapolate
      const oldest = this.states[(this.head - this.count + 1 + BUF) % BUF];
      const base = t < oldest.t ? oldest : newest;
      copyCarState(o, base);
      const ahead = Math.min(Math.max(0, t - base.t), delayMs === 0 ? PREDICT_MAX_MS : MAX_EXTRAPOLATION_MS) / 1000;
      o.extrapolating = ahead > 0;
      if (ahead > 0) {
        // acceleration along the path, from the last two samples (braking from 250 km/h is ~2.5 g: 0.5 m in 200 ms)
        let acc = 0;
        if (base === newest && this.count > 1) {
          const prev = this.states[(this.head - 1 + BUF) % BUF];
          const span = (newest.t - prev.t) / 1000;
          if (span > 0.01 && span < 0.3) acc = (Math.hypot(newest.vx, newest.vz) - Math.hypot(prev.vx, prev.vz)) / span;
        }
        predict(o, base, ahead, Math.max(-35, Math.min(15, acc)) * 0.8);
      }
      o.t = t;
    }

    // smooth out discontinuities: compare with where we would be if we continued last frame
    if (this.hasLast) {
      const px = this.lastX + o.vx * dt;
      const py = this.lastY + o.vy * dt;
      const pz = this.lastZ + o.vz * dt;
      const ex = px - (o.px + this.errX);
      const ey = py - (o.py + this.errY);
      const ez = pz - (o.pz + this.errZ);
      const d2 = ex * ex + ey * ey + ez * ez;
      const tx = this.errX + ex;
      const ty = this.errY + ey;
      const tz = this.errZ + ez;
      if (tx * tx + ty * ty + tz * tz > SNAP_DISTANCE_M * SNAP_DISTANCE_M || d2 > SNAP_DISTANCE_M * SNAP_DISTANCE_M) {
        this.errX = this.errY = this.errZ = 0; // too far: snap
      } else if (d2 > 0.0004) {
        this.errX = tx;
        this.errY = ty;
        this.errZ = tz;
      }
    }
    // a prediction is corrected over a little longer: its errors are larger and a quick snap reads as a twitch
    const decay = Math.exp(-dt / (delayMs === 0 ? 0.18 : 0.12));
    this.errX *= decay;
    this.errY *= decay;
    this.errZ *= decay;
    o.px += this.errX;
    o.py += this.errY;
    o.pz += this.errZ;
    this.lastX = o.px;
    this.lastY = o.py;
    this.lastZ = o.pz;
    this.hasLast = true;
    return o;
  }

  reset(): void {
    this.count = 0;
    this.hasLast = false;
    this.errX = this.errY = this.errZ = 0;
  }
}

/**
 * Dead reckoning over `ahead` s: the velocity turns at the sampled yaw rate (a car in a corner follows an arc, not
 * its tangent: 0.6 m off at 200 ms in a 100 m corner at 200 km/h) and its speed changes at `acc` (m/s², along the
 * path, never through zero). Height follows the vertical speed; the orientation integrates the angular velocity.
 */
function predict(o: CarState, b: CarState, ahead: number, acc: number): void {
  const h = ahead / PREDICT_STEPS;
  const speed = Math.hypot(b.vx, b.vz);
  let x = 0;
  let z = 0;
  let vx = b.vx;
  let vz = b.vz;
  for (let i = 0; i < PREDICT_STEPS; i++) {
    const tm = (i + 0.5) * h;
    const a = b.wy * tm;
    const k = speed > 0.5 ? Math.max(0, 1 + (acc * tm) / speed) : 1;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // rotation about +Y by a: (x, z) → (x cos a + z sin a, −x sin a + z cos a)
    vx = (b.vx * c + b.vz * s) * k;
    vz = (-b.vx * s + b.vz * c) * k;
    x += vx * h;
    z += vz * h;
  }
  o.px = b.px + x;
  o.py = b.py + b.vy * ahead;
  o.pz = b.pz + z;
  o.vx = vx;
  o.vz = vz;
  integrateRotation(o, b.wx * ahead, b.wy * ahead, b.wz * ahead);
}

function hermite(o: CarState, a: CarState, b: CarState, u: number, span: number): void {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  o.px = h00 * a.px + h10 * span * a.vx + h01 * b.px + h11 * span * b.vx;
  o.py = h00 * a.py + h10 * span * a.vy + h01 * b.py + h11 * span * b.vy;
  o.pz = h00 * a.pz + h10 * span * a.vz + h01 * b.pz + h11 * span * b.vz;
}

function slerp(o: CarState, a: CarState, b: CarState, u: number): void {
  let bx = b.qx;
  let by = b.qy;
  let bz = b.qz;
  let bw = b.qw;
  let cos = a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0: number;
  let k1: number;
  if (cos > 0.9995) {
    k0 = 1 - u;
    k1 = u;
  } else {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    k0 = Math.sin((1 - u) * th) / s;
    k1 = Math.sin(u * th) / s;
  }
  o.qx = a.qx * k0 + bx * k1;
  o.qy = a.qy * k0 + by * k1;
  o.qz = a.qz * k0 + bz * k1;
  o.qw = a.qw * k0 + bw * k1;
  const n = Math.hypot(o.qx, o.qy, o.qz, o.qw) || 1;
  o.qx /= n;
  o.qy /= n;
  o.qz /= n;
  o.qw /= n;
}

/** q ← q ⊗ exp(ω·dt/2) with world-space angular velocity (small angle). */
function integrateRotation(o: CarState, ax: number, ay: number, az: number): void {
  const hx = ax * 0.5;
  const hy = ay * 0.5;
  const hz = az * 0.5;
  const { qx, qy, qz, qw } = o;
  o.qx = qx + (hx * qw + hy * qz - hz * qy);
  o.qy = qy + (hy * qw + hz * qx - hx * qz);
  o.qz = qz + (hz * qw + hx * qy - hy * qx);
  o.qw = qw - (hx * qx + hy * qy + hz * qz);
  const n = Math.hypot(o.qx, o.qy, o.qz, o.qw) || 1;
  o.qx /= n;
  o.qy /= n;
  o.qz /= n;
  o.qw /= n;
}

function lerpAngle(a: number, b: number, u: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}
