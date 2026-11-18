/**
 * Racing line for a layout, as the real teams' lap-time simulation finds it, written to
 * apps/client/public/assets/racelines/<layout>.json (the bots' line, the braking-line assist, the rubbered line).
 *
 *  1. Where a car may drive: across every centreline point, outward from the middle along the collision's top
 *     surface (walls left out) while it is asphalt or kerb and level with the road (no more than 7 cm above the
 *     road's camber carried on, no drop of more than 10 cm, no 3 cm step in 10 cm: a sausage kerb, a ledge, the grass
 *     beyond). The car's centre keeps its outer wheels' edge on that (half the track, half a tyre and a margin:
 *     EDGE_IN), and the inner wheels within the track limit's tolerance (the white line + 0.5 m: LIMIT_OUT).
 *  2. The minimum curvature line inside those bounds (the classic first guess).
 *  3. Minimum lap time from there (ai.ts optimiseLapTime: smooth changes of the line kept when the quasi-steady lap
 *     time of a reference GT3 improves): the late apexes onto long straights, the compromises in linked corners.
 *  The cautious line the slower bots blend with: the same optimisation 2 m inside the asphalt edges (no kerbs).
 *
 *   pnpm tsx tools/sim/raceline.ts --track spa [--evals-per-point 150] [carId]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarsFile, Surface, TrackData } from '../../packages/shared/src/index.ts';
import {
  buildRacingLine,
  carLimits,
  lineFromOffsets,
  optimiseLapTime,
  profileLapTime,
  speedProfile,
  type RacelineFile,
} from '../../apps/client/src/game/ai.ts';
import { cutWallsAcrossLine } from '../../apps/client/src/game/wallCut.ts';
import { collisionParts, loadTrack, trackArg } from './trackfile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../../apps/client/public/assets');
const cars = JSON.parse(readFileSync(path.join(pub, 'cars.json'), 'utf8')) as CarsFile;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const vals = new Set(['--track', '--evals-per-point'].flatMap((k) => (args.includes(k) ? [args[args.indexOf(k) + 1]] : [])));
const carId = args.find((a) => !a.startsWith('--') && !vals.has(a)) ?? '2024_porsche_992_gt3_r';
const entry = cars.cars.find((c) => c.id === carId) ?? cars.cars[0];
const loaded = loadTrack(trackArg(args));
const track = loaded.track as TrackData;
const EVALS = Number(opt('evals-per-point', '150'));
/** Car centre to the outer edge of its tyres (half a GT3's ~1.65 m track + half a 0.31 m tyre) and 0.2 m to spare. */
const EDGE_IN = 0.82 + 0.16 + 0.2;
/** How far past the white line the centre may go: the inner wheels (0.82 m in) stay within the line + 0.5 m. */
const LIMIT_OUT = 0.82 + 0.5 - 0.35;

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const surf = new Map<number, Surface>();
for (const part of collisionParts(loaded.collision)) {
  const surface = track.collision.surfaces[part.surface];
  // walls across this layout's own lap line (a road the map closes for another layout) are not there
  const idx = surface === 'wall' ? cutWallsAcrossLine(part.pos, part.idx, track) : part.idx;
  surf.set(world.createCollider(RAPIER.ColliderDesc.trimesh(part.pos, idx)).handle, surface);
}
world.updateSceneQueries();
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const cl = track.centerline;
const n = cl.length / 3;
const sideRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
/** Distance to the first wall from (x, y + 0.4, z) along (dx, dz), up to max. */
function wallAt(x: number, y: number, z: number, dx: number, dz: number, max: number): number {
  sideRay.origin = { x, y: y + 0.4, z };
  sideRay.dir = { x: dx, y: 0, z: dz };
  const h = world.castRay(sideRay, max, true, undefined, undefined, undefined, undefined, (c) => surf.get(c.handle) === 'wall');
  return h ? h.timeOfImpact : max;
}
function ground(x: number, y: number, z: number): { y: number; s: Surface } | null {
  ray.origin = { x, y: y + 3, z };
  const h = world.castRay(ray, 6, true);
  if (!h) return null;
  return { y: y + 3 - h.timeOfImpact, s: surf.get(h.collider.handle) ?? 'asphalt' };
}

