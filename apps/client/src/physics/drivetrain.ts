import type { CarSpecs } from '@apex/shared';

export const RPM_TO_RADS = (2 * Math.PI) / 60;

/** Engine + sequential gearbox + launch clutch. Gear 0 = neutral, -1 = reverse. */
export class Drivetrain {
  rpm: number;
  gear = 1;
  /** Remaining shift time (s); drive is interrupted while > 0. */
  shiftTimer = 0;
  private pendingGear: number | null = null;
  manual = false;
  limiterCut = false;
  /** Power multiplier from engine damage (0.6..1). */
  powerScale = 1;
  /** Power multiplier from the air the engine breathes (Vehicle.setAir). */
  airScale = 1;
  /** Out of fuel: the engine gets none (it idles on what is left in the lines, no drive). */
  starved = false;
  /** Torque delivered to the driveline input last step (Nm, before gear). */
  engineTorque = 0;
  private autoCooldown = 0;

  constructor(readonly s: CarSpecs) {
    this.rpm = s.idleRpm;
  }

  /** Engine torque at full throttle for a given rpm (linear interpolation of the curve). */
  torqueAt(rpm: number): number {
    const c = this.s.torqueCurve;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (rpm <= c[i][0]) {
        const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
        return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
      }
    }
    return c[c.length - 1][1];
  }

  ratio(gear = this.gear): number {
    if (gear === 0) return 0;
    if (gear < 0) return -this.s.reverseRatio * this.s.finalDrive;
    return this.s.gears[gear - 1] * this.s.finalDrive;
  }

  get shifting(): boolean {
    return this.shiftTimer > 0;
  }

  requestShift(dir: 1 | -1): void {
    const target = (this.pendingGear ?? this.gear) + dir;
    if (target > this.s.gears.length || target < -1) return;
    if (this.shiftTimer > 0 && this.pendingGear !== null) {
      this.pendingGear = target;
      return;
    }
    this.pendingGear = target;
    this.shiftTimer = this.s.shiftTimeMs / 1000;
  }

  /** Immediate gear set (used for reverse engagement when stopped). */
  setGear(g: number): void {
    this.gear = g;
    this.pendingGear = null;
    this.shiftTimer = 0;
  }

  /**
   * Advance the engine. `wheelOmega` is the mean angular speed of the driven wheels (rad/s).
   * Returns the torque delivered to the driven axle(s) (Nm, after gearing).
   */
  update(dt: number, throttle: number, wheelOmega: number, speedMs: number): number {
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0 && this.pendingGear !== null) {
        this.gear = this.pendingGear;
        this.pendingGear = null;
      }
    }
    if (!this.manual) this.autoShift(dt, throttle, speedMs);

    const ratio = this.ratio();
    const s = this.s;
    const wheelRpm = (Math.abs(wheelOmega * ratio) / RPM_TO_RADS) | 0;
    // launch clutch: below the slip rpm the engine is held up and torque is clutch-limited
    const launchRpm = s.idleRpm + throttle * (s.redlineRpm * 0.45 - s.idleRpm);
    let clutch = 1;
    let target = wheelRpm;
    if (ratio === 0 || this.shiftTimer > 0) {
      clutch = 0;
      target = s.idleRpm + throttle * (s.limiterRpm - s.idleRpm);
    } else if (wheelRpm < launchRpm) {
      // slipping clutch: transmits full engine torque while holding the engine at launch rpm
      target = launchRpm;
    }
    // engine inertia: locked to the wheels when the clutch is closed, otherwise follows quickly
    const locked = ratio !== 0 && this.shiftTimer <= 0 && wheelRpm >= launchRpm;
    const rate = locked ? 1 : 1 - Math.exp(-dt * 12);
    this.rpm += (Math.max(target, s.idleRpm * 0.9) - this.rpm) * rate;
    if (this.rpm > s.limiterRpm) this.rpm = s.limiterRpm;

    // rev limiter: cut fuel
    this.limiterCut = this.rpm >= s.limiterRpm - 30 ? true : this.rpm < s.limiterRpm - 250 ? false : this.limiterCut;
    const thr = this.limiterCut || this.starved ? 0 : throttle;
    const full = this.torqueAt(this.rpm) * this.powerScale * this.airScale;
    // engine braking grows with rpm when off throttle
    const drag = (0.06 + 0.12 * (this.rpm / s.redlineRpm)) * full;
    const tq = thr * full - (1 - thr) * drag;
    this.engineTorque = tq;
    if (clutch === 0) return 0;
    return tq * ratio * clutch * 0.92; // 8 % driveline loss
  }

  private autoShift(dt: number, throttle: number, speedMs: number): void {
    this.autoCooldown -= dt;
    if (this.gear <= 0 || this.shiftTimer > 0 || this.autoCooldown > 0) return;
    const s = this.s;
    const up = s.redlineRpm * (0.9 + 0.06 * throttle);
    if (this.rpm > up && this.gear < s.gears.length && speedMs > 2) {
      this.requestShift(1);
      this.autoCooldown = 0.35;
      return;
    }
    if (this.gear > 1) {
      // downshift when the lower gear would still be comfortably below the redline
      const lower = this.rpm * (s.gears[this.gear - 2] / s.gears[this.gear - 1]);
      const down = s.redlineRpm * (throttle > 0.5 ? 0.72 : 0.62);
      if (lower < down) {
        this.requestShift(-1);
        this.autoCooldown = 0.4;
      }
    }
  }
}
