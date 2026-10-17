/**
 * Keyboard steering response at speed, per car: a key tap (0.35 s) and a held key (1.5 s) at 120 / 200 / 250 km/h.
 * Prints peak yaw rate, peak lateral g, peak body slip and heading change, so cars that turn in far harder than
 * the rest (or spin) stand out.
 *
 *   pnpm tsx tools/sim/steerresp.ts [--car id]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarEntry, CarsFile } from '../../packages/shared/src/index.ts';
import { Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../apps/client/public/assets');
const cars = JSON.parse(readFileSync(path.join(pub, 'cars.json'), 'utf8')) as CarsFile;
const DT = 1 / 120;

await RAPIER.init();

const only = process.argv.includes('--car') ? process.argv[process.argv.indexOf('--car') + 1] : null;

function run(entry: CarEntry, kmh: number, holdS: number) {
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
  const target = kmh / 3.6;
  let t = 0;
  let reached = -1;
  let yaw0 = 0;
  let yawPeak = 0;
  let latPeak = 0;
  let slipPeak = 0;
  let heading = 0;
  const yawOf = () => {
    const q = v.body.rotation();
    return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
  };
  for (let i = 0; i < 120 * 90; i++) {
    const sp = v.telemetry.forwardSpeed;
    if (reached < 0 && sp >= target) {
      reached = t;
      yaw0 = yawOf();
    }
    const ts = reached < 0 ? -1 : t - reached;
    const steer = ts >= 0.3 && ts < 0.3 + holdS ? 1 : 0;
    const throttle = reached < 0 ? 1 : Math.max(0, Math.min(1, (target - sp) * 0.5 + 0.35));
    v.step(DT, { throttle, brake: 0, steer, handbrake: 0, digital: true } as never);
    world.step(events);
    t += DT;
    if (ts >= 0.3) {
      const av = v.body.angvel();
      yawPeak = Math.max(yawPeak, Math.abs(av.y));
      latPeak = Math.max(latPeak, Math.abs(v.telemetry.latAccel) / 9.81);
      slipPeak = Math.max(slipPeak, Math.abs(v.telemetry.slipBody));
      let d = yawOf() - yaw0;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      heading = Math.max(heading, Math.abs(d));
      if (ts > 0.3 + holdS + 1.0) break;
    }
  }
  world.free();
  if (reached < 0) return null;
  return { yaw: (yawPeak * 180) / Math.PI, g: latPeak, slip: (slipPeak * 180) / Math.PI, head: (heading * 180) / Math.PI };
}

console.log('car'.padEnd(38), ...[120, 200, 250].map((k) => `${k}tap yaw°/s g slip°`.padEnd(24)), '250hold yaw g slip head');
for (const entry of cars.cars) {
  if (only && entry.id !== only) continue;
  const cols = [120, 200, 250].map((k) => {
    const r = run(entry, k, 0.35);
    return r ? `${r.yaw.toFixed(1).padStart(5)} ${r.g.toFixed(2)} ${r.slip.toFixed(1).padStart(4)}`.padEnd(24) : 'n/a'.padEnd(24);
  });
  const h = run(entry, 250, 1.5);
  console.log(entry.id.padEnd(38), ...cols, h ? `${h.yaw.toFixed(1)} ${h.g.toFixed(2)} ${h.slip.toFixed(1)} ${h.head.toFixed(0)}` : 'n/a');
}
