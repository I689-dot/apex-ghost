/**
 * Pit box placement check: for every layout, where each box lands across the lane (towards the garages) and what
 * the wall probe saw at each of its points (garage front, pit wall). A box whose outer edge passes a wall, or whose
 * inner edge crosses the pit wall, is flagged.
 *
 *   pnpm tsx tools/sim/pitboxes.ts [--track id]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { TrackData } from '../../packages/shared/src/index.ts';
import { WALL_GROUPS, TRACK_GROUPS } from '../../apps/client/src/physics/vehicle.ts';
import { PitLaneMonitor } from '../../apps/client/src/game/pitLane.ts';
import { loadTrack, trackArg } from './trackfile.mjs';

await RAPIER.init();
const ids = trackArg(process.argv) ? [trackArg(process.argv)] : ['nurburgring_gp_2022', 'zandvoort', 'nurburgring_24h'];
for (const id of ids) {
  const loaded = loadTrack(id);
  const track = loaded.track as TrackData;
  if (!track.pitLane) continue;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
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
    const wall = track.collision.surfaces[si] === 'wall';
    world.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx).setCollisionGroups(wall ? WALL_GROUPS : TRACK_GROUPS));
  }
  world.updateSceneQueries();
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const probe = (x: number, y: number, z: number, dx: number, dz: number, max: number) => {
    ray.origin = { x, y: y + 0.8, z };
    ray.dir = { x: dx, y: 0, z: dz };
    const h = world.castRay(ray, max, true, undefined, (0xffff << 16) | 0x0004);
    return h ? h.timeOfImpact : null;
  };
  const pit = new PitLaneMonitor(track);
  pit.measureBoxes(probe);
  const pts = track.pitLane.points;
  console.log(`\n${id}: ${pit.boxes().length} boxes, lane points ${pts.length}, box row ${track.pitLane.boxFrom}..${track.pitLane.boxTo}`);
  pit.boxes().forEach(([a, b], k) => {
    const out: string[] = [];
    let bad = '';
    for (let i = a; i <= b; i++) {
      const [ax, az] = pit.awayAt(i);
      const g = probe(pts[i][0], pts[i][1], pts[i][2], ax, az, 25);
      const w = probe(pts[i][0], pts[i][1], pts[i][2], -ax, -az, 25);
      const sh = pit.shiftAt(i);
      if (g !== null && sh + 3 > g) bad = ' OUTER EDGE PAST A WALL';
      if (w !== null && sh - 3 < -w) bad = ' INNER EDGE PAST THE PIT WALL';
      out.push(`${g === null ? '  -  ' : g.toFixed(1).padStart(5)}/${w === null ? '  -  ' : w.toFixed(1).padStart(4)}`);
    }
    console.log(`box ${String(k).padStart(2)} [${a}-${b}] shift ${pit.shiftAt(a).toFixed(1).padStart(5)}  garage/pitwall: ${out.join(' ')}${bad}`);
  });
}
