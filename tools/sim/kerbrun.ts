/**
 * Kerb strike test: a car driven across a stretch at a set speed on a set line (lateral offset from the centreline,
 * + = left), as a player who runs over a kerb. Reports the body's worst roll and pitch, its vertical speed, the
 * heave (vertical acceleration) and whether it went over.
 *
 *   pnpm tsx tools/sim/kerbrun.ts --track spa --from 2560 --to 2680 --kmh 100 --lat 5.6 [carId]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile, Surface, TrackData } from '../../packages/shared/src/index.ts';
import { Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';
import { cutWallsAcrossLine } from '../../apps/client/src/game/wallCut.ts';
import { RoadPatches } from '../../apps/client/src/game/roadPatches.ts';
import { collisionParts, loadTrack, readCollisionFile, trackArg } from './trackfile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cars = JSON.parse(readFileSync(path.resolve(here, '../../apps/client/public/assets/cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const vals = new Set(
  ['--track', '--from', '--to', '--kmh', '--lat', '--lat2', '--collision'].flatMap((k) => (args.includes(k) ? [args[args.indexOf(k) + 1]] : [])),
);
const carId = args.find((a) => !a.startsWith('--') && !vals.has(a)) ?? '2024_porsche_992_gt3_r';
const entry = cars.cars.find((c) => c.id === carId) ?? cars.cars[0];
const loaded = loadTrack(trackArg(args));
const track = loaded.track as TrackData;
const FROM = Number(opt('from', '2560'));
const TO = Number(opt('to', '2680'));
const KMH = Number(opt('kmh', '100'));
const LAT = Number(opt('lat', '5.6'));
/** The line at the end of the stretch (a diagonal across the kerb when it differs from --lat). */
const LAT2 = Number(opt('lat2', String(LAT)));
const DT = 1 / 120;
await RAPIER.init();

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
const surf = new Map<number, Surface>();
{
  const colF = opt('collision', '');
  for (const part of collisionParts(colF ? readCollisionFile(colF) : loaded.collision)) {
    const surface = track.collision.surfaces[part.surface];
    const idx = surface === 'wall' ? cutWallsAcrossLine(part.pos, part.idx, track) : part.idx;
    const c = world.createCollider(RAPIER.ColliderDesc.trimesh(part.pos, idx));
    surf.set(c.handle, surface);
  }
}
world.updateSceneQueries();
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const excl: { body?: RAPIER.RigidBody } = {};
const down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const patches = RoadPatches.build(track, (x, yTop, z, maxD) => {
  down.origin = { x, y: yTop, z };
  const h = world.castRay(down, maxD, true);
  if (!h || surf.get(h.collider.handle) === 'wall') return null;
  return yTop - h.timeOfImpact;
});
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
    if (out.surface !== 'wall') patches?.apply(ox, oy, oz, dx, dy, dz, maxDist, out);
    return out;
  },
};

/** The centreline point at lap distance s, offset sideways by lat (+ left), and the heading there. */
function at(s: number, lat: number) {
  const L = track.length;
  s = ((s % L) + L) % L;
  let i = 0;
  while (i < track.cumS.length - 1 && track.cumS[i + 1] <= s) i++;
  const n = track.cumS.length;
  const j = (i + 1) % n;
  const cl = track.centerline;
  const u = (s - track.cumS[i]) / Math.max(1e-6, (j ? track.cumS[j] : L) - track.cumS[i]);
  const x = cl[i * 3] + (cl[j * 3] - cl[i * 3]) * u;
  const y = cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * u;
  const z = cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * u;
  const yaw = Math.atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]);
  // left normal (cos yaw, -sin yaw)
  return { x: x + Math.cos(yaw) * lat, y, z: z - Math.sin(yaw) * lat, yaw };
}

