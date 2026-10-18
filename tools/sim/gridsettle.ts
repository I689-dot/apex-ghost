/**
 * Grid check: every slot, a car placed as at the start and left standing for 3 s (as during the countdown).
 * Prints the slot height against the collision surface under it, and how much the car jumps, bounces or rolls.
 *
 *   pnpm tsx tools/sim/gridsettle.ts [carId]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile, Surface, TrackData } from '../../packages/shared/src/index.ts';
import { Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';
import { BOT_ASSISTS } from '../../apps/client/src/game/ai.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../apps/client/public/assets');
const cars = JSON.parse(readFileSync(path.join(pub, 'cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const carId = args.find((a) => !a.startsWith('--')) ?? '2022_mercedes_amg_project_one';
const useTrack = true;
const entry = cars.cars.find((c) => c.id === carId) ?? cars.cars[0];
const DT = 1 / 120;

await RAPIER.init();

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const surf = new Map<number, Surface>();
  if (useTrack) {
    const track = JSON.parse(readFileSync(path.join(pub, 'track.json'), 'utf8')) as TrackData;
    const buf = gunzipSync(readFileSync(path.join(pub, 'track', 'collision.apxc')));
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let o = 12;
    for (let i = 0; i < dv.getUint32(8, true); i++) {
      const si = dv.getUint32(o, true);
      const nv = dv.getUint32(o + 4, true);
      const ni = dv.getUint32(o + 8, true);
      o += 12;
      const pos = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
      o += nv * 12;
      const idx = new Uint32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + ni * 4));
      o += ni * 4;
      const c = world.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx));
      surf.set(c.handle, track.collision.surfaces[si]);
    }
  } else {
    const c = world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 1, 20000).setTranslation(0, -1, 0));
    surf.set(c.handle, 'asphalt');
  }
  // ray casts (wheels, placing a car on the ground) only see colliders once the query structure is built
  world.updateSceneQueries();
  return { world, surf };
}

function setup() {
  const { world, surf } = makeWorld();
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
  const damage = new DamageState();
  const v = new Vehicle(RAPIER, world, entry, ground, { ...BOT_ASSISTS }, damage);
  excl.body = v.body;
  const events = new RAPIER.EventQueue(true);
  return { world, v, events, ground };
}

const track = JSON.parse(readFileSync(path.join(pub, 'track.json'), 'utf8')) as TrackData;
const s = setup();
const hit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' } as GroundHit;
for (let i = 0; i < track.grid.length; i++) {
  const g = track.grid[i];
  const gh = s.ground.cast(g.p[0], g.p[1] + 5, g.p[2], 0, -1, 0, 20, hit) ? hit.py : NaN;
  s.v.place(g.p[0], g.p[1], g.p[2], g.yaw);
  let maxVy = 0;
  let maxTilt = 0;
  let y0 = 0;
  let yMin = 1e9;
  let yMax = -1e9;
  for (let k = 0; k < 360; k++) {
    s.v.step(DT, { throttle: 0, brake: 1, steer: 0, handbrake: 0 });
    s.world.step(s.events);
    const lv = s.v.body.linvel();
    const r = s.v.body.rotation();
    const tilt = Math.asin(Math.min(1, 2 * Math.hypot(r.x, r.z))) * (180 / Math.PI);
    const y = s.v.body.translation().y;
    if (k === 0) y0 = y;
    if (k > 60) {
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
    maxVy = Math.max(maxVy, Math.abs(lv.y));
    maxTilt = Math.max(maxTilt, tilt);
  }
  const p = s.v.body.translation();
  const drift = Math.hypot(p.x - g.p[0], p.z - g.p[2]);
  console.log(
    `slot ${String(i).padStart(2)}  grid y ${g.p[1].toFixed(2)}  surface ${gh.toFixed(2)}  (${(g.p[1] - gh).toFixed(2)} m)  ` +
      `max |vy| ${maxVy.toFixed(2)} m/s  settle ${(y0 - yMin).toFixed(2)} m  bounce after 0.5 s ${(yMax - yMin).toFixed(3)} m  tilt ${maxTilt.toFixed(1)}°  drift ${drift.toFixed(2)} m`,
  );
}
