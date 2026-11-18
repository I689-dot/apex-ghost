/**
 * Ride scan: the real car (Vehicle on the collision mesh, with the road patches) driven along lanes across the whole
 * road (a share of the width either side of the centreline, plus the kerbs at the track limits) at a share of the
 * bots' planned speed, as a player off the racing line. Per 10 m of every lane it logs the body's worst heave
 * (vertical acceleration) and the wheels' worst load jump, and lists the spots where the ride is rough, worst first.
 *
 *   pnpm tsx tools/sim/ridescan.ts --track spa --from 2300 --to 4700 [--pace 0.8] [--min 5] [--lanes -0.85,...] [carId]
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
import { carLimits, racingLineFor, speedProfile } from '../../apps/client/src/game/ai.ts';
import { collisionParts, loadTrack, readCollisionFile, trackArg } from './trackfile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cars = JSON.parse(readFileSync(path.resolve(here, '../../apps/client/public/assets/cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const vals = new Set(
  ['--track', '--from', '--to', '--pace', '--min', '--lanes', '--collision'].flatMap((k) => (args.includes(k) ? [args[args.indexOf(k) + 1]] : [])),
);
const carId = args.find((a) => !a.startsWith('--') && !vals.has(a)) ?? '2024_porsche_992_gt3_r';
const entry = cars.cars.find((c) => c.id === carId) ?? cars.cars[0];
const loaded = loadTrack(trackArg(args));
const track = loaded.track as TrackData;
const FROM = Number(opt('from', '0'));
const TO = Number(opt('to', String(track.length)));
const PACE = Number(opt('pace', '0.8'));
const MIN = Number(opt('min', '5'));
/** Lanes: a share of the road's half width (+ left), or "kL" / "kR" for the kerb at that side's track limit. */
const LANES = opt('lanes', 'kR,-0.8,-0.5,-0.2,0,0.2,0.5,0.8,kL').split(',');
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
    surf.set(world.createCollider(RAPIER.ColliderDesc.trimesh(part.pos, idx)).handle, surface);
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

const L = track.length;
const n = track.cumS.length;
const cl = track.centerline;
function idx(s: number): number {
  s = ((s % L) + L) % L;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (track.cumS[m] <= s) lo = m;
    else hi = m - 1;
  }
  return lo;
}
/** The lane's offset (+ left) at lap distance s. */
function laneLat(lane: string, s: number): number {
  const i = idx(s);
  const limL = track.limitL?.[i] ?? track.widthL[i];
  const limR = track.limitR?.[i] ?? track.widthR[i];
  if (lane === 'kL') return Math.max(track.widthL[i], limL) - 0.6;
  if (lane === 'kR') return -(Math.max(track.widthR[i], limR) - 0.6);
  const f = Number(lane);
  return f * (f >= 0 ? track.widthL[i] - 1.1 : track.widthR[i] - 1.1);
}
function at(s: number, lat: number) {
  s = ((s % L) + L) % L;
  const i = idx(s);
  const j = (i + 1) % n;
  const u = (s - track.cumS[i]) / Math.max(1e-6, (j ? track.cumS[j] : L) - track.cumS[i]);
  const x = cl[i * 3] + (cl[j * 3] - cl[i * 3]) * u;
  const y = cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * u;
  const z = cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * u;
  const yaw = Math.atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]);
  return { x: x + Math.cos(yaw) * lat, y, z: z - Math.sin(yaw) * lat, yaw };
}

// the planned speed (the bots' profile on the racing line), a share of it: a lane off the line is a different radius
const prof = speedProfile(racingLineFor(track), carLimits(entry.specs));

