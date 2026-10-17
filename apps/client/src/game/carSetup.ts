import type { CarEntry, WeatherPlan } from '@apex/shared';
import type { CarSetup } from '../settings';

/** Rear wing: downforce and drag together (more wing = more grip in corners, less top speed). */
export const WING = {
  low: { downforce: 0.82, drag: 0.9, label: 'Low (top speed)' },
  medium: { downforce: 1, drag: 1, label: 'Medium' },
  high: { downforce: 1.18, drag: 1.1, label: 'High (cornering grip)' },
} as const;

/** The car with the player's setup applied (the physics reads its specs). */
export function applySetup(entry: CarEntry, setup: CarSetup): CarEntry {
  const w = WING[setup.wing];
  return {
    ...entry,
    specs: {
      ...entry.specs,
      downforceArea: entry.specs.downforceArea * w.downforce,
      dragArea: entry.specs.dragArea * w.drag,
      brakeBiasFront: Math.min(0.66, Math.max(0.54, setup.brakeBias)),
    },
  };
}

/** What an engineer would suggest for this forecast. */
export function recommendSetup(plan: WeatherPlan): { tyre: CarSetup['tyre']; wing: CarSetup['wing']; note: string } {
  const wetStart = plan.initialWetness > 0.35;
  const rainLater = !!plan.change && (plan.change.to === 'light_rain' || plan.change.to === 'heavy_rain');
  const drying = !!plan.change && wetStart && plan.change.to !== 'heavy_rain' && plan.change.to !== 'light_rain';
  if (wetStart)
    return { tyre: 'wet', wing: 'high', note: drying ? 'Wet start, drying later: wets now, slicks at a pit stop' : 'Wet track: wets and maximum downforce' };
  if (rainLater) return { tyre: 'medium', wing: 'high', note: 'Rain on the way: mediums now, be ready to pit for wets' };
  if (plan.startHour < 8 || plan.startHour > 20) return { tyre: 'soft', wing: 'medium', note: 'Cool air: softs warm up quickly' };
  return { tyre: 'medium', wing: 'medium', note: 'Dry: mediums for a long run, softs for one fast lap' };
}
