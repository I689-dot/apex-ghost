import type { WheelKey } from './vehicle';

/** Zones: 0 front, 1 rear, 2 left, 3 right, 4 engine, 5 suspension. Values 0 (new) … 1 (wrecked). */
export const ZONES = ['front', 'rear', 'left', 'right', 'engine', 'suspension'] as const;

/** Mechanical effects are capped so that a race can always be finished. */
const CAP = {
  power: 0.3, // up to −30 % power
  grip: 0.12, // up to −12 % grip on the damaged side
  alignmentRad: (1.6 * Math.PI) / 180, // steering pull
  drag: 0.22, // up to +22 % drag
  downforce: 0.3, // up to −30 % downforce
  ride: 0.025, // up to 2.5 cm sag
};

export interface ImpactResult {
  zone: number;
  amount: number;
}

const CORNERS: WheelKey[] = ['FL', 'FR', 'RL', 'RR'];

/**
 * A car's damage, after the sims' models (iRacing's GT3 damage, ACC, F1): bodywork and aero front and rear (a broken
 * splitter costs front downforce: understeer at speed; a broken wing or diffuser the rear's: oversteer), each corner's
 * suspension on its own (a bent arm or rim: that wheel's toe and camber off, grip, a sagging corner, a tired damper,
 * the tyre scrubbing away; the fronts pull the steering), the engine (power), and punctures from hard corner hits
 * (race control's black flag with the orange disc until the tyre is changed). The six zones are what other players
 * receive; the corners and punctures are this car's own.
 */
export class DamageState {
  readonly zones = new Float32Array(6);
  /** Suspension per corner (FL, FR, RL, RR), 0 … 1; zones[5] is the worst of them. */
  readonly corners = new Float32Array(4);
  /** Punctured tyres (FL, FR, RL, RR). */
  readonly punctured = [false, false, false, false];
  version = 0;

  reset(): void {
    this.zones.fill(0);
    this.corners.fill(0);
    this.punctured.fill(false);
    this.version++;
  }

  /**
   * Register an impact. `impulse` in N·s, local direction (lx, ly, lz) is where the hit came FROM
   * relative to the car centre (car-local: +X left, +Z forward), mass in kg.
   */
  impact(impulse: number, lx: number, lz: number, mass: number): ImpactResult | null {
    // kinetic-energy equivalent of the impulse, in kJ
    const energyKJ = (impulse * impulse) / (2 * mass) / 1000;
    if (energyKJ < 1.5) return null; // light scrapes do nothing
    const amount = Math.min(0.35, (energyKJ - 1.5) / 140);
    const ax = Math.abs(lx);
    const az = Math.abs(lz);
    let zone: number;
    if (az >= ax) zone = lz > 0 ? 0 : 1;
    else zone = lx > 0 ? 2 : 3;
    this.add(zone, amount);
    // the corner nearest the hit takes the suspension damage (+X is left, +Z forward)
    const corner = (lz >= 0 ? 0 : 2) + (lx >= 0 ? 0 : 1);
    let susp: number;
    if (zone === 0) {
      this.add(4, amount * 0.6); // radiator / engine bay
      susp = amount * 0.35;
    } else if (zone === 1) {
      this.add(4, amount * 0.25); // mid/rear engines
      susp = amount * 0.3;
    } else susp = amount * 0.6; // wheels hit first on side impacts
    // a glancing hit spreads to the neighbouring corner on its side or axle
    this.corners[corner] = Math.min(1, this.corners[corner] + susp);
    const near = az >= ax ? corner ^ 1 : corner ^ 2;
    this.corners[near] = Math.min(1, this.corners[near] + (susp * 0.25 * Math.min(ax, az)) / Math.max(ax, az, 1e-6));
    this.zones[5] = Math.max(...this.corners);
    // a hard hit on a wheel bursts its tyre
    if (susp > 0.18 || this.corners[corner] > 0.45) this.punctured[corner] = true;
    this.version++;
    return { zone, amount };
  }

  private add(i: number, v: number): void {
    this.zones[i] = Math.min(1, this.zones[i] + v);
  }

