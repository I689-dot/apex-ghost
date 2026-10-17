/**
 * Drag calibration: finds, for every car, the drag area Cd·A at which the simulated car (real client
 * Vehicle code, flat pad, full throttle) tops out at its spec top speed. Downforce, tyre rolling
 * resistance and gearing are all included, so the result matches what players see in game.
 *
 *   pnpm tsx tools/sim/calibrate.ts          # print the values
 *   pnpm tsx tools/sim/calibrate.ts --write  # also store them as per-car overrides in cars.config.json
 *
 * Re-run after changing power, downforce or gearing, then regenerate cars.json with
 * `node tools/asset-pipeline/optimize.mjs --only cars --car __none__`.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarEntry, CarsFile } from '../../packages/shared/src/index.ts';
import { Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../apps/client/public/assets');
const cfgPath = path.resolve(here, '../asset-pipeline/cars.config.json');
const cars = JSON.parse(readFileSync(path.join(pub, 'cars.json'), 'utf8')) as CarsFile;
const write = process.argv.includes('--write');
const DT = 1 / 120;

await RAPIER.init();

/** Terminal speed (km/h) after 75 s at full throttle on a flat pad. */
function topSpeed(entry: CarEntry): number {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(40000, 1, 40000).setTranslation(0, -1, 0));
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const ground: GroundQuery = {
    cast(ox, oy, oz, dx, dy, dz, maxDist, out: GroundHit) {
      ray.origin = { x: ox, y: oy, z: oz };
      ray.dir = { x: dx, y: dy, z: dz };
      const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, (1 << 16) | 1);
      if (!hit) return null;
      out.dist = hit.timeOfImpact;
      out.px = ox + dx * hit.timeOfImpact;
      out.py = oy + dy * hit.timeOfImpact;
      out.pz = oz + dz * hit.timeOfImpact;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.surface = 'asphalt';
      return out;
    },
  };
  const v = new Vehicle(RAPIER, world, entry, ground, { abs: true, tc: 1, stability: false, steering: false }, new DamageState());
  v.place(0, 0, -30000, 0);
  const events = new RAPIER.EventQueue(true);
  let vmax = 0;
  for (let i = 0; i < 120 * 75; i++) {
    v.step(DT, { throttle: i > 60 ? 1 : 0, brake: 0, steer: 0, handbrake: 0 });
    world.step(events);
    vmax = Math.max(vmax, v.telemetry.speed * 3.6);
  }
  world.free();
  return vmax;
}

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
for (const entry of cars.cars) {
  const target = entry.specs.topSpeedKmh;
  let lo = 0.4;
  let hi = 1.6;
  let best = entry.specs.dragArea;
  for (let it = 0; it < 9; it++) {
    const mid = (lo + hi) / 2;
    const top = topSpeed({ ...entry, specs: { ...entry.specs, dragArea: mid } });
    if (top > target) lo = mid;
    else hi = mid;
    best = mid;
  }
  best = Math.round(best * 100) / 100;
  const check = topSpeed({ ...entry, specs: { ...entry.specs, dragArea: best } });
  console.log(`${entry.id.padEnd(40)} Cd·A ${entry.specs.dragArea.toFixed(2)} → ${best.toFixed(2)} m²  (top ${check.toFixed(0)} km/h, spec ${target})`);
  if (write) {
    const c = cfg.cars[entry.id];
    c.specs ??= {};
    c.specs.dragArea = best;
  }
}
if (write) {
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log('cars.config.json updated');
}
