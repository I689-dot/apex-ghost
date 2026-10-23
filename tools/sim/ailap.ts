/**
 * Bot AI check (`--track <layout id>` for another circuit): one full lap of the real track per skill level, using the real client
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
import { TYRE_TEMP, Vehicle, type GroundHit, type GroundQuery } from '../../apps/client/src/physics/vehicle.ts';
import { DamageState } from '../../apps/client/src/physics/damage.ts';
import type { Controls } from '../../apps/client/src/physics/input.ts';
import { AiDriver, BOT_ASSISTS, carLimits, profileLapTime, racingLineFor, speedProfile } from '../../apps/client/src/game/ai.ts';
import { nearestCenterlineIndex } from '../../packages/shared/src/index.ts';
import { TrackLimits, beyondLimitsNow } from '../../apps/client/src/game/trackLimits.ts';
import { RaceTracker } from '../../packages/shared/src/race.ts';
import { loadTrack, trackArg } from './trackfile.mjs';
import { COMPOUNDS, compoundForWeather, compoundGrip } from '../../apps/client/src/physics/tyres.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../apps/client/public/assets');
const cars = JSON.parse(readFileSync(path.join(pub, 'cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const optVals = new Set(
  ['--collision', '--slot', '--skills', '--laps', '--wet', '--track', '--air', '--track-temp', '--rho'].flatMap((k) =>
    args.includes(k) ? [args[args.indexOf(k) + 1]] : [],
  ),
);
const carId = args.find((a) => !a.startsWith('--') && !optVals.has(a)) ?? '2024_porsche_992_gt3_r';
const loaded = loadTrack(trackArg(args));
const collisionArg = opt('collision', '');
/** Real GT3 pole laps, for comparison. */
const REAL_POLE: Record<string, string> = { nurburgring_gp_2022: '~1:54-1:55', zandvoort: '~1:33-1:35' };
const startSlot = Number(opt('slot', '0'));
const skills = opt('skills', '0.88,0.97').split(',').map(Number);
const LAPS = Number(opt('laps', '1'));
/** Track wetness 0…1 (rain falling as hard): wets on a wet track, as the game gives bots. */
const WET = Number(opt('wet', '0'));
const AIR_C = Number(opt('air', '20'));
const TRACK_C = Number(opt('track-temp', '32'));
const RHO_AIR = Number(opt('rho', '1.225'));
// TYRE_TEMP_JSON='{"flex":0.002}': try tyre-model constants without editing vehicle.ts
if (process.env.TYRE_TEMP_JSON) Object.assign(TYRE_TEMP, JSON.parse(process.env.TYRE_TEMP_JSON));
const useTrack = true;
const found = cars.cars.find((c) => c.id === carId) ?? cars.cars[0];
// CAR_SPECS_JSON='{"tyreGrip":1.7}': try spec values without regenerating cars.json
const entry = process.env.CAR_SPECS_JSON ? { ...found, specs: { ...found.specs, ...JSON.parse(process.env.CAR_SPECS_JSON) } } : found;
const DT = 1 / 120;

await RAPIER.init();

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const surf = new Map<number, Surface>();
  if (useTrack) {
    const track = loaded.track as TrackData;
    const buf = collisionArg ? gunzipSync(readFileSync(collisionArg)) : loaded.collision;
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
  if (useTrack) {
    const track = loaded.track as TrackData;
    const g = track.grid[startSlot] ?? track.grid[0];
    v.place(g.p[0], g.p[1], g.p[2], g.yaw);
  } else v.place(0, 0, 0, 0);
  const events = new RAPIER.EventQueue(true);
  return { world, v, events };
}

function step(s: ReturnType<typeof setup>, c: Controls) {
  s.v.step(DT, c);
  s.world.step(s.events);
}

