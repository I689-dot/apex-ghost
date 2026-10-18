/**
 * Collision-hole scan: casts rays down across the circuit (and its run-off) every 5 m and reports places where
 * nothing is hit, i.e. where a car would fall through the world.
 *
 *   pnpm tsx tools/sim/holes.ts [--track <layout id>]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { TrackData } from '../../packages/shared/src/index.ts';
import { loadTrack, trackArg } from './trackfile.mjs';

await RAPIER.init();
const loaded = loadTrack(trackArg(process.argv));
const track = loaded.track as TrackData;
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const buf = loaded.collision;
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let o = 12;
for (let i = 0; i < dv.getUint32(8, true); i++) {
  const nv = dv.getUint32(o + 4, true);
  const ni = dv.getUint32(o + 8, true);
  o += 12;
  const pos = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
  o += nv * 12;
  const idx = new Uint32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + ni * 4));
  o += ni * 4;
  world.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx));
}
world.step();
const cl = track.centerline;
const n = cl.length / 3;
const holes: string[] = [];
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const check = (x: number, y: number, z: number) => {
  ray.origin = { x, y: y + 4, z };
  return world.castRay(ray, 14, true) !== null;
};
for (let i = 0; i < n; i++) {
  const j = (i + 1) % n;
  let tx = cl[j * 3] - cl[i * 3];
  let tz = cl[j * 3 + 2] - cl[i * 3 + 2];
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  const miss: number[] = [];
  for (let lat = -(track.widthR[i] + 4); lat <= track.widthL[i] + 4; lat += 1) {
    if (!check(cl[i * 3] + tz * lat, cl[i * 3 + 1], cl[i * 3 + 2] - tx * lat)) miss.push(lat);
  }
  if (miss.length)
    holes.push(
      `${track.cumS[i].toFixed(0)} m (${cl[i * 3].toFixed(0)}, ${cl[i * 3 + 2].toFixed(0)}): ${miss.length} misses, lateral ${miss[0]}..${miss[miss.length - 1]}`,
    );
}
const pl = track.pitLane;
if (pl) {
  for (let i = 0; i < pl.points.length; i += 2) {
    const p = pl.points[i];
    for (const lat of [-3, 0, 3]) if (!check(p[0] + lat, p[1], p[2])) holes.push(`pit lane point ${i} (${p[0].toFixed(0)}, ${p[2].toFixed(0)}) lateral ${lat}`);
  }
}
console.log(holes.length ? holes.join('\n') : 'no holes');
