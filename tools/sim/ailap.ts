/**
 * Bot AI check: one full lap of the real track per skill level, using the real client
 * Vehicle and AiDriver code (Rapier in Node).
 *
 *   pnpm tsx tools/sim/ailap.ts [carId]
 *
 * Fails (exit 1) when a bot cannot finish the lap or needs more than two resets.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile, Surface, TrackData } from '../../packages/shared/src/index.ts';
import { Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';
import type { Controls } from '../../apps/client/src/physics/input.ts';
import { AiDriver, BOT_ASSISTS, carLimits, profileLapTime, racingLineFor, speedProfile } from '../../apps/client/src/game/ai.ts';
import { nearestCenterlineIndex } from '../../packages/shared/src/index.ts';
import { TrackLimits, beyondLimitsNow } from '../../apps/client/src/game/trackLimits.ts';
import { RaceTracker } from '../../packages/shared/src/race.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../apps/client/public/assets');
const cars = JSON.parse(readFileSync(path.join(pub, 'cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const carId = args.find((a) => !a.startsWith('--')) ?? '2024_porsche_992_gt3_r';
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
  if (useTrack) {
    const track = JSON.parse(readFileSync(path.join(pub, 'track.json'), 'utf8')) as TrackData;
    const g = track.grid[0];
    v.place(g.p[0], g.p[1], g.p[2], g.yaw);
  } else v.place(0, 0, 0, 0);
  const events = new RAPIER.EventQueue(true);
  return { world, v, events };
}

function step(s: ReturnType<typeof setup>, c: Controls) {
  s.v.step(DT, c);
  s.world.step(s.events);
}

console.log(`▶ AI lap: ${entry.name} on the real track`);
const track = JSON.parse(readFileSync(path.join(pub, 'track.json'), 'utf8')) as TrackData;
let failed = false;
{
  const line = racingLineFor(track);
  const ideal = profileLapTime(line, speedProfile(line, carLimits(entry.specs), 1, true));
  console.log(`  quasi-steady-state lap on the racing line: ${fmt(ideal)} (real GT3 pole here: ~1:54-1:55)`);
}
for (const skill of [0.88, 0.97]) {
  const s = setup();
  const ai = new AiDriver(track, s.v, skill, 0);
  const tr = new RaceTracker(track, 0, 1);
  tr.addPlayer('ai');
  let t = 0;
  let resets = 0;
  let lapMs: number | null = null;
  let maxV = 0;
  let offTime = 0;
  let brakeMax = 0;
  let brakeSum = 0;
  let brakeN = 0;
  let violations = 0;
  let hint = -1;
  const limits = new TrackLimits();
  for (let i = 0; i < 120 * 240 && lapMs === null; i++) {
    const pr0 = tr.players.get('ai');
    const cp = pr0 && pr0.passed >= 0 ? track.gates[(pr0.nextGate - 1 + track.gates.length) % track.gates.length].s : undefined;
    const c = ai.update(DT, true, 1, cp);
    if (ai.resetRequested) {
      resets++;
      ai.resetRequested = false;
      const p = s.v.body.translation();
      tr.ingest('ai', t * 1000 + 1, p.x, p.y, p.z, true);
    }
    step(s, c);
    t += DT;
    maxV = Math.max(maxV, s.v.telemetry.speed * 3.6);
    brakeMax = Math.max(brakeMax, s.v.wheels[0].brakeTemp);
    brakeSum += s.v.wheels[0].brakeTemp;
    brakeN++;
    {
      const p = s.v.body.translation();
      hint = nearestCenterlineIndex(track, p.x, p.y, p.z, hint, 30);
      const cl = track.centerline;
      const j = (hint + 1) % (cl.length / 3);
      const tx = cl[j * 3] - cl[hint * 3];
      const tz = cl[j * 3 + 2] - cl[hint * 3 + 2];
      const tl = Math.hypot(tx, tz) || 1;
      const lateral = ((p.x - cl[hint * 3]) * tz - (p.z - cl[hint * 3 + 2]) * tx) / tl;
      const was = limits.offTrack;
      if (limits.update(DT, beyondLimitsNow(s.v, track, hint, lateral))) offTime += DT;
      if (limits.offTrack && !was) {
        violations++;
        if (process.env.VERBOSE) console.log(`  track limits at ${track.cumS[hint].toFixed(0)} m (index ${hint}, lateral ${lateral.toFixed(1)})`);
      }
    }
    if (i % 12 === 0) {
      const p = s.v.body.translation();
      for (const e of tr.ingest('ai', t * 1000, p.x, p.y, p.z, false)) if (e.type === 'lap') lapMs = e.lapMs;
    }
  }
  const pr = tr.players.get('ai');
  if (lapMs === null || resets > 2) failed = true;
  const lap = lapMs ? fmt(lapMs / 1000) : `NOT FINISHED (${pr?.raceDist.toFixed(0)} m)`;
  const wear = s.v.wheels.map((w) => `${(w.wear * 100).toFixed(1)}%`).join('/');
  console.log(
    `skill ${skill}: lap ${lap}, resets ${resets}, top ${maxV.toFixed(0)} km/h, track-limit violations ${violations} (${offTime.toFixed(1)} s), tread used FL/FR/RL/RR ${wear} (${s.v.compound.name}), front brake ${Math.round(brakeSum / brakeN)} °C avg / ${Math.round(brakeMax)} °C peak`,
  );
}
process.exit(failed ? 1 : 0);

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(3).padStart(6, '0')}`;
}
