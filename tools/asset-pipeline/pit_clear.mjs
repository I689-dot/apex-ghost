#!/usr/bin/env node
/**
 * Pit lane clearance: the traced (or hand-placed) pit lane path can run within a metre of a barrier, at the entry
 * of the Nürburgring it went through the end of the pit-entry rail, and the bots following it scraped the barrier
 * and climbed it. Every lane point is moved sideways until both walls are at least CLEAR m away (half a car's width
 * plus a margin), or centred where the lane is narrower than that; the shifts are eased along the lane.
 *
 *   node tools/asset-pipeline/pit_clear.mjs [--track <layout id> ...] [--dry]
 *
 * Without --track: every layout in public/assets/tracks.json. Layouts sharing a collision file and the same lane are
 * moved alike. Rewrites the layout JSON in place (only pitLane.points and pitLane.length change).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.resolve(here, '../../apps/client/public');
const CLEAR = 2.3;
const LOOK = 9;
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const wanted = args.flatMap((a, i) => (a === '--track' ? [args[i + 1]] : []));
const file = (url) => path.join(PUB, url.replace(/\?.*$/, ''));

await RAPIER.init();
const index = JSON.parse(readFileSync(path.join(PUB, 'assets/tracks.json'), 'utf8')).tracks;
const worlds = new Map();
/** The walls of a collision file as a Rapier world (cached: the Nürburgring layouts share one). */
function wallsOf(td) {
  const key = td.collision.file.replace(/\?.*$/, '');
  if (worlds.has(key)) return worlds.get(key);
  const raw = readFileSync(file(td.collision.file));
  const buf = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
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
    if (td.collision.surfaces[si] === 'wall') world.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx));
  }
  world.updateSceneQueries();
  worlds.set(key, world);
  return world;
}

for (const e of index.filter((t) => !wanted.length || wanted.includes(t.id))) {
  const f = file(e.file);
  const td = JSON.parse(readFileSync(f, 'utf8'));
  const lane = td.pitLane;
  if (!lane || lane.points.length < 4) continue;
  const world = wallsOf(td);
  const pts = lane.points;
  const n = pts.length;
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  /** Distance to the nearest wall from (x, y, z) towards (dx, dz), at bumper and at body height. */
  const wallAt = (x, y, z, dx, dz) => {
    let best = LOOK;
    for (const up of [0.25, 0.6]) {
      ray.origin = { x, y: y + up, z };
      ray.dir = { x: dx, y: 0, z: dz };
      const h = world.castRay(ray, LOOK, true);
      if (h) best = Math.min(best, h.timeOfImpact);
    }
    return best;
  };
  const shift = new Float64Array(n);
  const tan = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    tan.push([(b[0] - a[0]) / l, (b[2] - a[2]) / l]);
  }
  for (let i = 0; i < n; i++) {
    const [tx, tz] = tan[i];
    const p = pts[i];
    // left of travel: (tz, -tx); the worst of the point and a car's length either side of it
    let dl = LOOK;
    let dr = LOOK;
    for (const k of [-2, 0, 2]) {
      const x = p[0] + tx * k;
      const z = p[2] + tz * k;
      dl = Math.min(dl, wallAt(x, p[1], z, tz, -tx));
      dr = Math.min(dr, wallAt(x, p[1], z, -tz, tx));
    }
    if (dl + dr < CLEAR * 2) shift[i] = (dl - dr) / 2;
    else if (dl < CLEAR) shift[i] = -(CLEAR - dl);
    else if (dr < CLEAR) shift[i] = CLEAR - dr;
  }
  // eased along the lane: the largest shift nearby, then averaged (no kinks)
  const held = shift.map((_, i) => {
    let m = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (Math.abs(shift[k]) > Math.abs(m)) m = shift[k];
    return m;
  });
  const eased = held.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) {
      s += held[k];
      c++;
    }
    return s / c;
  });
  let moved = 0;
  let most = 0;
  const out = pts.map((p, i) => {
    const s = eased[i];
    if (Math.abs(s) < 0.05) return p;
    moved++;
    most = Math.max(most, Math.abs(s));
    const [tx, tz] = tan[i];
    return [Math.round((p[0] + tz * s) * 1000) / 1000, p[1], Math.round((p[2] - tx * s) * 1000) / 1000];
  });
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(out[i][0] - out[i - 1][0], out[i][2] - out[i - 1][2]);
  console.log(`${e.id}: ${moved} of ${n} lane points moved (up to ${most.toFixed(2)} m), lane ${lane.length.toFixed(1)} → ${len.toFixed(1)} m`);
  if (dry || !moved) continue;
  lane.points = out;
  lane.length = Math.round(len * 10) / 10;
  writeFileSync(f, JSON.stringify(td));
}
