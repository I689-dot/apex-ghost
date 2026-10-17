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

export class DamageState {
  readonly zones = new Float32Array(6);
  /** Direction of the steering pull; 0 until a heavy hit decides it (no damage, no pull). */
  private pullSign = 0;
  version = 0;

  reset(): void {
    this.zones.fill(0);
    this.pullSign = 0;
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
    if (zone === 0) {
      this.add(4, amount * 0.6); // radiator / engine bay
      this.add(5, amount * 0.35);
      if (this.zones[0] > 0.2) this.pullSign = lx >= 0 ? 1 : -1;
    } else if (zone === 1) {
      this.add(4, amount * 0.25); // mid/rear engines
      this.add(5, amount * 0.3);
    } else {
      this.add(5, amount * 0.6); // wheels hit first on side impacts
      this.pullSign = zone === 2 ? 1 : -1;
    }
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
    if (parts.suspension) clear(5);
    if (parts.engine) clear(4);
    if (parts.body && parts.suspension) this.pullSign = 0;
    if (changed) this.version++;
    return changed;
  }

  /** Sets zones from a remote snapshot. */
  setAll(z: readonly number[]): void {
    for (let i = 0; i < 6; i++) this.zones[i] = z[i] ?? 0;
    this.version++;
  }

  get powerScale(): number {
    return 1 - CAP.power * this.zones[4];
  }

  get alignment(): number {
    return this.pullSign * CAP.alignmentRad * Math.min(1, this.zones[5] * 0.7 + this.zones[0] * 0.3);
  }

  private sideOf(key: WheelKey): number {
    return key[1] === 'L' ? this.zones[2] : this.zones[3];
  }

  gripScale(key: WheelKey): number {
    return 1 - CAP.grip * Math.min(1, this.zones[5] * 0.6 + this.sideOf(key) * 0.5);
  }

  damperScale(key: WheelKey): number {
    return 1 - 0.35 * Math.min(1, this.zones[5] * 0.5 + this.sideOf(key) * 0.5);
  }

  rideDrop(key: WheelKey): number {
    return CAP.ride * Math.min(1, this.sideOf(key) * 0.6 + this.zones[5] * 0.4);
  }

  dragScale(): number {
    return 1 + CAP.drag * Math.min(1, (this.zones[0] + this.zones[1] + this.zones[2] + this.zones[3]) / 2.2);
  }

  downforceScale(): number {
    return 1 - CAP.downforce * Math.min(1, this.zones[0] * 0.5 + this.zones[1] * 0.6);
  }

  /** 0..1 overall for the HUD. */
  get total(): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.zones[i];
    return Math.min(1, s / 3);
  }
}
