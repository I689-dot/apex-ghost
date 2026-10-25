#!/usr/bin/env node
/**
 * A car's physics specs and real-world info from cars.config.json: the profile first, then the car's own values.
 * The power shown in the lobby is the peak of the torque curve (what the physics really makes), not a typed
 * figure that could disagree with it.
 *
 *   node tools/asset-pipeline/car_specs.mjs
 *       applies cars.config.json to the shipped cars.json (specs and info only; models, LODs and the rest stay):
 *       after editing car physics without the source models, then `pnpm tsx tools/sim/calibrate.ts --write`
 *       and this again for the drag areas
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Peak power (kW) of a torque curve ([rpm, Nm] pairs), sampled every 50 rpm between the points. */
export function peakPowerKw(curve) {
  let best = 0;
  for (let i = 1; i < curve.length; i++) {
    const [r0, t0] = curve[i - 1];
    const [r1, t1] = curve[i];
    for (let r = r0; r <= r1; r += 50) {
      const tq = t0 + ((t1 - t0) * (r - r0)) / (r1 - r0);
      best = Math.max(best, (tq * r * 2 * Math.PI) / 60 / 1000);
    }
  }
  return Math.round(best);
}

/** Specs of one car (profile, then overrides; keys starting with _ are notes). */
export function carSpecs(cfg, c) {
  const o = { ...(c.profile ? cfg.profiles[c.profile] : {}) };
  for (const [k, v] of Object.entries(c.specs ?? {})) if (!k.startsWith('_')) o[k] = v;
  for (const k of Object.keys(o)) if (k.startsWith('_')) delete o[k];
  o.powerKw = peakPowerKw(o.torqueCurve);
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cfg = JSON.parse(readFileSync(path.join(here, 'cars.config.json'), 'utf8'));
  const file = path.join(here, '../../apps/client/public/assets/cars.json');
  const cars = JSON.parse(readFileSync(file, 'utf8'));
  for (const e of cars.cars) {
    const c = cfg.cars[e.id];
    if (!c) continue;
    e.specs = carSpecs(cfg, c);
    e.info = c.info ?? null;
    e.role = c.role ?? null;
    // a hand-set eye (cars.config pipeline.cockpitEye) without converting the model again
    if (c.pipeline?.cockpitEye) e.cockpitCamera = { ...e.cockpitCamera, position: c.pipeline.cockpitEye, tuned: true };
    console.log(`${e.id.padEnd(40)} ${String(e.specs.powerKw).padStart(3)} kW  ${e.specs.massKg} kg  ClA ${e.specs.downforceArea}  Cd·A ${e.specs.dragArea}`);
  }
  writeFileSync(file, JSON.stringify(cars, null, 1));
}
