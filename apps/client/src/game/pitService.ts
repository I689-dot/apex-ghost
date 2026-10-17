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
}

/** Damage zones: 0 front, 1 rear, 2 left, 3 right, 4 engine, 5 suspension. */
export type Zones = ArrayLike<number>;

/**
 * Service durations (s), loosely after GT3 pit work (air jacks, two wheel guns per side, no refuelling here):
 * a set of tyres ~14 s; repairs grow with the damage. The tyre crew works while the mechanics repair, so the
 * stop lasts the longer of the two, plus a couple of seconds on and off the jacks.
 */
export const SERVICE = {
  jacks: 2,
  tyres: 14,
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
  const work = Math.max(tyres, repairs);
  return { total: work > 0 ? work + SERVICE.jacks : 0, parts };
}

/** Sensible default: repair what is damaged, fresh tyres of the right kind when worn or the weather changed. */
export function defaultPlan(z: Zones, avgWear: number, current: CompoundId, wetness: number): ServicePlan {
  const wantWet = wetness > 0.35;
  const rightKind = wantWet ? current === 'wet' : current !== 'wet';
  return {
    tyres: !rightKind ? (wantWet ? 'wet' : 'medium') : avgWear > 0.25 ? current : null,
    body: Math.max(z[0], z[1], z[2], z[3]) > 0.05,
    suspension: z[5] > 0.05,
    engine: z[4] > 0.05,
  };
}
