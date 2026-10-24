import { PIT_WINDOW } from '@apex/shared';
import type { CompoundId } from '../physics/tyres';
import { t } from '../i18n';

/** What the crew should do at a pit stop. */
export interface ServicePlan {
  /** New set of this compound, or null to keep the current tyres. */
  tyres: CompoundId | null;
  /** Bodywork and aero (front, rear, sides). */
  body: boolean;
  suspension: boolean;
  engine: boolean;
  /** Fuel to add (l), with the fuel rule. */
  fuelL: number;
  /** Driver change (the pit-window rule's mandatory stop). */
  driverChange: boolean;
}

/** Damage zones: 0 front, 1 rear, 2 left, 3 right, 4 engine, 5 suspension. */
export type Zones = ArrayLike<number>;

/**
 * Service durations (s), loosely after GT3 pit work (air jacks, two wheel guns per side): a set of tyres ~14 s;
 * repairs grow with the damage. The tyre crew works while the mechanics repair, so that part lasts the longer of the
 * two, plus a couple of seconds on and off the jacks. Refuelling comes first and nothing else is done while the fuel
 * flows (SRO endurance rule), at ~2.7 l/s (a full GT3 tank in the regulation's 44 s); the driver change (20 s:
 * PIT_WINDOW.minStopMs) happens meanwhile.
 */
export const SERVICE = {
  jacks: 2,
  tyres: 14,
  refuelLps: 2.7,
  driverChange: PIT_WINDOW.minStopMs / 1000,
  body: (z: Zones) => 4 + 26 * Math.max(z[0], z[1], z[2], z[3]),
  suspension: (z: Zones) => 6 + 34 * z[5],
  engine: (z: Zones) => 8 + 52 * z[4],
};

export interface ServiceBreakdown {
  total: number;
  parts: { label: string; seconds: number }[];
}

export function serviceTime(plan: ServicePlan, z: Zones): ServiceBreakdown {
  const parts: { label: string; seconds: number }[] = [];
  let repairs = 0;
  if (plan.body) {
    const s = SERVICE.body(z);
    parts.push({ label: t('Bodywork & aero'), seconds: s });
    repairs += s;
  }
  if (plan.suspension) {
    const s = SERVICE.suspension(z);
    parts.push({ label: t('Suspension'), seconds: s });
    repairs += s;
  }
  if (plan.engine) {
    const s = SERVICE.engine(z);
    parts.push({ label: t('Engine'), seconds: s });
    repairs += s;
  }
  const tyres = plan.tyres ? SERVICE.tyres : 0;
  if (plan.tyres) parts.push({ label: t('Tyres'), seconds: tyres });
  const fuel = plan.fuelL > 0 ? plan.fuelL / SERVICE.refuelLps : 0;
  if (fuel > 0) parts.push({ label: t('Refuelling {l} l', { l: Math.round(plan.fuelL) }), seconds: fuel });
  const driver = plan.driverChange ? SERVICE.driverChange : 0;
  if (driver > 0) parts.push({ label: t('Driver change'), seconds: driver });
  const work = Math.max(tyres, repairs);
  return { total: Math.max(fuel, driver) + (work > 0 ? work + SERVICE.jacks : 0), parts };
}

/** Sensible default: repair what is damaged, fresh tyres of the right kind when worn or the weather changed. */
export function defaultPlan(z: Zones, avgWear: number, current: CompoundId, wetness: number, fuelL = 0, driverChange = false): ServicePlan {
  const wantWet = wetness > 0.35;
  const rightKind = wantWet ? current === 'wet' : current !== 'wet';
  return {
    tyres: !rightKind ? (wantWet ? 'wet' : 'medium') : avgWear > 0.25 ? current : null,
    body: Math.max(z[0], z[1], z[2], z[3]) > 0.05,
    suspension: z[5] > 0.05,
    engine: z[4] > 0.05,
    fuelL,
    driverChange,
  };
}
