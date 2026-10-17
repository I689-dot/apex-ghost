/**
 * Headless vehicle-dynamics checks (Rapier in Node, the real client Vehicle code).
 *
 *   pnpm tsx tools/sim/simtest.ts [carId] [--track]
 *
 * Runs on a flat test pad (or the real track collision with --track) and prints:
 * rest stability, 0-100 km/h, top speed, 200→0 braking distance, steady-state cornering g,
 * and a handbrake drift + recovery.
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

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../apps/client/public/assets');
const cars = JSON.parse(readFileSync(path.join(pub, 'cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const carId = args.find((a) => !a.startsWith('--')) ?? '2024_porsche_992_gt3_r';
const useTrack = args.includes('--track');
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
  const v = new Vehicle(RAPIER, world, entry, ground, { abs: true, tc: 1, stability: false, steering: false }, damage);
  excl.body = v.body;
  if (useTrack) {
    const track = JSON.parse(readFileSync(path.join(pub, 'track.json'), 'utf8')) as TrackData;
    const g = track.grid[0];
    v.place(g.p[0], g.p[1], g.p[2], g.yaw);
  } else v.place(0, 0, 0, 0);
  const events = new RAPIER.EventQueue(true);
  return { world, v, events };
}

const ctl = (o: Partial<Controls> = {}): Controls => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, ...o });

function step(s: ReturnType<typeof setup>, c: Controls) {
  s.v.step(DT, c);
  s.world.step(s.events);
}

const kmh = (ms: number) => ms * 3.6;
const results: string[] = [];
const log = (k: string, v: string) => {
  results.push(`${k.padEnd(30)} ${v}`);
};

console.log(
  `▶ ${entry.name} (${entry.specs.massKg} kg, ${Math.round(entry.specs.powerKw * 1.341)} hp, ${entry.specs.drivetrain}) on ${useTrack ? 'the track' : 'a flat pad'}`,
);

// 1) rest: settle, check it does not drift/jitter
{
  const s = setup();
  for (let i = 0; i < 240; i++) step(s, ctl());
  const p0 = s.v.body.translation();
  let maxV = 0;
  for (let i = 0; i < 360; i++) {
    step(s, ctl());
    const lv = s.v.body.linvel();
    maxV = Math.max(maxV, Math.hypot(lv.x, lv.y, lv.z));
  }
  const p1 = s.v.body.translation();
  const comp = s.v.wheels.map((w) => w.compression.toFixed(3)).join('/');
  log(
    'rest drift (3 s)',
    `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(4)} m, max speed ${maxV.toFixed(3)} m/s, compression ${comp}, ride y ${p1.y.toFixed(3)}`,
  );
}

// 2) launch: 0-100, 0-200, top speed
{
  const s = setup();
  for (let i = 0; i < 120; i++) step(s, ctl());
  let t = 0;
  let t100 = NaN;
  let t200 = NaN;
  let vmax = 0;
  let lastGear = 1;
  const shifts: string[] = [];
  for (let i = 0; i < 120 * 45; i++) {
    step(s, ctl({ throttle: 1 }));
    t += DT;
    const sp = kmh(s.v.telemetry.speed);
    if (isNaN(t100) && sp >= 100) t100 = t;
    if (isNaN(t200) && sp >= 200) t200 = t;
    vmax = Math.max(vmax, sp);
    if (s.v.telemetry.gear !== lastGear) {
      shifts.push(`${s.v.telemetry.gear}@${sp.toFixed(0)}`);
      lastGear = s.v.telemetry.gear;
    }
  }
  const p = s.v.body.translation();
  log('0-100 km/h', `${t100.toFixed(2)} s`);
  log('0-200 km/h', `${t200.toFixed(2)} s`);
  log('top speed (45 s)', `${vmax.toFixed(0)} km/h (spec ${entry.specs.topSpeedKmh})`);
  log('shifts', shifts.join(' '));
  log('lateral drift on straight', `${Math.abs(p.x).toFixed(2)} m after ${p.z.toFixed(0)} m`);
}

// 3) braking 200 → 0
{
  const s = setup();
  for (let i = 0; i < 120; i++) step(s, ctl());
  while (kmh(s.v.telemetry.speed) < 200) step(s, ctl({ throttle: 1 }));
  const z0 = s.v.body.translation().z;
  let t = 0;
  while (s.v.telemetry.speed > 0.5 && t < 20) {
    step(s, ctl({ brake: 1 }));
    t += DT;
  }
  const z1 = s.v.body.translation().z;
  log('braking 200→0', `${(z1 - z0).toFixed(1)} m in ${t.toFixed(2)} s (ABS on)`);
}

// 4) steady-state cornering at ~120 km/h and ~200 km/h with a fixed steer input
for (const target of [120, 200]) {
  const s = setup();
  for (let i = 0; i < 120; i++) step(s, ctl());
  while (kmh(s.v.telemetry.speed) < target) step(s, ctl({ throttle: 1 }));
  let maxLat = 0;
  let sumLat = 0;
  let n = 0;
  let spun = false;
  for (let i = 0; i < 120 * 6; i++) {
    // simple speed hold + steering ramp to find the grip limit
    const sp = kmh(s.v.telemetry.speed);
    const thr = sp < target ? 0.6 : 0.15;
    const steer = Math.min(1, i / 240) * (target > 150 ? 0.5 : 0.7);
    step(s, ctl({ throttle: thr, steer }));
    const av = s.v.body.angvel().y;
    const lat = Math.abs(av * s.v.telemetry.speed) / 9.81;
    if (i > 360) {
      maxLat = Math.max(maxLat, lat);
      sumLat += lat;
      n++;
    }
    if (Math.abs(s.v.telemetry.slipBody) > 0.6) spun = true;
  }
  log(
    `cornering @${target}`,
    `avg ${(sumLat / n).toFixed(2)} g, max ${maxLat.toFixed(2)} g, body slip ${(s.v.telemetry.slipBody * 57.3).toFixed(1)}°${spun ? ' SPUN' : ''}`,
  );
}

// 5) power-oversteer drift with TC off: initiate, hold ~25° slip with countersteer + throttle, recover
{
  const s = setup();
  s.v.assists = { abs: true, tc: 0, stability: false, steering: false };
  for (let i = 0; i < 120; i++) step(s, ctl());
  while (kmh(s.v.telemetry.speed) < 75) step(s, ctl({ throttle: 1 }));
  // left-hand drift: the rear steps out to the right, so the body slip angle is negative
  for (let i = 0; i < 20; i++) step(s, ctl({ throttle: 0.5, steer: 1 }));
  for (let i = 0; i < 36; i++) step(s, ctl({ throttle: 1, steer: 1, handbrake: 1 }));
  const target = -0.42; // ≈ −24°
  let held = 0;
  let sum = 0;
  let n = 0;
  let spun = false;
  for (let i = 0; i < 120 * 4; i++) {
    const beta = s.v.telemetry.slipBody;
    const err = beta - target; // > 0: not enough angle, < 0: over-rotating
    const steer = Math.max(-1, Math.min(1, 0.25 + 1.8 * err));
    const throttle = Math.max(0, Math.min(1, 0.6 + 2.5 * err));
    step(s, ctl({ throttle, steer }));
    const a = Math.abs(beta);
    if (a > 0.2 && a < 0.8) held += DT;
    sum += a;
    n++;
    if (a > 1.3) spun = true;
  }
  let recovered = NaN;
  for (let i = 0; i < 480; i++) {
    const slip = s.v.telemetry.slipBody;
    step(s, ctl({ throttle: 0.25, steer: Math.max(-1, Math.min(1, -slip * 2.5)) }));
    if (isNaN(recovered) && Math.abs(s.v.telemetry.slipBody) < 0.06) recovered = i * DT;
  }
  log(
    'controlled drift (TC off)',
    `held ${held.toFixed(1)}/4.0 s at avg ${((sum / n) * 57.3).toFixed(0)}° slip${spun ? ', SPUN' : ''}, recovered in ${isNaN(recovered) ? 'NO' : recovered.toFixed(2) + ' s'}, exit ${kmh(s.v.telemetry.speed).toFixed(0)} km/h`,
  );
}

for (const r of results) console.log('  ' + r);
