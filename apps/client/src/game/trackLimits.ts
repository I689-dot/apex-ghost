import type { TrackData } from '@apex/shared';
import type { Vehicle } from '../physics/vehicle';

/**
 * Track limits as in the real rules: the painted white line is the edge of the track (per point and side,
 * measured from the map: track.limitL/limitR), and a car is off only when all four wheels are beyond it. Kerbs
 * outside the line can be used: a wheel counts as beyond only past the line + LIMIT_TOLERANCE_M (about half a
 * kerb). A hold time ignores a brief moment out (riding a kerb, a bump).
 */
export const LIMIT_TOLERANCE_M = 0.5;
const HOLD_S = 0.4;

export function limitAt(track: TrackData, index: number, left: boolean): number {
  const lim = left ? track.limitL : track.limitR;
  return lim?.[index] ?? (left ? track.widthL[index] : track.widthR[index]) + 0.5;
}

export function beyondLimitsNow(v: Vehicle, track: TrackData, index: number, lateral: number): boolean {
  const cl = track.centerline;
  const n = cl.length / 3;
  const j = (index + 1) % n;
  let tx = cl[j * 3] - cl[index * 3];
  let tz = cl[j * 3 + 2] - cl[index * 3 + 2];
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  const left = lateral >= 0;
  const lim = limitAt(track, index, left) + LIMIT_TOLERANCE_M;
  let touching = 0;
  for (const w of v.wheels) {
    if (!w.contact) continue;
    touching++;
    const wl = (w.cpx - cl[index * 3]) * tz - (w.cpz - cl[index * 3 + 2]) * tx;
    if ((left ? wl : -wl) <= lim) return false;
  }
  return touching > 0;
}

export class TrackLimits {
  private t = 0;
  /** True while the car has been beyond the limits for longer than the hold time. */
  offTrack = false;

  update(dt: number, beyond: boolean): boolean {
    this.t = beyond ? this.t + dt : 0;
    this.offTrack = this.t >= HOLD_S;
    return this.offTrack;
  }

  reset(): void {
    this.t = 0;
    this.offTrack = false;
  }
}
