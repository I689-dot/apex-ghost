import type { TrackData } from '@apex/shared';
import type { Vehicle } from '../physics/vehicle';

/**
 * Track limits, as in GT3 championships: the car must stay in contact with the white edge line.
 * Two tests, either is enough:
 *  - every wheel touching the ground is on grass, gravel or sand;
 *  - the car's centre is further out than the edge + half the car + a kerb's width (catches asphalt run-off,
 *    which looks like "track" to the surface test).
 * A short hold time ignores a single sample on a slice of grass while riding a kerb.
 */
export const KERB_ALLOWANCE_M = 1.0;
const HOLD_S = 0.25;

export function beyondLimitsNow(v: Vehicle, track: TrackData, index: number, lateral: number): boolean {
  let touching = 0;
  let off = 0;
  for (const w of v.wheels) {
    if (!w.contact) continue;
    touching++;
    if (w.surface === 'grass' || w.surface === 'gravel' || w.surface === 'sand') off++;
  }
  if (touching > 0 && off === touching) return true;
  const edge = lateral >= 0 ? track.widthL[index] : track.widthR[index];
  return Math.abs(lateral) > edge + v.car.dims.width / 2 + KERB_ALLOWANCE_M;
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
