import { INTERP_DELAY_MS, MAX_EXTRAPOLATION_MS, SNAP_DISTANCE_M, copyCarState, makeCarState, type CarState } from '@apex/shared';

const BUF = 32;

/** Output of sampling a remote car at render time. */
export interface RemoteSample extends CarState {
  /** True while we are extrapolating past the newest packet. */
  extrapolating: boolean;
  /** Milliseconds since the newest packet (render time based). */
  staleMs: number;
}

/**
 * Snapshot interpolation for one remote car.
 * Renders INTERP_DELAY_MS in the past, Hermite-interpolates position using the sent velocities,
 * slerps orientation, extrapolates briefly when packets are late, and hides corrections with a
 * decaying error offset (or snaps when far off).
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
    if (this.count > 0 && s.t <= newest.t) return; // out of order / duplicate
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

  /** Sample at `serverNow - delay`. `dt` (s) drives the error decay. */
  sample(serverNow: number, dt: number): RemoteSample | null {
    if (!this.count) return null;
    const t = serverNow - INTERP_DELAY_MS;
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
      const base = t < this.states[(this.head - this.count + 1 + BUF) % BUF].t ? this.states[(this.head - this.count + 1 + BUF) % BUF] : newest;
      copyCarState(o, base);
      const ahead = Math.min(Math.max(0, t - base.t), MAX_EXTRAPOLATION_MS) / 1000;
      o.extrapolating = ahead > 0;
      o.px += base.vx * ahead;
      o.py += base.vy * ahead;
      o.pz += base.vz * ahead;
      integrateRotation(o, base.wx * ahead, base.wy * ahead, base.wz * ahead);
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
    const decay = Math.exp(-dt / 0.12);
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