console.log(`▶ AI lap: ${entry.name} on ${(loaded.track as TrackData).name}`);
const track = loaded.track as TrackData;
let failed = false;
{
  const line = racingLineFor(track);
  const ideal = profileLapTime(line, speedProfile(line, carLimits(entry.specs, 1, RHO_AIR), 1, true));
  console.log(`  quasi-steady-state lap on the racing line: ${fmt(ideal)} (real GT3 pole here: ${REAL_POLE[track.id] ?? 'n/a'})`);
}
for (const skill of skills) {
  const s = setup();
  // the air of the session: --air °C, --track-temp °C (sunny asphalt ~15–20 °C above the air), --rho kg/m³
  s.v.setAir(AIR_C, TRACK_C, RHO_AIR);
  // the lane the game gives a bot in this grid slot
  const ai = new AiDriver(track, s.v, skill, startSlot ? (((startSlot * 7) % 5) - 2) * 0.45 : 0);
  // ride: body heave acceleration, wheels losing the ground at speed, and the first 6 s from the grid
  let heaveSq = 0;
  let heaveN = 0;
  let heaveMax = 0;
  let heaveMaxAt = 0;
  let flicker = 0;
  let startVy = 0;
  let startHeave = 0;
  let prevVy = 0;
  const prevContact = [true, true, true, true];
  const bumpy: Record<number, number> = {};
  s.v.fitTyres(COMPOUNDS[compoundForWeather(WET)], AIR_C + 12);
  s.v.wetness = WET;
  s.v.weatherGrip = compoundGrip(s.v.compound, WET, WET);
  const tr = new RaceTracker(track, 0, LAPS);
  tr.addPlayer('ai');
  const laps: number[] = [];
  let spins = 0;
  let spinning = false;
  let wallHits = 0;
  const splits: string[] = [];
  let nextSplit = 500;
  let t = 0;
  let resets = 0;
  let maxV = 0;
  let offTime = 0;
  let brakeMax = 0;
  let brakeSum = 0;
  let brakeN = 0;
  let violations = 0;
  let hint = -1;
  // tyres: front/rear axle average at each lap end, average and peak over the flying laps, time to 80 °C
  const tyreAtLap: string[] = [];
  let tyreFSum = 0;
  let tyreRSum = 0;
  let tyreN = 0;
  let tyrePeak = 0;
  let warmAt = -1;
  // HEATLOG=1: where each axle's tyre heat comes from on the flying laps (J): drive/brake slip, cornering slip, rolling
  const heat = { long: [0, 0], lat: [0, 0], roll: [0, 0] };
  const limits = new TrackLimits();
  // two minutes per GP-length lap; long layouts (the Nordschleife) get proportionally more
  for (let i = 0; i < Math.max(120, track.length / 40) * 240 * LAPS && laps.length < LAPS; i++) {
    const pr0 = tr.players.get('ai');
    const cp = pr0 && pr0.passed >= 0 ? track.gates[(pr0.nextGate - 1 + track.gates.length) % track.gates.length].s : undefined;
    const c = ai.update(DT, true, s.v.weatherGrip * s.v.tyreGripAvg, cp);
    if (ai.resetRequested) {
      resets++;
      ai.resetRequested = false;
      const p = s.v.body.translation();
      tr.ingest('ai', t * 1000 + 1, p.x, p.y, p.z, true);
    }
    step(s, c);
    s.events.drainContactForceEvents(() => wallHits++);
    const logWin = process.env.SLIPLOG?.split(',').map(Number);
    const sHere = track.cumS[Math.max(0, hint)];
    if (logWin && (logWin.length < 2 ? i % 60 === 0 : sHere >= logWin[0] && sHere <= logWin[1] && i % 6 === 0)) {
      const w = s.v.wheels;
      console.log(
        `    t ${t.toFixed(1)} s ${track.cumS[Math.max(0, hint)].toFixed(0)} v ${(s.v.telemetry.speed * 3.6).toFixed(0)} thr ${c.throttle.toFixed(2)} brk ${c.brake.toFixed(2)} st ${c.steer.toFixed(2)} ` +
          `alpha F ${((w[0].slipAngle * 180) / Math.PI).toFixed(1)} R ${((w[2].slipAngle * 180) / Math.PI).toFixed(1)} kappa R ${w[2].slipRatio.toFixed(3)} slip ${((s.v.telemetry.slipBody * 180) / Math.PI).toFixed(1)} surf ${w.map((x) => (x.contact ? x.surface[0] : '-')).join('')} tc ${s.v.telemetry.tcActive} vt ${(ai.dbgVt * 3.6).toFixed(0)}`,
      );
    }
    t += DT;
    {
      const sl = Math.abs(s.v.telemetry.slipBody);
      if (!spinning && sl > 0.35 && s.v.telemetry.speed > 6) {
        spins++;
        spinning = true;
        if (process.env.VERBOSE)
          console.log(
            `    spin at ${track.cumS[Math.max(0, hint)].toFixed(0)} m: ${(s.v.telemetry.speed * 3.6).toFixed(0)} km/h, target ${(ai.dbgVt * 3.6).toFixed(0)}, ` +
              `throttle ${c.throttle.toFixed(2)} brake ${c.brake.toFixed(2)} steer ${c.steer.toFixed(2)}, tyres ${s.v.wheels.map((w) => w.temp.toFixed(0)).join('/')} °C, ` +
              `wear ${s.v.wheels.map((w) => (w.wear * 100).toFixed(0)).join('/')}%, grip ${s.v.weatherGrip.toFixed(2)}`,
          );
      } else if (spinning && sl < 0.1) spinning = false;
      const vy = s.v.body.linvel().y;
      const heave = i > 0 ? Math.abs(vy - prevVy) / DT : 0;
      prevVy = vy;
      const sp = s.v.telemetry.speed;
      if (t < 6) {
        startVy = Math.max(startVy, Math.abs(vy));
        if (t > 0.3) startHeave = Math.max(startHeave, heave);
      }
      if (sp > 5 && !ai.resetRequested) {
        heaveSq += heave * heave;
        heaveN++;
        const sNow = track.cumS[Math.max(0, hint)];
        if (heave > heaveMax) {
          heaveMax = heave;
          heaveMaxAt = sNow;
        }
        if (heave > 15 && process.env.VERBOSE) {
          const pp = s.v.body.translation();
          const cl = track.centerline;
          const j = (hint + 1) % (cl.length / 3);
          const tx = cl[j * 3] - cl[hint * 3];
          const tz = cl[j * 3 + 2] - cl[hint * 3 + 2];
          const lat = ((pp.x - cl[hint * 3]) * tz - (pp.z - cl[hint * 3 + 2]) * tx) / (Math.hypot(tx, tz) || 1);
          const ws = s.v.wheels.map((w) => (w.contact ? `${w.surface[0]}${(w.compression * 100).toFixed(0)}` : '-')).join(' ');
          console.log(`    heave ${heave.toFixed(0)} m/s² at ${sNow.toFixed(0)} m lateral ${lat.toFixed(1)} ${(sp * 3.6).toFixed(0)} km/h wheels ${ws}`);
        }
        if (heave > 15) bumpy[Math.floor(sNow / 100) * 100] = (bumpy[Math.floor(sNow / 100) * 100] ?? 0) + 1;
        s.v.wheels.forEach((w, k) => {
          if (prevContact[k] && !w.contact) flicker++;
          prevContact[k] = w.contact;
        });
      }
    }
    maxV = Math.max(maxV, s.v.telemetry.speed * 3.6);
    {
      const w = s.v.wheels;
      const f = (w[0].temp + w[1].temp) / 2;
      const r = (w[2].temp + w[3].temp) / 2;
      if (warmAt < 0 && Math.min(f, r) >= 80) warmAt = t;
      if (laps.length >= 1 && process.env.HEATLOG) {
        const sp = s.v.telemetry.speed;
        w.forEach((x, k) => {
          const a = k < 2 ? 0 : 1;
          heat.long[a] += Math.abs(x.fx * x.slipRatio * sp) * DT;
          heat.lat[a] += Math.abs(x.fy * Math.tan(x.slipAngle) * sp) * DT;
          heat.roll[a] += 0.0075 * x.fz * sp * DT;
        });
      }
      if (laps.length >= 1) {
        tyreFSum += f;
        tyreRSum += r;
        tyreN++;
        tyrePeak = Math.max(tyrePeak, w[0].temp, w[1].temp, w[2].temp, w[3].temp);
      }
    }
    brakeMax = Math.max(brakeMax, s.v.wheels[0].brakeTemp);
    brakeSum += s.v.wheels[0].brakeTemp;
    brakeN++;
    {
      const pr1 = tr.players.get('ai');
      const lapS = pr1 ? pr1.raceDist - Math.max(0, laps.length) * track.length : 0;
      if (process.env.SPLITS && lapS >= nextSplit) {
        splits.push(`${nextSplit}:${t.toFixed(1)}`);
        nextSplit += 500;
      }
    }
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
      for (const e of tr.ingest('ai', t * 1000, p.x, p.y, p.z, false))
        if (e.type === 'lap') {
          nextSplit = 500;
          laps.push(e.lapMs);
          const w = s.v.wheels;
          tyreAtLap.push(`${((w[0].temp + w[1].temp) / 2).toFixed(0)}/${((w[2].temp + w[3].temp) / 2).toFixed(0)}`);
        }
    }
  }
  const pr = tr.players.get('ai');
  if (splits.length) console.log(`  splits (lap m: race s) ${splits.join(' ')}`);
  if (laps.length < LAPS || resets > 2) failed = true;
  const lap = laps.length ? laps.map((l) => fmt(l / 1000)).join(' ') : `NOT FINISHED (${pr?.raceDist.toFixed(0)} m)`;
  if (laps.length < LAPS && laps.length) console.log(`  NOT FINISHED (${pr?.raceDist.toFixed(0)} m)`);
  const wear = s.v.wheels.map((w) => `${(w.wear * 100).toFixed(1)}%`).join('/');
  const bumpList = Object.entries(bumpy)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  console.log(
    `  ride: heave rms ${Math.sqrt(heaveSq / Math.max(1, heaveN)).toFixed(2)} m/s², max ${heaveMax.toFixed(0)} m/s² at ${heaveMaxAt.toFixed(0)} m, ` +
      `wheel lift-offs ${flicker}, first 6 s from the grid: max |vy| ${startVy.toFixed(2)} m/s, max heave ${startHeave.toFixed(1)} m/s²; steps >15 m/s² per 100 m: ${bumpList || 'none'}`,
  );
  if (process.env.HEATLOG)
    console.log(
      `  heat per axle (kJ, front/rear): drive+brake slip ${(heat.long[0] / 1e3).toFixed(0)}/${(heat.long[1] / 1e3).toFixed(0)}, cornering slip ${(heat.lat[0] / 1e3).toFixed(0)}/${(heat.lat[1] / 1e3).toFixed(0)}, rolling ${(heat.roll[0] / 1e3).toFixed(0)}/${(heat.roll[1] / 1e3).toFixed(0)}`,
    );
  console.log(
    `  tyres (°C, front/rear axle): at each lap end ${tyreAtLap.join(' ') || '-'}; flying laps avg ${tyreN ? `${(tyreFSum / tyreN).toFixed(0)}/${(tyreRSum / tyreN).toFixed(0)}` : '-'}, ` +
      `peak ${tyrePeak ? tyrePeak.toFixed(0) : '-'}; both axles ≥ 80 °C after ${warmAt >= 0 ? `${warmAt.toFixed(0)} s` : 'never'}`,
  );
  console.log(
    `skill ${skill}${WET ? ` wet ${WET}` : ''}: lap ${lap}, resets ${resets}, spins ${spins}, wall contacts ${wallHits}, top ${maxV.toFixed(0)} km/h, track-limit violations ${violations} (${offTime.toFixed(1)} s), tread used FL/FR/RL/RR ${wear} (${s.v.compound.name}), front brake ${Math.round(brakeSum / brakeN)} °C avg / ${Math.round(brakeMax)} °C peak`,
  );
}
process.exit(failed ? 1 : 0);

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(3).padStart(6, '0')}`;
}
