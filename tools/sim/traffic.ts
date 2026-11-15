/**
 * Bot racecraft check, headless (Rapier in Node, the real Vehicle, AiDriver and trafficView code): several bots start
 * behind a slower "player" car that holds the racing line and never yields (the worst case for passing), with car
 * contact on (the bodies collide). Counts contacts (two bodies overlapping: closer than 1.98 m side by side and
 * along), passes, and the closest side-by-side distance; and the same race with the traffic logic off, to compare.
 *
 *   pnpm tsx tools/sim/traffic.ts [--track zandvoort] [--bots 5] [--seconds 150] [--player-skill 0.86] [--off]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile, Surface, TrackData } from '../../packages/shared/src/index.ts';
import { nearestCenterlineIndex, progressAt } from '../../packages/shared/src/index.ts';
import { Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';
import { AiDriver, BOT_ASSISTS, trafficView, type TrafficCar } from '../../apps/client/src/game/ai.ts';
import { cutWallsAcrossLine } from '../../apps/client/src/game/wallCut.ts';
import { collisionParts, loadTrack, trackArg } from './trackfile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../apps/client/public/assets');
const cars = JSON.parse(readFileSync(path.join(pub, 'cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const BOTS = Number(opt('bots', '5'));
const SECONDS = Number(opt('seconds', '150'));
const PLAYER_SKILL = Number(opt('player-skill', '0.86'));
const OFF = args.includes('--off');
const loaded = loadTrack(trackArg(args) ?? 'zandvoort');
const track = loaded.track as TrackData;
const DT = 1 / 120;
await RAPIER.init();

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
const surf = new Map<number, Surface>();
for (const part of collisionParts(loaded.collision)) {
  const surface = track.collision.surfaces[part.surface];
  const idx = surface === 'wall' ? cutWallsAcrossLine(part.pos, part.idx, track) : part.idx;
  surf.set(world.createCollider(RAPIER.ColliderDesc.trimesh(part.pos, idx)).handle, surface);
}
world.updateSceneQueries();
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
// the wheels see the circuit only (not the other cars)
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

const field = cars.cars.filter((c) => c.role !== 'safety');
interface Car {
  name: string;
  v: Vehicle;
  ai: AiDriver;
  player: boolean;
  hint: number;
  s: number;
  laps: number;
  lastS: number;
}
const all: Car[] = [];
for (let slot = 0; slot <= BOTS; slot++) {
  const entry = field[(slot * 7) % field.length];
  const v = new Vehicle(RAPIER, world, entry, ground, { ...BOT_ASSISTS }, new DamageState());
  v.setContact(true);
  const g = track.grid[slot];
  v.place(g.p[0], g.p[1], g.p[2], g.yaw);
  v.setTyreTemps(80);
  const player = slot === 0;
  // the player: slower and on the racing line (no lane), never yielding; bots at a Pro level, spread as in the game
  const skill = player ? PLAYER_SKILL : 0.97 * (0.965 + ((slot * 37) % 10) / 280);
  const lane = player ? 0 : (((slot * 7) % 5) - 2) * 0.45;
  all.push({ name: player ? 'PLAYER' : `bot${slot}`, v, ai: new AiDriver(track, v, skill, lane), player, hint: -1, s: 0, laps: 0, lastS: 0 });
}
world.updateSceneQueries();

const fwd = (v: Vehicle): [number, number] => {
  const q = v.body.rotation();
  return [2 * (q.x * q.z + q.y * q.w), 1 - 2 * (q.x * q.x + q.y * q.y)];
};
const asTraffic = (c: Car): TrafficCar => {
  const p = c.v.body.translation();
  const [fx, fz] = fwd(c.v);
  return { x: p.x, y: p.y, z: p.z, speed: c.v.telemetry.speed, fx, fz };
};

let contacts = 0;
const lastContact = new Map<string, number>();
let minSide = Infinity;
let sideSamples = 0;
const order0 = all.map((c) => c.name);
const events = new RAPIER.EventQueue(true);
const L = track.length;
for (let i = 0; i < SECONDS / DT; i++) {
  const t = i * DT;
  const views = all.map((c) => (c.player || OFF ? null : trafficView(asTraffic(c), c.ai.passTarget !== 0, all.filter((o) => o !== c).map(asTraffic))));
  all.forEach((c, k) => {
    const view = views[k];
    if (view) c.ai.applyTraffic(view, false, DT);
    const ctl = c.ai.update(DT, true, 1, undefined, view ? view.cap : Infinity);
    c.v.step(DT, ctl);
  });
  world.step(events);
  // progress, laps
  for (const c of all) {
    const p = c.v.body.translation();
    c.hint = nearestCenterlineIndex(track, p.x, p.y, p.z, c.hint, 40);
    const s = progressAt(track, c.hint, p.x, p.z);
    if (c.lastS > L - 200 && s < 200) c.laps++;
    c.lastS = s;
    c.s = c.laps * L + s;
  }
  // contacts: two bodies touching (overlapping along, closer than a car's width across)
  for (let a = 0; a < all.length; a++)
    for (let b = a + 1; b < all.length; b++) {
      const A = all[a];
      const B = all[b];
      const pa = A.v.body.translation();
      const pb = B.v.body.translation();
      const [fx, fz] = fwd(A.v);
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const along = dx * fx + dz * fz;
      const lat = dx * fz - dz * fx;
      if (Math.abs(pb.y - pa.y) > 2) continue;
      if (Math.abs(along) < 4.6 && Math.abs(lat) < 4) {
        minSide = Math.min(minSide, Math.abs(lat));
        sideSamples++;
      }
      if (Math.abs(along) < 4.7 && Math.abs(lat) < 1.98) {
        const k = `${A.name}-${B.name}`;
        if (t - (lastContact.get(k) ?? -9) > 1.5) {
          contacts++;
          console.log(
            `  contact ${k} at ${t.toFixed(1)} s, ${Math.round(A.s % L)} m, ${Math.round(A.v.telemetry.speed * 3.6)} / ${Math.round(B.v.telemetry.speed * 3.6)} km/h, along ${along.toFixed(1)} m, across ${lat.toFixed(2)} m, pass ${A.ai.passTarget}/${B.ai.passTarget}`,
          );
        }
        lastContact.set(k, t);
      }
    }
}
const order = [...all].sort((a, b) => b.s - a.s);
const passedPlayer = order.findIndex((c) => c.player);
console.log(`▶ ${track.name}, ${BOTS} bots behind a player at ${PLAYER_SKILL} who never yields, ${SECONDS} s, contact on, traffic logic ${OFF ? 'OFF' : 'on'}`);
console.log(`  start order: ${order0.join(' ')}`);
console.log(`  end order:   ${order.map((c) => `${c.name}(${(c.s / 1000).toFixed(2)} km)`).join(' ')}`);
console.log(`  bots that passed the player: ${passedPlayer}; contacts: ${contacts}; closest side by side: ${minSide.toFixed(2)} m over ${sideSamples} samples`);
