/**
 * The pit lane's driving surface as the wheels see it in the game (collision + the smoothed road patches of
 * roadPatches.ts), against the raw collision: the worst bump per 20 m of lane (deviation from a 3 m moving line) and
 * the largest step between samples 0.25 m apart, in the lane's middle and 3 m either side.
 *
 *   pnpm tsx tools/sim/pitsmooth.ts [--track <layout id>]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { Surface, TrackData } from '../../packages/shared/src/index.ts';
import { RoadPatches } from '../../apps/client/src/game/roadPatches.ts';
import type { GroundHit } from '../../apps/client/src/physics/vehicle.ts';
import { loadTrack, trackArg } from './trackfile.mjs';

await RAPIER.init();
const { track: tr, collision: buf } = loadTrack(trackArg(process.argv));
const track = tr as TrackData;
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const surf = new Map<number, Surface>();
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
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const patches = RoadPatches.build(track, (x, yTop, z, maxD) => {
  ray.origin = { x, y: yTop, z };
  const h = world.castRay(ray, maxD, true);
  if (!h || surf.get(h.collider.handle) === 'wall') return null;
  return yTop - h.timeOfImpact;
});
const hit: GroundHit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
const groundAt = (x: number, y: number, z: number, smooth: boolean): number | null => {
  ray.origin = { x, y: y + 2, z };
  const h = world.castRay(ray, 4, true);
  if (!h) return null;
  hit.px = x;
  hit.py = y + 2 - h.timeOfImpact;
  hit.pz = z;
  hit.surface = surf.get(h.collider.handle) ?? 'asphalt';
  if (hit.surface === 'wall') return null;
  if (smooth) patches.apply(x, y + 2, z, 0, -1, 0, 4, hit);
  return hit.py;
};
const pts = track.pitLane?.points ?? [];
const path: { x: number; y: number; z: number; tx: number; tz: number }[] = [];
for (let i = 0; i + 1 < pts.length; i++) {
  const [a, b] = [pts[i], pts[i + 1]];
  const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
  for (let d = 0; d < l; d += 0.25) {
    const f = d / l;
    path.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, tx: (b[0] - a[0]) / l, tz: (b[2] - a[2]) / l });
  }
}
for (const smooth of [false, true]) {
  let worst = 0;
  let worstAt = 0;
  let step = 0;
  let over3 = 0;
  let stepAt = '';
  for (const lat of [-3, 0, 3]) {
    const h = path.map((p) => groundAt(p.x + p.tz * lat, p.y, p.z - p.tx * lat, smooth));
    for (let k = 12; k < h.length - 12; k++) {
      const a = h[k - 12];
      const b = h[k + 12];
      const c = h[k];
      if (a === null || b === null || c === null) continue;
      const dev = Math.abs(c - (a + b) / 2);
      if (dev > 0.03) over3++;
      if (dev > worst) {
        worst = dev;
        worstAt = k / 4;
      }
      const n = h[k + 1];
      if (n !== null && Math.abs(n - c) > step) {
        step = Math.abs(n - c);
        stepAt = `${(k / 4).toFixed(1)} m lat ${lat}`;
      }
    }
  }
  console.log(
    `${smooth ? 'game (smoothed)' : 'raw collision  '}: worst bump ${(worst * 100).toFixed(1)} cm at ${worstAt.toFixed(0)} m, largest step ${(step * 100).toFixed(1)} cm (${stepAt}), samples off by >3 cm: ${over3}`,
  );
}