  /**
   * Pit-stop repair. body: front, rear, sides (aero and bodywork); suspension; engine.
   * Returns true when something changed.
   */
  repair(parts: { body?: boolean; suspension?: boolean; engine?: boolean }): boolean {
    let changed = false;
    const clear = (i: number) => {
      if (this.zones[i] > 0) changed = true;
      this.zones[i] = 0;
    };
    if (parts.body) for (const i of [0, 1, 2, 3]) clear(i);
    if (parts.suspension) {
      clear(5);
      this.corners.fill(0);
    }
    if (parts.engine) clear(4);
    if (changed) this.version++;
    return changed;
  }

  /** Sets zones from a remote snapshot. */
  setAll(z: readonly number[]): void {
    for (let i = 0; i < 6; i++) this.zones[i] = z[i] ?? 0;
    // another car's corners are not sent: its suspension damage spread over the side that was hit
    const l = this.zones[2] >= this.zones[3];
    this.corners.set(
      l
        ? [this.zones[5], this.zones[5] * 0.4, this.zones[5] * 0.6, this.zones[5] * 0.3]
        : [this.zones[5] * 0.4, this.zones[5], this.zones[5] * 0.3, this.zones[5] * 0.6],
    );
    this.version++;
  }

  /** New tyres: the punctures are gone. */
  tyresChanged(): void {
    if (this.punctured.some(Boolean)) this.version++;
    this.punctured.fill(false);
  }

  private cornerOf(key: WheelKey): number {
    return this.corners[CORNERS.indexOf(key)];
  }

  private flat(key: WheelKey): boolean {
    return this.punctured[CORNERS.indexOf(key)];
  }

  get powerScale(): number {
    return 1 - CAP.power * this.zones[4];
  }

  /** Steering pull (rad, + left): towards the front corner bent worse, or the flat front tyre. */
  get alignment(): number {
    const d = this.corners[0] - this.corners[1] + (this.punctured[0] ? 0.5 : 0) - (this.punctured[1] ? 0.5 : 0);
    return CAP.alignmentRad * Math.max(-1, Math.min(1, d * 1.4 + Math.sign(d) * this.zones[0] * 0.3));
  }

  private sideOf(key: WheelKey): number {
    return key[1] === 'L' ? this.zones[2] : this.zones[3];
  }

  gripScale(key: WheelKey): number {
    const g = 1 - CAP.grip * Math.min(1, this.cornerOf(key) * 0.8 + this.sideOf(key) * 0.4);
    // a flat tyre on its rim: a third of the grip
    return this.flat(key) ? g * 0.35 : g;
  }

  damperScale(key: WheelKey): number {
    return 1 - 0.35 * Math.min(1, this.cornerOf(key) * 0.7 + this.sideOf(key) * 0.4);
  }

  rideDrop(key: WheelKey): number {
    return CAP.ride * Math.min(1, this.sideOf(key) * 0.5 + this.cornerOf(key) * 0.6) + (this.flat(key) ? 0.06 : 0);
  }

  /** Tyre wear factor: a bent corner's toe scrubs its tyre, a flat one is shredded. */
  wearScale(key: WheelKey): number {
    return (1 + 2.5 * this.cornerOf(key)) * (this.flat(key) ? 6 : 1);
  }

  dragScale(): number {
    return 1 + CAP.drag * Math.min(1, (this.zones[0] + this.zones[1] + this.zones[2] + this.zones[3]) / 2.2);
  }

  /** Downforce left at the front (the splitter, the nose) and the rear (the wing, the diffuser). */
  downforceFront(): number {
    return 1 - CAP.downforce * Math.min(1, this.zones[0] * 1.1 + (this.zones[2] + this.zones[3]) * 0.15);
  }

  downforceRear(): number {
    return 1 - CAP.downforce * Math.min(1, this.zones[1] * 1.2 + (this.zones[2] + this.zones[3]) * 0.15);
  }

  /** 0..1 overall for the HUD. */
  get total(): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.zones[i];
    return Math.min(1, s / 3);
  }
}
