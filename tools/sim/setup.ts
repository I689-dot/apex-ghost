/**
 * Car setup and fuel check, with the real client Vehicle code (Rapier in Node):
 *  - skidpad: the highest steady speed on a 60 m circle (mechanical grip, ~110 km/h) and a 120 m one (more aero,
 *    ~160 km/h; a bigger circle is power-limited, not grip-limited), the lateral acceleration there and the balance (front minus rear slip angle: + understeer);
 *  - laps (--laps N, default 2) of the real track by the AI: lap times, tyre temperatures and hot pressures, fuel.
 * One line per setup variant, the baseline first.
 *
 *   pnpm tsx tools/sim/setup.ts [carId] [--track id] [--laps 2] [--only skidpad|laps]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarEntry, CarsFile, Surface, TrackData } from '../../packages/shared/src/index.ts';
import { FUEL, NEUTRAL_SETUP, Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';
import { AiDriver, BOT_ASSISTS } from '../../apps/client/src/game/ai.ts';
import { applySetup, vehicleSetup } from '../../apps/client/src/game/carSetup.ts';
import { RaceTracker } from '../../packages/shared/src/race.ts';
import { COMPOUNDS } from '../../apps/client/src/physics/tyres.ts';
import { DEFAULT_SETTINGS, type CarSetup } from '../../apps/client/src/settings.ts';
import { loadTrack, trackArg } from './trackfile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cars = JSON.parse(readFileSync(path.resolve(here, '../../apps/client/public/assets/cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const optVals = new Set(['--track', '--laps', '--only'].flatMap((k) => (args.includes(k) ? [args[args.indexOf(k) + 1]] : [])));
const carId = args.find((a) => !a.startsWith('--') && !optVals.has(a)) ?? '2024_porsche_992_gt3_r';
const base = cars.cars.find((c) => c.id === carId) ?? cars.cars[0];
const LAPS = Number(opt('laps', '2'));
const only = opt('only', '');
const DT = 1 / 120;
const AIR = 20;
const TRACK_C = 32;

await RAPIER.init();

const BASE: CarSetup = { ...DEFAULT_SETTINGS.carSetup };
const VARIANTS: [string, Partial<CarSetup>][] = [
  ['baseline', {}],
  ['pressures -3 psi', { pressure: [19.5, 19.5] }],
  ['pressures +3 psi', { pressure: [25.5, 25.5] }],
  ['ride -10 mm', { ride: [-10, -10] }],
  ['ride +10 mm', { ride: [10, 10] }],
  ['rake +10 mm (rear up)', { ride: [-5, 5] }],
  ['ARB front 7 / rear 1', { arb: [7, 1] }],
  ['ARB front 1 / rear 7', { arb: [1, 7] }],
  ['dampers soft (2)', { bump: [2, 2], rebound: [2, 2] }],
  ['dampers stiff (6)', { bump: [6, 6], rebound: [6, 6] }],
];

function groundFor(world: RAPIER.World, surf: Map<number, Surface>): { ground: GroundQuery; excl: { body?: RAPIER.RigidBody } } {
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const excl: { body?: RAPIER.RigidBody } = {};
  return {
    excl,
    ground: {
      cast(ox, oy, oz, dx, dy, dz, maxDist, out: GroundHit) {
        ray.origin = { x: ox, y: oy, z: oz };
        ray.dir = { x: dx, y: dy, z: dz };
        const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, (0xffff << 16) | 1, undefined, excl.body);
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
    },
  };
}

function makeCar(world: RAPIER.World, ground: GroundQuery, excl: { body?: RAPIER.RigidBody }, cs: CarSetup, fuel: boolean): Vehicle {
  const entry: CarEntry = applySetup(base, cs);
  const v = new Vehicle(RAPIER, world, entry, ground, { ...BOT_ASSISTS }, new DamageState());
  excl.body = v.body;
  v.applySetup(vehicleSetup(cs));
  v.setAir(AIR, TRACK_C, 1.2);
  if (fuel) v.setFuel(FUEL.refL);
  return v;
}

/** Highest steady speed on a circle of radius r: pure pursuit on the circle, the speed raised slowly until it slips off. */
function skidpad(cs: CarSetup, r: number): { g: number; kmh: number; balanceDeg: number; tyre: string; psi: string } {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const surf = new Map<number, Surface>();
  surf.set(world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0)).handle, 'asphalt');
  world.updateSceneQueries();
  const { ground, excl } = groundFor(world, surf);
  const v = makeCar(world, ground, excl, cs, false);
  // counter-clockwise circle around (r, 0): start at the origin heading +Z (turning left)
  v.place(0, 0, 0, 0);
  // pressures set in the garage, tyres already at working temperature (as after a few laps)
  v.fitTyres(COMPOUNDS.medium, AIR + 12);
  for (const w of v.wheels) w.temp = 85;
  const ev = new RAPIER.EventQueue(true);
  // from a little under what a GT3 manages there (aero: much more on the big circle)
  let target = Math.sqrt(1.3 * 9.81 * r);
  let best = { g: 0, kmh: 0, balanceDeg: 0, tyre: '', psi: '' };
  let held = 0;
  const c = { throttle: 0, brake: 0, steer: 0, handbrake: 0, digital: false };
  for (let i = 0; i < 120 * 600; i++) {
    const p = v.body.translation();
    const q = v.body.rotation();
    const fx = 2 * (q.x * q.z + q.y * q.w);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const lx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const lz = 2 * (q.x * q.z - q.y * q.w);
    const ang = Math.atan2(p.z, p.x - r);
    const err = Math.hypot(p.x - r, p.z) - r;
    const speed = v.telemetry.speed;
    const look = (6 + 0.3 * speed) / r;
    const tx = r + r * Math.cos(ang - look);
    const tz = r * Math.sin(ang - look);
    const dx = tx - p.x;
    const dz = tz - p.z;
    const alpha = Math.atan2(dx * lx + dz * lz, Math.max(0.5, dx * fx + dz * fz));
    c.steer = Math.max(-1, Math.min(1, Math.atan((2 * v.wheelbase * Math.sin(alpha)) / Math.hypot(dx, dz)) / v.maxSteer));
    const e = target - speed;
    c.throttle = e > 0 ? Math.min(1, 0.3 + e * 0.4) : Math.max(0, 0.3 + e * 0.6);
    c.brake = e < -1 ? Math.min(1, -e * 0.2) : 0;
    v.step(DT, c);
    world.step(ev);
    if (Math.abs(err) > 4 || Math.abs(v.telemetry.slipBody) > 0.3) {
      if (process.env.VERBOSE)
        console.log(
          `    R${r} off at ${(speed * 3.6).toFixed(0)} km/h: err ${err.toFixed(1)} m, slip ${v.telemetry.slipBody.toFixed(2)}, steer ${c.steer.toFixed(2)}`,
        );
      break;
    }
    // on the line at the target speed: note it, then ask for a little more
    if (Math.abs(err) < 1.5 && Math.abs(e) < 0.4) held += DT;
    else held = 0;
    if (held > 1.5) {
      const w = v.wheels;
      const aF = (Math.abs(w[0].slipAngle) + Math.abs(w[1].slipAngle)) / 2;
      const aR = (Math.abs(w[2].slipAngle) + Math.abs(w[3].slipAngle)) / 2;
      best = {
        g: (speed * speed) / r / 9.81,
        kmh: speed * 3.6,
        balanceDeg: ((aF - aR) * 180) / Math.PI,
        tyre: w.map((x) => x.temp.toFixed(0)).join('/'),
        psi: w.map((x) => x.pressure.toFixed(1)).join('/'),
      };
      target += 0.25;
      held = 0;
    }
  }
  return best;
}

