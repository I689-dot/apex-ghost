/**
 * Bot pit stop check: one AI car on the real track is asked to stop (or to drive through) on its first lap and
 * must enter the pit lane, stop at its box, wait for the crew, and rejoin. Prints the lane progress every second
 * while it is in the lane, and fails (exit 1) when it doesn't get back out in time.
 *
 *   pnpm tsx tools/sim/pitstop.ts [carId] [--track id] [--through] [--slot 3]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile, Surface, TrackData } from '../../packages/shared/src/index.ts';
import { TRACK_GROUPS, Vehicle, WALL_GROUPS, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';
import { AiDriver, BOT_ASSISTS } from '../../apps/client/src/game/ai.ts';
import { PitLaneMonitor } from '../../apps/client/src/game/pitLane.ts';
import { COMPOUNDS } from '../../apps/client/src/physics/tyres.ts';
import { loadTrack, trackArg } from './trackfile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cars = JSON.parse(readFileSync(path.resolve(here, '../../apps/client/public/assets/cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const optVals = new Set(['--track', '--slot'].flatMap((k) => (args.includes(k) ? [args[args.indexOf(k) + 1]] : [])));
const carId = args.find((a) => !a.startsWith('--') && !optVals.has(a)) ?? '2024_porsche_992_gt3_r';
const entry = cars.cars.find((c) => c.id === carId) ?? cars.cars[0];
const slot = Number(opt('slot', '3'));
const through = args.includes('--through');
const DT = 1 / 120;
const loaded = loadTrack(trackArg(args));
const track = loaded.track as TrackData;

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
const surf = new Map<number, Surface>();
{
  const buf = loaded.collision;
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
    const wall = track.collision.surfaces[si] === 'wall';
    surf.set(
      world.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx).setCollisionGroups(wall ? WALL_GROUPS : TRACK_GROUPS)).handle,
      track.collision.surfaces[si],
    );
  }
}
world.updateSceneQueries();
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const excl: { body?: RAPIER.RigidBody } = {};
const ground: GroundQuery = {
  cast(ox, oy, oz, dx, dy, dz, maxDist, out: GroundHit) {
    ray.origin = { x: ox, y: oy, z: oz };
    ray.dir = { x: dx, y: dy, z: dz };
    const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, (0xffff << 16) | 5, undefined, excl.body);
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
const v = new Vehicle(RAPIER, world, entry, ground, { ...BOT_ASSISTS }, new DamageState());
excl.body = v.body;
const g = track.grid[slot] ?? track.grid[0];
v.place(g.p[0], g.p[1], g.p[2], g.yaw);
v.setAir(20, 32, 1.2);
v.fitTyres(COMPOUNDS.medium, 32);
const ai = new AiDriver(track, v, 0.95, 0);
const pit = new PitLaneMonitor(track);
const [a, b] = pit.boxes()[pit.boxOf(slot)];
ai.pitBox = Math.round((a + b) / 2);
ai.pitRequest = through ? 'through' : 'stop';
const ev = new RAPIER.EventQueue(true);
const lane = track.pitLane;
if (!lane) throw new Error('no pit lane');
console.log(`▶ ${through ? 'drive-through' : 'stop'}: ${entry.name} on ${track.name}, box at lane point ${ai.pitBox} of ${lane.points.length}`);
let t = 0;
let enteredAt = -1;
let boxAt = -1;
let exitAt = -1;
let serviceUntil = -1;
let lastLog = -1;
let ok = false;
for (let i = 0; i < 120 * 400; i++) {
  const p = v.body.translation();
  // the session's pit lane monitor: how far off the circuit the car is (edge from the centreline)
  const ci = nearest(p.x, p.z);
  const cl = track.centerline;
  const j = (ci + 1) % (cl.length / 3);
  const tx = cl[j * 3] - cl[ci * 3];
  const tz = cl[j * 3 + 2] - cl[ci * 3 + 2];
  const lat = ((p.x - cl[ci * 3]) * tz - (p.z - cl[ci * 3 + 2]) * tx) / (Math.hypot(tx, tz) || 1);
  const off = Math.abs(lat) - (lat >= 0 ? track.widthL[ci] : track.widthR[ci]);
  const e = pit.update(p.x, p.z, off, v.telemetry.speed);
  if (e) console.log(`  ${t.toFixed(1)} s: pit lane ${e} at lane point ${pit.index}, ${pit.dist.toFixed(1)} m off it`);
  if (e === 'enter' && enteredAt < 0) enteredAt = t;
  if (ai.resetRequested) {
    console.log(`  ${t.toFixed(1)} s: reset (stuck) at lane point ${pit.index}`);
    ai.resetRequested = false;
  }
  if (e === 'exit' && enteredAt >= 0) {
    exitAt = t;
    ok = true;
  }
  v.speedLimitMs = ai.inPitLane ? lane.speedLimitKmh / 3.6 : null;
  if (ai.atBox && boxAt < 0) {
    boxAt = t;
    serviceUntil = t + 22;
  }
  v.frozen = serviceUntil > 0 && t < serviceUntil;
  if (serviceUntil > 0 && t >= serviceUntil) {
    ai.pitServed();
    serviceUntil = 0;
  }
  v.step(DT, ai.update(DT, true, v.weatherGrip * v.tyreGripAvg));
  world.step(ev);
  t += DT;
  if ((ai.inPitLane || pit.inLane) && Math.floor(t * 4) !== lastLog) {
    lastLog = Math.floor(t * 4);
    console.log(
      `  t ${t.toFixed(0)} s: lane point ${pit.index} (monitor in lane ${pit.inLane}, ${pit.dist.toFixed(1)} m off it), ${(v.telemetry.speed * 3.6).toFixed(0)} km/h (target ${(ai.dbgVt * 3.6).toFixed(0)}, AI lane point ${(ai as unknown as { laneIdx: number }).laneIdx}), at box ${ai.atBox}, AI in lane ${ai.inPitLane}`,
    );
  }
  if (ok && !ai.inPitLane) break;
}
console.log(
  ok
    ? `  in the lane at ${enteredAt.toFixed(1)} s, at the box ${boxAt >= 0 ? `${boxAt.toFixed(1)} s` : 'never'}, out at ${exitAt.toFixed(1)} s (lane ${(exitAt - enteredAt).toFixed(1)} s)`
    : `  FAILED: entered ${enteredAt >= 0 ? `${enteredAt.toFixed(1)} s` : 'never'}, box ${boxAt >= 0 ? `${boxAt.toFixed(1)} s` : 'never'}, still in the lane: ${ai.inPitLane}`,
);
process.exit(ok ? 0 : 1);

function nearest(x: number, z: number): number {
  const cl = track.centerline;
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < cl.length / 3; i++) {
    const d = (cl[i * 3] - x) ** 2 + (cl[i * 3 + 2] - z) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return bi;
}