let kerbM = 0;
/**
 * How far out from (cx, cy, cz) along (dx, dz) the road is drivable: asphalt or kerb, level with the road's camber
 * carried on (no more than 7 cm above it, no drop of 10 cm, no 3 cm step in 10 cm), short of any wall by 0.3 m.
 */
function reach(cx: number, cy: number, cz: number, dx: number, dz: number, width: number, limit: number): number {
  // the road's camber: a straight line through the road's own surface on this side (from the middle to 0.5 m in)
  const pts: [number, number][] = [];
  for (let d = 0; d <= Math.max(0.5, width - 0.5); d += 0.25) {
    const g = ground(cx + dx * d, cy, cz + dz * d);
    if (g && g.s === 'asphalt') pts.push([d, g.y]);
  }
  let k0 = cy;
  let k1 = 0;
  if (pts.length >= 3) {
    const m = pts.length;
    const sx = pts.reduce((s, p) => s + p[0], 0) / m;
    const sy = pts.reduce((s, p) => s + p[1], 0) / m;
    const sxx = pts.reduce((s, p) => s + (p[0] - sx) ** 2, 0);
    k1 = sxx > 1e-6 ? pts.reduce((s, p) => s + (p[0] - sx) * (p[1] - sy), 0) / sxx : 0;
    k0 = sy - k1 * sx;
  }
  let last = 0;
  let prevY: number | null = null;
  // a wall beside the road (a pit wall with the pit lane's asphalt beyond it): no further than 0.3 m short of it
  const wall = wallAt(cx, cy, cz, dx, dz, limit + 3);
  for (let d = 0; d <= Math.min(limit + 3, wall - 0.3); d += 0.1) {
    const g = ground(cx + dx * d, cy, cz + dz * d);
    if (!g || (g.s !== 'asphalt' && g.s !== 'curb')) break; // (a wall's top: a wall)
    const above = g.y - (k0 + k1 * d);
    if (above > 0.07 || above < -0.1) break;
    if (prevY !== null && Math.abs(g.y - prevY) > 0.03) break;
    prevY = g.y;
    last = d;
    if (g.s === 'curb') kerbM += 0.1 / 6;
  }
  return last;
}

// 1. the drivable width either side
const lo = new Float32Array(n);
const hi = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const a = ((i - 1 + n) % n) * 3;
  const b = ((i + 1) % n) * 3;
  const tx = cl[b] - cl[a];
  const tz = cl[b + 2] - cl[a + 2];
  const l = Math.hypot(tx, tz) || 1;
  const nx = tz / l;
  const nz = -tx / l;
  const edge: number[] = [];
  for (const side of [1, -1]) {
    const width = side > 0 ? track.widthL[i] : track.widthR[i];
    const limit = (side > 0 ? track.limitL?.[i] : track.limitR?.[i]) ?? width + 0.5;
    // at the point and half-way to each neighbour: a barrier's nose between two points (where a road splits off)
    // stood on the asphalt between the 5 m stations unseen
    let last = Infinity;
    for (const u of [-0.5, 0, 0.5]) {
      const j = ((u < 0 ? i - 1 : i + 1) + n) % n;
      const f = Math.abs(u);
      const r = reach(
        cl[i * 3] + (cl[j * 3] - cl[i * 3]) * f,
        cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * f,
        cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * f,
        nx * side,
        nz * side,
        width,
        limit,
      );
      last = Math.min(last, r);
    }
    // the centre: outer wheels on that, inner wheels within the limit's tolerance; never less than the old line's room
    const room = Math.min(last - EDGE_IN, limit + LIMIT_OUT);
    edge.push(Math.max(room, Math.max(0, width - 2.0)));
  }
  hi[i] = edge[0];
  lo[i] = -edge[1];
}
// a gap in a kerb one point long is not worth a swerve: the room is the least of the point and its neighbours
const lo2 = Float32Array.from(lo, (_, i) => Math.max(lo[(i - 1 + n) % n], lo[i], lo[(i + 1) % n]));
const hi2 = Float32Array.from(hi, (_, i) => Math.min(hi[(i - 1 + n) % n], hi[i], hi[(i + 1) % n]));
let gained = 0;
for (let i = 0; i < n; i++) gained += hi2[i] - Math.max(0, track.widthL[i] - 2) + (-lo2[i] - Math.max(0, track.widthR[i] - 2));
console.log(
  `▶ ${track.name}: ${n} points; the line may use ${(gained / (2 * n)).toFixed(2)} m more either side on average than 2 m inside the asphalt edge; ${(kerbM / 1000).toFixed(1)} km of kerb within reach`,
);