const v = new Vehicle(RAPIER, world, entry, ground, { abs: true, tc: 1, stability: false, steering: false }, new DamageState());
excl.body = v.body;
// start 40 m before on the same line, already at speed
const p0 = at(FROM - 40, LAT * 0.4);
v.place(p0.x, p0.y + 0.3, p0.z, p0.yaw);
const sp = KMH / 3.6;
v.body.setLinvel({ x: Math.sin(p0.yaw) * sp, y: 0, z: Math.cos(p0.yaw) * sp }, true);
let s = FROM - 40;
let maxRoll = 0;
let maxPitch = 0;
let maxVy = 0;
let maxHeave = 0;
let air = 0;
let flipped = false;
let prevVy = 0;
let worstAt = 0;
for (let k = 0; k < 120 * 20 && s < TO; k++) {
  const p = v.body.translation();
  // progress: the nearest of a window of stations ahead
  let best = s;
  let bd = Infinity;
  for (let d = -5; d <= 15; d += 0.5) {
    const q = at(s + d, 0);
    const dd = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (dd < bd) {
      bd = dd;
      best = s + d;
    }
  }
  s = best;
  // steer at a point 12 m ahead on the line (onto the kerb once in the stretch)
  const lat = s < FROM ? LAT * (0.4 + 0.6 * Math.min(1, (s - (FROM - 40)) / 40)) : LAT + (LAT2 - LAT) * Math.min(1, (s - FROM) / (TO - FROM));
  const tgt = at(s + 12, lat);
  const q = v.body.rotation();
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const heading = Math.atan2(fx, fz);
  const want = Math.atan2(tgt.x - p.x, tgt.z - p.z);
  let err = want - heading;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const speed = v.telemetry.speed;
  const c = {
    throttle: speed < sp ? Math.min(1, (sp - speed) * 0.5) : 0,
    brake: speed > sp + 2 ? 0.3 : 0,
    steer: Math.max(-1, Math.min(1, err * Number(process.env.GAIN ?? 2.5))),
    handbrake: 0,
    analog: true,
  };
  v.step(DT, c);
  world.step();
  const lv = v.body.linvel();
  // the body's up vector: roll and pitch from it
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  const tilt = Math.acos(Math.max(-1, Math.min(1, uy))) * (180 / Math.PI);
  const rx = 2 * (q.x * q.y + q.w * q.z); // right vector y (roll)
  const roll = Math.abs(Math.asin(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z) === uy ? 2 * (q.x * q.y + q.w * q.z) : rx)))) * (180 / Math.PI);
  const pitch = Math.abs(Math.asin(Math.max(-1, Math.min(1, fx * 0 + 2 * (q.y * q.z - q.w * q.x))))) * (180 / Math.PI);
  void ux;
  void uz;
  if (roll > maxRoll) {
    maxRoll = roll;
    worstAt = s;
  }
  maxPitch = Math.max(maxPitch, pitch);
  maxVy = Math.max(maxVy, Math.abs(lv.y));
  const hv = Math.abs(lv.y - prevVy) / DT;
  if (hv > maxHeave && process.env.KERB_DEBUG) {
    const cl = track.centerline;
    let bi = 0;
    let bd2 = Infinity;
    for (let i = 0; i < cl.length / 3; i++) {
      const d2 = (cl[i * 3] - p.x) ** 2 + (cl[i * 3 + 2] - p.z) ** 2;
      if (d2 < bd2) {
        bd2 = d2;
        bi = i;
      }
    }
    const touching: string[] = [];
    world.contactPairsWith(v.collider, (other) => touching.push(surf.get(other.handle) ?? '?'));
    console.log(
      `  jolt ${(hv / 9.81).toFixed(1)} g at s ${s.toFixed(1)} off-centre ${Math.sqrt(bd2).toFixed(1)} m, y ${p.y.toFixed(2)} (road ${cl[bi * 3 + 1].toFixed(2)}), wheels ${v.wheels.map((w) => (w.contact ? w.surface : 'air')).join('/')}, body touching [${touching.join(',')}]`,
    );
  }
  maxHeave = Math.max(maxHeave, hv);
  prevVy = lv.y;
  if (v.wheels.every((w) => !w.contact)) air++;
  if (tilt > 70) flipped = true;
}
console.log(
  `${entry.name} ${KMH} km/h on lat ${LAT} m, ${FROM}-${TO} m: max roll ${maxRoll.toFixed(1)}° (at ${worstAt.toFixed(0)} m), pitch ${maxPitch.toFixed(1)}°, |vy| ${maxVy.toFixed(2)} m/s, heave ${(maxHeave / 9.81).toFixed(1)} g, all wheels off ${(air / 120).toFixed(2)} s${flipped ? ', ROLLED OVER' : ''}, reached ${s.toFixed(0)} m`,
);
