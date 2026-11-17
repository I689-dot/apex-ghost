/**
 * A sample lap trace for the website's telemetry page (apps/web/telemetry.js), driven by the AI on the real track
 * with the game's own recorder (game/lapTrace.ts): one flying lap, written as the server's /api/telemetry reply.
 *
 *   pnpm tsx tools/sim/sampletrace.ts --track spa --skill 0.97 --nick Bot > out.json
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile, Surface, TrackData } from '../../packages/shared/src/index.ts';
import { nearestCenterlineIndex, progressAt } from '../../packages/shared/src/index.ts';
import { Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';
import { AiDriver, BOT_ASSISTS } from '../../apps/client/src/game/ai.ts';
import { LapTrace } from '../../apps/client/src/game/lapTrace.ts';
import { cutWallsAcrossLine } from '../../apps/client/src/game/wallCut.ts';
import { collisionParts, loadTrack, trackArg } from './trackfile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cars = JSON.parse(readFileSync(path.resolve(here, '../../apps/client/public/assets/cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const loaded = loadTrack(trackArg(args) ?? 'spa');
const track = loaded.track as TrackData;
const entry = cars.cars.find((c) => c.id === opt('car', 'ferrari_296_gt3_verstappen')) ?? cars.cars[0];
const DT = 1 / 120;
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
const surf = new Map<number, Surface>();
for (const part of collisionParts(loaded.collision)) {
  const s = track.collision.surfaces[part.surface];
  surf.set(world.createCollider(RAPIER.ColliderDesc.trimesh(part.pos, s === 'wall' ? cutWallsAcrossLine(part.pos, part.idx, track) : part.idx)).handle, s);
}
world.updateSceneQueries();
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const ground: GroundQuery = {
  cast(ox, oy, oz, dx, dy, dz, maxDist, out: GroundHit) {
    ray.origin = { x: ox, y: oy, z: oz };
    ray.dir = { x: dx, y: dy, z: dz };
    const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, undefined, (c) => surf.has(c.handle));
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
const g = track.grid[0];
v.place(g.p[0], g.p[1], g.p[2], g.yaw);
v.setTyreTemps(85);
const ai = new AiDriver(track, v, Number(opt('skill', '0.97')), 0);
const trace = new LapTrace(track.length);
const L = track.length;
let hint = -1;
let prev = -1;
let laps = 0;
let lapStart = 0;
let out: { lapMs: number; data: string } | null = null;
for (let i = 0; i < 120 * 60 * 12 && !out; i++) {
  const c = ai.update(DT, true, 1);
  v.step(DT, c);
  world.step();
  const p = v.body.translation();
  hint = nearestCenterlineIndex(track, p.x, p.y, p.z, hint, 40);
  const s = progressAt(track, hint, p.x, p.z);
  const t = i * DT * 1000;
  if (prev > L - 200 && s < 200) {
    laps++;
    if (laps === 2) {
      const data = trace.encode();
      if (data) out = { lapMs: t - lapStart, data };
    }
    lapStart = t;
    trace.start();
  }
  prev = s;
  if (laps >= 1) trace.record(s, t - lapStart, p.x, p.z, v.telemetry.speed, v.pedals.throttle, v.pedals.brake, v.steerAngle / v.maxSteer, v.telemetry.gear);
}
if (!out) throw new Error('no flying lap');
const third = Math.round(out.lapMs / 3);
console.log(
  JSON.stringify({
    userId: opt('user', 'u1'),
    nick: opt('nick', 'Bot'),
    carId: entry.id,
    lapMs: Math.round(out.lapMs),
    sectors: [third, third, Math.round(out.lapMs) - 2 * third],
    bin: trace.bin,
    data: out.data,
    at: Date.now(),
  }),
);
