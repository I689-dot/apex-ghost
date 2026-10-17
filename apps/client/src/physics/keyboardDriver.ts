/**
 * Keyboard → analog driver inputs, run inside every physics step (dt = 1/120 s).
 *
 * Follows docs/KEYBOARD_CONTROLS_RESEARCH.md (AGA for Assetto Corsa, BeamNG, LFS "stabilised",
 * rFactor 2, UE4/Unity defaults):
 *  - keys only set targets; asymmetric rate limiters (out / return / reverse) + a short low-pass;
 *  - steering ±1 means "front tyres at ~95 % of their peak slip angle", not full mechanical lock,
 *    computed from the car's motion so the limit grows in a turn, shrinks when the rear steps out,
 *    and opens up to |rear slip| when counter-steering (slides can always be caught);
 *  - speed-sensitive steering (as in Assetto Corsa / ACC "steering speed" and "speed sensitivity"): the wheel
 *    turns slower and taps give smaller angles at high speed, so a key press at 250 km/h is a lane-change nudge,
 *    not an instant full-grip turn-in; the target slip is a little lower there so the rear stays planted;
 *  - a small self-steer (caster / force-feedback emulation), capped and blended out by input;
 *  - ramped pedals; a ramped, speed-faded handbrake that rotates the car instead of locking it.
 */
export const KB = {
  steerOutRate: 4.0,
  steerReturnRate: 5.5,
  steerReverseRate: 8.0,
  steerTau: 0.04,
  steerGamma: 1.5,
  targetSlipFrac: 0.95,
  /** High-speed versions of the values above, blended in between hsV0 and hsV1 (m/s). */
  hsV0: 70 / 3.6,
  hsV1: 240 / 3.6,
  hsOutRate: 1.35,
  hsReturnRate: 3.2,
  hsReverseRate: 4.5,
  hsGamma: 2.1,
  hsTargetSlipFrac: 0.82,
  maxLimitReductionFrac: 0.55,
  counterMarginFrac: 0.2,
  limitRate: 10,
  minLimitRad: (2 * Math.PI) / 180,
  selfResp: 0.35,
  selfDamp: 0.35,
  selfCapRad: (8 * Math.PI) / 180,
  thrUp: 5,
  thrDown: 10,
  brkUp: 5,
  brkDown: 10,
  hbUp: 2.5,
  hbDown: 10,
  hbTorquePerWheel: 700,
  hbFadeV0: 10,
  hbFadeV1: 28,
  hbFadeMin: 0.25,
};

export interface KeyTargets {
  /** 0 or 1 */
  throttle: number;
  brake: number;
  /** -1 (right), 0, +1 (left) */
  steer: number;
  handbrake: number;
}

export interface MotionState {
  /** forward / left velocity (m/s), yaw rate (rad/s, + = turning left) */
  vx: number;
  vy: number;
  r: number;
  /** CoM → front axle and CoM → rear axle distances (m) */
  a: number;
  b: number;
  wheelbase: number;
  maxLockRad: number;
  /** Peak slip angle of the front tyres (rad). */
  alphaPeak: number;
}

const moveTowards = (v: number, t: number, step: number) => (Math.abs(t - v) <= step ? t : v + Math.sign(t - v) * step);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class KeyboardDriver {
  /** Ramped and filtered steering (−1…1, of the dynamic limit). */
  uRamp = 0;
  uFilt = 0;
  limit = 0.4;
  throttle = 0;
  brake = 0;
  handbrake = 0;
  /** Final road-wheel steering angle (rad). */
  steerAngle = 0;

  reset(): void {
    this.uRamp = this.uFilt = this.throttle = this.brake = this.handbrake = this.steerAngle = 0;
  }

  step(dt: number, keys: KeyTargets, m: MotionState): void {
    /* ---- steering input shaping ---- */
    const target = keys.steer;
    const hs = smoothstep(KB.hsV0, KB.hsV1, m.vx);
    let rate: number;
    const reversing = target !== 0 && this.uRamp !== 0 && Math.sign(target) !== Math.sign(this.uRamp);
    if (target === 0) rate = lerp(KB.steerReturnRate, KB.hsReturnRate, hs);
    else if (reversing) rate = lerp(KB.steerReverseRate, KB.hsReverseRate, hs);
    else rate = lerp(KB.steerOutRate, KB.hsOutRate, hs);
    const before = this.uRamp;
    this.uRamp = moveTowards(this.uRamp, target, rate * dt);
    // the fast reverse rate only applies until the wheel is back at centre
    if (reversing && Math.sign(this.uRamp) !== Math.sign(before) && this.uRamp !== 0) this.uRamp = 0;
    this.uFilt += (this.uRamp - this.uFilt) * (1 - Math.exp(-dt / KB.steerTau));
    const uShaped = Math.sign(this.uFilt) * Math.pow(Math.abs(this.uFilt), lerp(KB.steerGamma, KB.hsGamma, hs));

    /* ---- dynamic, slip-based steering limit ---- */
    const vxa = Math.max(Math.abs(m.vx), 0.5);
    const betaF = Math.atan2(m.vy + m.a * m.r, vxa); // front-axle velocity angle (+ = left)
    const betaR = Math.atan2(m.vy - m.b * m.r, vxa); // rear-axle velocity angle
    const alphaT = lerp(KB.targetSlipFrac, KB.hsTargetSlipFrac, hs) * m.alphaPeak;
    const s = Math.sign(uShaped) || 1;
    const limInward = alphaT + Math.max(s * betaF, -KB.maxLimitReductionFrac * alphaT);
    // counter-steering = steering towards the rear's sliding direction
    const counter = s === Math.sign(betaR) ? smoothstep(0.0785, 0.1745, Math.abs(betaR)) : 0; // 4.5° … 10°
    const limCounter = Math.abs(betaR) + KB.counterMarginFrac * alphaT;
    let limTarget = lerp(limInward, Math.max(limInward, limCounter), counter);
    limTarget = clamp(limTarget, KB.minLimitRad, m.maxLockRad);
    this.limit += (limTarget - this.limit) * (1 - Math.exp(-KB.limitRate * dt));
    const k = m.wheelbase / 2.5;
    const fade = m.vx > 0 ? smoothstep(2 * k, 6 * k, m.vx) : 0; // off at parking speed and in reverse
    const effLimit = lerp(m.maxLockRad, this.limit, fade);

    /* ---- self-steer: wheels align with the travel direction (caster), damped by yaw rate ---- */
    const self = clamp(KB.selfResp * 1.4 * betaR - KB.selfDamp * 0.03 * m.r, -KB.selfCapRad, KB.selfCapRad) * fade;
    this.steerAngle = clamp(uShaped * effLimit + self * (1 - Math.abs(this.uFilt)), -m.maxLockRad, m.maxLockRad);

    /* ---- pedals ---- */
    this.throttle = moveTowards(this.throttle, keys.throttle, (keys.throttle > this.throttle ? KB.thrUp : KB.thrDown) * dt);
    this.brake = moveTowards(this.brake, keys.brake, (keys.brake > this.brake ? KB.brkUp : KB.brkDown) * dt);
    this.handbrake = moveTowards(this.handbrake, keys.handbrake, (keys.handbrake > this.handbrake ? KB.hbUp : KB.hbDown) * dt);
  }

  /** Handbrake torque per rear wheel (N·m), faded with speed so it rotates the car instead of locking it. */
  handbrakeTorque(speed: number): number {
    const fade = lerp(1, KB.hbFadeMin, smoothstep(KB.hbFadeV0, KB.hbFadeV1, speed));
    return this.handbrake * fade * KB.hbTorquePerWheel;
  }
}