// 2-3. lines and lap times
const car = carLimits(entry.specs);
const lapOf = (off: Float32Array) => {
  const line = lineFromOffsets(track, off);
  return profileLapTime(line, speedProfile(line, car, 1, true));
};
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const altMc = buildRacingLine(track, 2.0).offset;
console.log(`  old line (min curvature, 2 m inside the edges):      ${fmt(lapOf(altMc))}`);
// the cautious line: the fastest one inside those old bounds (no kerbs), smooth like the other so a blend is too
const loOld = Float32Array.from(track.widthR, (w) => -Math.max(0, w - 2.0));
const hiOld = Float32Array.from(track.widthL, (w) => Math.max(0, w - 2.0));
const alt = optimiseLapTime(track, altMc, loOld, hiOld, car, Math.round((n * EVALS) / 2), 3);
console.log(`  cautious line (min lap time, 2 m inside the edges):  ${fmt(lapOf(alt))}`);
const mc = buildRacingLine(track, 2.0, 3000, { lo: lo2, hi: hi2 }).offset;
console.log(`  min curvature with the kerbs:                        ${fmt(lapOf(mc))}`);
const t0 = Date.now();
const best = optimiseLapTime(track, mc, lo2, hi2, car, n * EVALS, 7, (e, t) => {
  if (e % 50000 === 0) process.stdout.write(`\r  optimising… ${((100 * e) / (n * EVALS)).toFixed(0)} %  ${fmt(t)}   `);
});
console.log(`\n  min lap time (${n * EVALS} evaluations, ${((Date.now() - t0) / 1000).toFixed(0)} s):            ${fmt(lapOf(best))}`);
// where the fastest line differs most from the min-curvature one (the late apexes)
const diffs = [...best].map((v, i) => ({ i, d: v - mc[i] })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
const shown: number[] = [];
for (const x of diffs) {
  if (shown.length >= 8) break;
  if (shown.some((j) => Math.abs(j - x.i) < 20)) continue;
  shown.push(x.i);
}
console.log(`  biggest moves from min curvature: ${shown.map((i) => `${Math.round(track.cumS[i])} m ${(best[i] - mc[i]).toFixed(1)} m`).join(', ')}`);

const cm = (a: Float32Array) => Array.from(a, (v) => Math.round(v * 100));
const file: RacelineFile = { v: 1, id: track.id, n, length: Math.round(track.length * 100) / 100, opt: cm(best), alt: cm(alt), lo: cm(lo2), hi: cm(hi2) };
// (RACELINE_OUT: another folder, the Godot app's godot/data/racelines)
const outDir = process.env.RACELINE_OUT ? path.resolve(process.env.RACELINE_OUT) : path.join(pub, 'racelines');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${track.id}.json`);
writeFileSync(out, JSON.stringify(file));
console.log(`  wrote ${path.relative(process.cwd(), out)}`);
