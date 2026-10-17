/**
 * Simplified Pacejka "Magic Formula" with combined slip.
 *
 * Both slips are normalised by their peak values (κ_peak, α_peak) so that σ = |(σx, σy)|
 * is 1 at peak grip in any direction (friction ellipse). The force magnitude follows
 *   F = μ·Fz · sin(C · atan(B · σ))
 * with B chosen so the peak is at σ = 1, and C setting how much grip remains when sliding.
 * The force is then distributed along the normalised slip direction.
 */
export interface TireParams {
  /** Peak slip ratio (longitudinal). */
  kappaPeak: number;
  /** Peak slip angle (rad). */
  alphaPeak: number;
  /** Fraction of peak grip left when fully sliding, longitudinal / lateral. */
  slideX: number;
  slideY: number;
  /** Load sensitivity: grip coefficient drop per unit of (Fz/Fz0 − 1). */
  loadSens: number;
}

export const SLICK: TireParams = { kappaPeak: 0.1, alphaPeak: 0.115, slideX: 0.82, slideY: 0.8, loadSens: 0.12 };

/** C coefficient for a target slide fraction: sin(C·π/2) = slide (C between 1 and 2). */
function cForSlide(slide: number): number {
  return (Math.PI - Math.asin(slide)) / (Math.PI / 2);
}

/** B so that the curve peaks at σ = 1: C·atan(B) = π/2. */
function bForC(c: number): number {
  return Math.tan(Math.PI / (2 * c));
}

export class TireModel {
  readonly cx: number;
  readonly bx: number;
  readonly cy: number;
  readonly by: number;

  constructor(readonly p: TireParams) {
    this.cx = cForSlide(p.slideX);
    this.bx = bForC(this.cx);
    this.cy = cForSlide(p.slideY);
    this.by = bForC(this.cy);
  }

  /** Normalised Magic Formula curve, peak 1 at σ = 1. */
  curve(sigma: number, b: number, c: number): number {
    return Math.sin(c * Math.atan(b * sigma));
  }

  /**
   * Combined tyre force. Writes into out[0] (longitudinal) and out[1] (lateral).
   * @param kappa slip ratio
   * @param alpha slip angle (rad), positive → force towards +lateral
   * @param fz normal load (N)
   * @param fz0 nominal load (N)
   * @param mu surface × tyre friction coefficient
   */
  force(kappa: number, alpha: number, fz: number, fz0: number, mu: number, out: Float64Array): void {
    if (fz <= 0) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    const sx = kappa / this.p.kappaPeak;
    const sy = Math.tan(alpha) / Math.tan(this.p.alphaPeak);
    const sigma = Math.hypot(sx, sy);
    if (sigma < 1e-6) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    const load = Math.max(0.65, 1 - this.p.loadSens * (fz / fz0 - 1));
    const muEff = mu * load;
    // blend the longitudinal/lateral curve shapes by slip direction
    const wx = Math.abs(sx) / (Math.abs(sx) + Math.abs(sy));
    const b = this.bx * wx + this.by * (1 - wx);
    const c = this.cx * wx + this.cy * (1 - wx);
    const f = muEff * fz * this.curve(sigma, b, c);
    out[0] = (f * sx) / sigma;
    out[1] = (f * sy) / sigma;
  }
}
