/**
 * How far each car's rear steps out at the limit (the "it drifts too much" check), on a flat pad with the real
 * Vehicle code: body slip angle β (the angle between where the car points and where it goes) and the yaw overshoot.
 * A GT3 car on slicks peaks at ~3–6° of β when driven hard and stays under ~8° on a clumsy throttle with TC;
 * double figures is a drift.
 *
 *   pnpm tsx tools/sim/drift.ts [carId ...] [--tc=0|1|2]
 *
 *   exit   : at the limit in a 100 km/h corner, full throttle while the steering unwinds (power oversteer)
 *   lift   : at the limit at 150 km/h on 60 % throttle, the throttle snapped shut (lift-off oversteer)
 *   trail  : 180 km/h, brakes at 60 % while turning in (trail-braking oversteer)
 *   slalom : 120 km/h, full lock left then right (snap oversteer)
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile, Surface } from '../../packages/shared/src/index.ts';
import { CHASSIS, Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';
import type { Controls } from '../../apps/client/src/physics/input.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../apps/client/public/assets');
const cars = JSON.parse(readFileSync(path.join(pub, 'cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const tcArg = args.find((a) => a.startsWith('--tc='));
const TC = (tcArg ? Number(tcArg.slice(5)) : 1) as 0 | 1 | 2;
const want = args.filter((a) => !a.startsWith('--'));
const list = cars.cars.filter((c) => c.role !== 'safety' && (!want.length || want.includes(c.id)));
const DT = 1 / 120;
// experiments: CH='{"yawRear":0.1}' overrides chassis constants
if (process.env.CH) Object.assign(CHASSIS, JSON.parse(process.env.CH));
await RAPIER.init();

function setup(entry: (typeof list)[number]) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const surf = new Map<number, Surface>();
  const c = world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 1, 20000).setTranslation(0, -1, 0));
  surf.set(c.handle, 'asphalt');
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const excl: { body?: RAPIER.RigidBody } = {};
  const ground: GroundQuery = {
    cast(ox, oy, oz, dx, dy, dz, maxDist, out: GroundHit) {
      ray.origin = { x: ox, y: oy, z: oz };
      ray.dir = { x: dx, y: dy, z: dz };
      const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, excl.body);
      if (!hit) return null;
      out.dist = hit.timeOfImpact;
      out.px = ox + dx * hit.timeOfImpact;
      out.py = oy + dy * hit.timeOfImpact;
      out.pz = oz + dz * hit.timeOfImpact;
      let { x, y, z } = hit.normal;
      if (x * dx + y * dy + z * dz > 0) [x, y, z] = [-x, -y, -z];
      out.nx = x;
      out.ny = y;
      out.nz = z;
      out.surface = surf.get(hit.collider.handle) ?? 'asphalt';
      return out;
    },
  };
  const v = new Vehicle(RAPIER, world, entry, ground, { abs: true, tc: TC, stability: false, steering: false }, new DamageState());
  excl.body = v.body;
  v.place(0, 0, 0, 0);
  v.setTyreTemps(85);
  const events = new RAPIER.EventQueue(true);
  return { world, v, events };
}
type S = ReturnType<typeof setup>;
const ctl = (o: Partial<Controls> = {}): Controls => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, ...o });
const step = (s: S, c: Controls) => {
  s.v.step(DT, c);
  s.world.step(s.events);
};
const kmh = (s: S) => s.v.telemetry.speed * 3.6;

/** Up to speed in a straight line, then hold it. */
function upTo(s: S, target: number) {
  for (let i = 0; i < 120; i++) step(s, ctl());
  let n = 0;
  while (kmh(s) < target && n++ < 120 * 40) step(s, ctl({ throttle: 1 }));
}

/** Holds the speed with the throttle while the steering ramps to `steer`, then holds there; returns the steer that
 * gave the most lateral g without the rear going (the car's limit at that speed). */
function findLimit(entry: (typeof list)[number], speed: number): number {
  let best = 0.1;
  let bestG = 0;
  for (let st = 0.06; st <= 0.6; st += 0.03) {
    const s = setup(entry);
    upTo(s, speed);
    let g = 0;
    let beta = 0;
    for (let i = 0; i < 120 * 3; i++) {
      const thr = kmh(s) < speed ? 0.7 : 0.25;
      step(s, ctl({ throttle: thr, steer: Math.min(st, (i / 120) * st * 2) }));
      if (i > 240) {
        g = Math.abs(s.v.body.angvel().y * s.v.telemetry.speed) / 9.81;
        beta = Math.abs(s.v.telemetry.slipBody);
      }
    }
    if (beta > 0.12) break;
    if (g > bestG) {
      bestG = g;
      best = st;
    }
  }
  return best;
}

function run(entry: (typeof list)[number]) {
  const out: Record<string, string> = {};
  const deg = (r: number) => (r * 57.3).toFixed(1);
  // exit
  {
    const st = findLimit(entry, 100);
    const s = setup(entry);
    upTo(s, 100);
    for (let i = 0; i < 120 * 3; i++) step(s, ctl({ throttle: kmh(s) < 100 ? 0.7 : 0.25, steer: Math.min(st, (i / 120) * st * 2) }));
    let peak = 0;
    for (let i = 0; i < 120 * 2.5; i++) {
      const k = Math.max(0, 1 - i / (120 * 1.5));
      step(s, ctl({ throttle: 1, steer: st * k }));
      peak = Math.max(peak, Math.abs(s.v.telemetry.slipBody));
    }
    out.exit = deg(peak);
  }
  // lift
  {
    const st = findLimit(entry, 150);
    const s = setup(entry);
    upTo(s, 150);
    for (let i = 0; i < 120 * 3; i++) step(s, ctl({ throttle: kmh(s) < 150 ? 0.7 : 0.3, steer: Math.min(st, (i / 120) * st * 2) }));
    let peak = 0;
    for (let i = 0; i < 120 * 2; i++) {
      step(s, ctl({ throttle: 0, steer: st }));
      peak = Math.max(peak, Math.abs(s.v.telemetry.slipBody));
    }
    out.lift = deg(peak);
  }
  // trail braking
  {
    const s = setup(entry);
    upTo(s, 180);
    let peak = 0;
    for (let i = 0; i < 120 * 2; i++) {
      step(s, ctl({ brake: 0.6, steer: Math.min(0.25, (i / 120) * 0.4) }));
      if (kmh(s) > 20) peak = Math.max(peak, Math.abs(s.v.telemetry.slipBody));
    }
    out.trail = deg(peak);
  }
  // slalom
  {
    const s = setup(entry);
    upTo(s, 120);
    let peak = 0;
    for (let i = 0; i < 120 * 3; i++) {
      const ph = Math.floor(i / 60) % 2 ? -1 : 1;
      step(s, ctl({ throttle: 0.5, steer: 0.35 * ph }));
      peak = Math.max(peak, Math.abs(s.v.telemetry.slipBody));
    }
    out.slalom = deg(peak);
  }
  return out;
}

console.log(`TC ${TC}   peak body slip β (°)`);
console.log('car'.padEnd(36) + 'exit  lift  trail slalom');
for (const c of list) {
  const r = run(c);
  console.log(c.id.padEnd(36) + [r.exit, r.lift, r.trail, r.slalom].map((x) => x.padStart(5)).join(' '));
}
