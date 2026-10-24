import type { CarEntry, WeatherPlan } from '@apex/shared';
import type { CarSetup } from '../settings';
import { t } from '../i18n';
import type { VehicleSetup } from '../physics/vehicle';

/** Rear wing: downforce and drag together (more wing = more grip in corners, less top speed). */
export const WING = {
  low: { downforce: 0.82, drag: 0.9, label: 'Low (top speed)' },
  medium: { downforce: 1, drag: 1, label: 'Medium' },
  high: { downforce: 1.18, drag: 1.1, label: 'High (cornering grip)' },
} as const;

/**
 * The deeper setup, in the ranges a GT3 engineer works in. Effects measured with tools/sim/setup.ts
 * (DECISIONS.md, "Car setup depth"):
 *  - ride height ±10 mm per axle: lower = more downforce from the floor (≈ 3.5 % per 10 mm), a lower centre of
 *    mass, but less travel before the bump stops (it bottoms over kerbs); rear higher than front (rake) moves the
 *    aero balance forward (≈ 3 % per 10 mm): more front grip at speed;
 *  - anti-roll bars (clicks 1–7): a stiffer bar takes more of the load transfer on that axle, which then grips
 *    less: stiffer front = understeer, stiffer rear = oversteer;
 *  - dampers (bump / rebound, clicks 1–7, ±30 %): stiffer = quicker response, but the tyre loses contact over
 *    bumps and kerbs.
 */
export const SETUP = {
  clicks: 7,
  baseline: 4,
  arb: [0.55, 0.7, 0.85, 1, 1.2, 1.4, 1.6],
  damperPerClick: 0.1,
  rideMm: 10,
  downforcePerM: 3.5,
  dragPerM: 1,
  balancePerM: 3,
  comPerM: 0.8,
};

const clampClick = (c: number) => Math.min(SETUP.clicks, Math.max(1, Math.round(c)));

/** The car with the player's setup applied (the physics reads its specs). */
export function applySetup(entry: CarEntry, setup: CarSetup): CarEntry {
  const w = WING[setup.wing];
  const rideF = (setup.ride?.[0] ?? 0) / 1000;
  const rideR = (setup.ride?.[1] ?? 0) / 1000;
  const avg = (rideF + rideR) / 2;
  const s = entry.specs;
  return {
    ...entry,
    specs: {
      ...s,
      downforceArea: s.downforceArea * w.downforce * (1 - SETUP.downforcePerM * avg),
      dragArea: s.dragArea * w.drag * (1 - SETUP.dragPerM * avg),
      aeroBalanceFront: Math.min(0.55, Math.max(0.3, s.aeroBalanceFront + SETUP.balancePerM * (rideR - rideF))),
      comHeightM: s.comHeightM + SETUP.comPerM * avg,
      antiRollFront: s.antiRollFront * SETUP.arb[clampClick(setup.arb?.[0] ?? 4) - 1],
      antiRollRear: s.antiRollRear * SETUP.arb[clampClick(setup.arb?.[1] ?? 4) - 1],
      brakeBiasFront: Math.min(0.66, Math.max(0.54, setup.brakeBias)),
    },
  };
}

/** The part of the setup the vehicle applies itself (pressures, ride height on the springs, dampers). */
export function vehicleSetup(setup: CarSetup): VehicleSetup {
  const damper = (c: number | undefined) => 1 + SETUP.damperPerClick * (clampClick(c ?? 4) - SETUP.baseline);
  const ride = (mm: number | undefined) => Math.min(SETUP.rideMm, Math.max(-SETUP.rideMm, mm ?? 0)) / 1000;
  return {
    pressure: setup.pressure ? [setup.pressure[0], setup.pressure[1]] : null,
    ride: [ride(setup.ride?.[0]), ride(setup.ride?.[1])],
    bump: [damper(setup.bump?.[0]), damper(setup.bump?.[1])],
    rebound: [damper(setup.rebound?.[0]), damper(setup.rebound?.[1])],
  };
}

/** What an engineer would suggest for this forecast. */
export function recommendSetup(plan: WeatherPlan): { tyre: CarSetup['tyre']; wing: CarSetup['wing']; note: string } {
  const wetStart = plan.initialWetness > 0.35;
  const rainLater = !!plan.change && (plan.change.to === 'light_rain' || plan.change.to === 'heavy_rain');
  const drying = !!plan.change && wetStart && plan.change.to !== 'heavy_rain' && plan.change.to !== 'light_rain';
  if (wetStart)
    return {
      tyre: 'wet',
      wing: 'high',
      note: drying ? t('Wet start, drying later: wets now, slicks at a pit stop') : t('Wet track: wets and maximum downforce'),
    };
  if (rainLater) return { tyre: 'medium', wing: 'high', note: t('Rain on the way: mediums now, be ready to pit for wets') };
  if (plan.startHour < 8 || plan.startHour > 20) return { tyre: 'soft', wing: 'medium', note: t('Cool air: softs warm up quickly') };
  return { tyre: 'medium', wing: 'medium', note: t('Dry: mediums for a long run, softs for one fast lap') };
}
