/**
 * Road cross-section probe: the collision's top surface over a short stretch, as a grid (every --step m along, every
 * 0.5 m across from the right track limit to the left one), printed as the height left after taking out a smooth
 * road (a 9 m moving average along each lane), in cm. A slab or a stray piece shows as a block of + values, a
 * sawtooth of slices as stripes, a ledge at the edge as a column. Surfaces: a = asphalt, k = kerb, g = grass,
 * r = gravel, . = nothing.
 *
 *   pnpm tsx tools/sim/roadprobe.ts --track spa --from 4230 --to 4310 [--step 1] [--walls (w: a wall over the road)]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { Surface, TrackData } from '../../packages/shared/src/index.ts';
import { collisionParts, loadTrack, trackArg } from './trackfile.mjs';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const loaded = loadTrack(trackArg(args));
const track = loaded.track as TrackData;
const FROM = Number(opt('from', '0'));
const TO = Number(opt('to', '100'));
const STEP = Number(opt('step', '1'));
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const surf = new Map<number, Surface>();
for (const part of collisionParts(loaded.collision)) {
  const surface = track.collision.surfaces[part.surface];
  if (surface === 'wall' && !args.includes('--walls')) continue;
  surf.set(world.createCollider(RAPIER.ColliderDesc.trimesh(part.pos, part.idx)).handle, surface);
}
world.updateSceneQueries();
const L = track.length;
const n = track.cumS.length;
const cl = track.centerline;
const idx = (s: number) => {
  s = ((s % L) + L) % L;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (track.cumS[m] <= s) lo = m;
    else hi = m - 1;
  }
  return lo;
};
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
function sample(s: number, lat: number): { y: number; surface: Surface } | null {
  const i = idx(s);
  const j = (i + 1) % n;
  const u = ((((s % L) + L) % L) - track.cumS[i]) / Math.max(1e-6, (j ? track.cumS[j] : L) - track.cumS[i]);
  const x = cl[i * 3] + (cl[j * 3] - cl[i * 3]) * u;
  const y = cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * u;
  const z = cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * u;
  const yaw = Math.atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]);
  ray.origin = { x: x + Math.cos(yaw) * lat, y: y + 4, z: z - Math.sin(yaw) * lat };
  const h = world.castRay(ray, 10, true);
  if (!h) return null;
  return { y: y + 4 - h.timeOfImpact, surface: surf.get(h.collider.handle) ?? 'asphalt' };
}
const i0 = idx((FROM + TO) / 2);
const right = -Math.ceil((track.limitR?.[i0] ?? track.widthR[i0]) + 1);
const left = Math.ceil((track.limitL?.[i0] ?? track.widthL[i0]) + 1);
const lats: number[] = [];
for (let l = left; l >= right; l -= 0.5) lats.push(l);
const PAD = 5;
const rows: { s: number; y: (number | null)[]; c: string }[] = [];
for (let s = FROM - PAD; s <= TO + PAD; s += STEP) {
  const r = lats.map((l) => sample(s, l));
  rows.push({
    s,
    y: r.map((x) => x?.y ?? null),
    c: r.map((x) => (x ? ({ asphalt: 'a', curb: 'k', grass: 'g', gravel: 'r', sand: 's', wall: 'w' }[x.surface] ?? '?') : '.')).join(''),
  });
}
console.log(`${track.name} ${FROM}-${TO} m, lanes ${left} m (left) … ${right} m (right) every 0.5 m; residual from a 9 m average along (cm)`);
console.log(`       ${lats.map((l) => (Number.isInteger(l) ? String(l).padStart(4) : '    ')).join('')}`);
const half = Math.round(4.5 / STEP);
for (let r = Math.round(PAD / STEP); r < rows.length - Math.round(PAD / STEP); r++) {
  const cells = lats.map((_, c) => {
    const y = rows[r].y[c];
    if (y === null) return '   .';
    let sum = 0;
    let k = 0;
    for (let d = -half; d <= half; d++) {
      const v = rows[r + d]?.y[c];
      if (v !== null && v !== undefined) {
        sum += v;
        k++;
      }
    }
    const res = Math.round((y - sum / k) * 100);
    return Math.abs(res) < 1 ? '   ·' : String(res).padStart(4);
  });
  console.log(`${String(rows[r].s.toFixed(0)).padStart(5)}  ${cells.join('')}  ${rows[r].c}`);
}