interface Spot {
  lane: string;
  s: number;
  lat: number;
  kmh: number;
  heave: number;
  load: number;
  wheels: string;
}
const spots: Spot[] = [];
for (const lane of LANES) {
  const v = new Vehicle(RAPIER, world, entry, ground, { abs: true, tc: 1, stability: true, steering: false }, new DamageState());
  excl.body = v.body;
  const start = FROM - 60;
  const p0 = at(start, laneLat(lane, start));
  v.place(p0.x, p0.y + 0.3, p0.z, p0.yaw);
  v.setTyreTemps(85);
  const sp0 = prof[idx(start)] * PACE;
  v.body.setLinvel({ x: Math.sin(p0.yaw) * sp0, y: 0, z: Math.cos(p0.yaw) * sp0 }, true);
  let s = start;
  let prevVy = 0;
  const prevLoad = [0, 0, 0, 0];
  const bins = new Map<number, Spot>();
  let lost = 0;
  let k = 0;
  for (; k < 120 * 600 && s < TO; k++) {
    const p = v.body.translation();
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
    const speed = v.telemetry.speed;
    const look = 6 + 0.25 * speed;
    const tgt = at(s + look, laneLat(lane, s + look));
    const q = v.body.rotation();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    let err = Math.atan2(tgt.x - p.x, tgt.z - p.z) - Math.atan2(fx, fz);
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    // brake ahead of time for the slowest point of the next stretch
    let vt = Infinity;
    for (let d = 0; d <= 200; d += 5) vt = Math.min(vt, Math.sqrt((prof[idx(s + d)] * PACE) ** 2 + 2 * 9 * d));
    const steerAngle = Math.atan((2 * v.wheelbase * Math.sin(err)) / look);
    v.step(DT, {
      throttle: speed < vt ? Math.min(1, (vt - speed) * 0.4) : 0,
      brake: speed > vt + 1 ? Math.min(1, (speed - vt) * 0.3) : 0,
      steer: Math.max(-1, Math.min(1, steerAngle / v.maxSteer)),
      handbrake: 0,
      digital: false,
    });
    world.step();
    const vy = v.body.linvel().y;
    const heave = k > 0 ? Math.abs(vy - prevVy) / DT : 0;
    prevVy = vy;
    // a wheel's load jump in one step (in g of the car's weight share)
    let load = 0;
    v.wheels.forEach((w, wi) => {
      const f = w.contact ? w.fz : 0;
      if (k > 0) load = Math.max(load, Math.abs(f - prevLoad[wi]) / ((v.mass * 9.81) / 4));
      prevLoad[wi] = f;
    });
    const lat = laneLat(lane, s);
    const off = Math.hypot(p.x - at(s, lat).x, p.z - at(s, lat).z);
    if (off > 2.5) lost += DT;
    if (s < FROM || off > 2.5 || k < 120) continue;
    const b = Math.floor(s / 10) * 10;
    const prev = bins.get(b);
    if (!prev || heave > prev.heave || load > prev.load)
      bins.set(b, {
        lane,
        s: Math.round(s),
        lat: Math.round(lat * 10) / 10,
        kmh: Math.round(speed * 3.6),
        heave: Math.max(heave, prev?.heave ?? 0),
        load: Math.max(load, prev?.load ?? 0),
        wheels: v.wheels.map((w) => (w.contact ? w.surface : 'air')).join('/'),
      });
  }
  // off the world before the next lane (a car left standing where it stopped is an obstacle for the next one)
  v.dispose();
  const rough = [...bins.values()].filter((x) => x.heave > MIN);
  spots.push(...rough);
  console.log(`lane ${lane}: reached ${s.toFixed(0)} m, ${lost.toFixed(1)} s off the lane, ${rough.length} rough 10 m bins`);
}
spots.sort((a, b) => b.heave - a.heave);
console.log(`\nrough spots (heave over ${MIN} m/s²), worst first:`);
for (const x of spots.slice(0, 80))
  console.log(
    `  ${String(x.s).padStart(5)} m  lane ${x.lane.padStart(4)} (lat ${x.lat.toFixed(1).padStart(5)})  ${String(x.kmh).padStart(3)} km/h  heave ${x.heave.toFixed(1).padStart(5)} m/s²  wheel load jump ${x.load.toFixed(2)}  ${x.wheels}`,
  );
// where along the lap, all lanes together (per 50 m)
const per = new Map<number, number>();
for (const x of spots) per.set(Math.floor(x.s / 50) * 50, Math.max(per.get(Math.floor(x.s / 50) * 50) ?? 0, x.heave));
console.log(
  `\nper 50 m (worst heave of any lane): ${[...per.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, h]) => `${s}:${h.toFixed(0)}`)
    .join(' ')}`,
);