const loaded = loadTrack(trackArg(args));
const track = loaded.track as TrackData;

/** AI laps of the real track with this setup (fuel on: what a lap burns). */
function laps(cs: CarSetup): string {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const surf = new Map<number, Surface>();
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
    surf.set(world.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx)).handle, track.collision.surfaces[si]);
  }
  world.updateSceneQueries();
  const { ground, excl } = groundFor(world, surf);
  const v = makeCar(world, ground, excl, cs, true);
  const g = track.grid[0];
  v.place(g.p[0], g.p[1], g.p[2], g.yaw);
  v.fitTyres(COMPOUNDS.medium, AIR + 12);
  const ai = new AiDriver(track, v, 0.97, 0);
  const tr = new RaceTracker(track, 0, LAPS);
  tr.addPlayer('ai');
  const ev = new RAPIER.EventQueue(true);
  const out: string[] = [];
  let fuelAtLap = v.fuelL ?? 0;
  let t = 0;
  let resets = 0;
  for (let i = 0; i < Math.max(120, track.length / 40) * 240 * (LAPS + 1) && out.length < LAPS + 1; i++) {
    const pr = tr.players.get('ai');
    const cp = pr && pr.passed >= 0 ? track.gates[(pr.nextGate - 1 + track.gates.length) % track.gates.length].s : undefined;
    v.step(DT, ai.update(DT, true, v.weatherGrip * v.tyreGripAvg, cp));
    if (ai.resetRequested) {
      resets++;
      ai.resetRequested = false;
      const p = v.body.translation();
      tr.ingest('ai', t * 1000 + 1, p.x, p.y, p.z, true);
    }
    world.step(ev);
    ev.drainContactForceEvents(() => {});
    t += DT;
    if (i % 12 === 0) {
      const p = v.body.translation();
      for (const e of tr.ingest('ai', t * 1000, p.x, p.y, p.z, false)) {
        if (e.type !== 'lap') continue;
        const w = v.wheels;
        const used = fuelAtLap - (v.fuelL ?? 0);
        fuelAtLap = v.fuelL ?? 0;
        out.push(
          `${e.outLap ? 'out ' : ''}${fmt(e.lapMs / 1000)} ${used.toFixed(2)} l, tyres ${((w[0].temp + w[1].temp) / 2).toFixed(0)}/${((w[2].temp + w[3].temp) / 2).toFixed(0)} °C ` +
            `${((w[0].pressure + w[1].pressure) / 2).toFixed(1)}/${((w[2].pressure + w[3].pressure) / 2).toFixed(1)} psi`,
        );
      }
    }
  }
  return `${out.join(' | ')}${resets ? ` (resets ${resets})` : ''}`;
}

console.log(`▶ setup check: ${base.name}${only !== 'skidpad' ? ` · laps on ${track.name}` : ''} (neutral setup ${JSON.stringify(NEUTRAL_SETUP.ride)})`);
for (const [name, patch] of VARIANTS) {
  const cs: CarSetup = { ...BASE, ...patch };
  const parts: string[] = [];
  if (only !== 'laps') {
    for (const r of [60, 120]) {
      const s = skidpad(cs, r);
      parts.push(`R${r}: ${s.g.toFixed(2)} g ${s.kmh.toFixed(0)} km/h bal ${s.balanceDeg >= 0 ? '+' : ''}${s.balanceDeg.toFixed(2)}° (${s.psi} psi)`);
    }
  }
  if (only !== 'skidpad') parts.push(laps(cs));
  console.log(`${name.padEnd(24)} ${parts.join('  ·  ')}`);
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(3).padStart(6, '0')}`;
}
