/**
 * The chassis platform on a flat pad (the real Vehicle): body pitch under hard braking from 200 km/h and under full
 * throttle from 60 km/h, and its peak pitch rate. CH='{"antiDive":0}' overrides CHASSIS values to compare.
 *
 *   pnpm tsx tools/sim/platform.ts [carId]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile } from '../../packages/shared/src/index.ts';
import { CHASSIS, Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const cars = JSON.parse(readFileSync(path.resolve(here, '../../apps/client/public/assets/cars.json'), 'utf8')) as CarsFile;
const entry = cars.cars.find((c) => c.id === (process.argv[2] ?? 'mercedes_amg_gt3_evo')) ?? cars.cars[0];
if (process.env.CH) Object.assign(CHASSIS, JSON.parse(process.env.CH));
const DT = 1 / 120;
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 1, 20000).setTranslation(0, -1, 0));
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const ex: { b?: RAPIER.RigidBody } = {};
const ground: GroundQuery = {
  cast(ox, oy, oz, dx, dy, dz, maxDist, out: GroundHit) {
    ray.origin = { x: ox, y: oy, z: oz };
    ray.dir = { x: dx, y: dy, z: dz };
    const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, ex.b);
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
ex.b = v.body;
v.place(0, 0, 0, 0);
v.setTyreTemps(85);
const ctl = (o: object) => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, ...o });
const step = (c: object) => {
  v.step(DT, ctl(c));
  world.step();
};
const pitch = () => {
  const q = v.body.rotation();
  // nose-down positive: the forward axis's drop
  const fy = 2 * (q.y * q.z - q.x * q.w);
  return (Math.asin(Math.max(-1, Math.min(1, -fy))) * 180) / Math.PI;
};
for (let i = 0; i < 240; i++) step({});
const p0 = pitch();
while (v.telemetry.speed * 3.6 < 200) step({ throttle: 1 });
let brakeMax = 0;
let rate = 0;
let last = pitch();
for (let i = 0; i < 120 * 2.5; i++) {
  step({ brake: 1 });
  const p = pitch();
  brakeMax = Math.max(brakeMax, p - p0);
  rate = Math.max(rate, Math.abs(p - last) / DT);
  last = p;
}
v.place(0, 0, 0, 0);
for (let i = 0; i < 240; i++) step({});
while (v.telemetry.speed * 3.6 < 60) step({ throttle: 0.4 });
let squat = 0;
for (let i = 0; i < 120 * 2; i++) {
  step({ throttle: 1 });
  squat = Math.min(squat, pitch() - p0);
}
console.log(
  `${entry.name}: braking 200 km/h nose down ${brakeMax.toFixed(2)}°, peak pitch rate ${rate.toFixed(1)}°/s · full throttle from 60 km/h squat ${(-squat).toFixed(2)}°`,
);
