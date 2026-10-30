/**
 * Pit lane flatness on the collision mesh (what the wheel rays ride on): the top ground surface under lanes every
 * 0.5 m across the lane path (±halfWidth), every 0.25 m along it. Reports per 10 m of lane the worst bump (deviation
 * from a 3 m moving straight line), steps over 1 cm between neighbours, and the surfaces found, worst first.
 *
 *   node tools/sim/pitflat.mjs [--track <layout id>] [--half 4] [--top 25]
 */
import { loadTrack, trackArg } from './trackfile.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const HALF = Number(opt('half', '4'));
const TOP = Number(opt('top', '25'));
const NAMES = ['asphalt', 'kerb', 'grass', 'gravel', 'sand', 'wall'];
const { track, collision: buf } = loadTrack(trackArg(process.argv));
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
// only the ground around the lane
const lane = track.pitLane.points;
const bx0 = Math.min(...lane.map((p) => p[0])) - 20;
const bx1 = Math.max(...lane.map((p) => p[0])) + 20;
const bz0 = Math.min(...lane.map((p) => p[2])) - 20;
const bz1 = Math.max(...lane.map((p) => p[2])) + 20;
let o = 12;
const C = 4;
const grid = new Map();
const tris = [];
for (let b = 0; b < dv.getUint32(8, true); b++) {
  const si = dv.getUint32(o, true);
  const nv = dv.getUint32(o + 4, true);
  const ni = dv.getUint32(o + 8, true);
  o += 12;
  const P = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
  o += nv * 12;
  const I = new Uint32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + ni * 4));
  o += ni * 4;
  if (si === 5) continue;
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]].map((k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
    if (v.every((p) => p[0] < bx0) || v.every((p) => p[0] > bx1) || v.every((p) => p[2] < bz0) || v.every((p) => p[2] > bz1)) continue;
    const id = tris.push({ si, v }) - 1;
    const xa = Math.floor(Math.min(...v.map((p) => p[0])) / C);
    const xb = Math.floor(Math.max(...v.map((p) => p[0])) / C);
    const za = Math.floor(Math.min(...v.map((p) => p[2])) / C);
    const zb = Math.floor(Math.max(...v.map((p) => p[2])) / C);
    if ((xb - xa + 1) * (zb - za + 1) > 4000) continue;
    for (let x = xa; x <= xb; x++)
      for (let z = za; z <= zb; z++) {
        const k = x * 100000 + z;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(id);
      }
  }
}
/** Top ground height near `yRef` (within 3 m) at (x, z), and its surface. */
const top = (x, z, yRef) => {
  let best = null;
  for (const id of grid.get(Math.floor(x / C) * 100000 + Math.floor(z / C)) ?? []) {
    const [a, b, c] = tris[id].v;
    const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(det) < 1e-9) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
    if (Math.abs(y - yRef) > 3) continue;
    if (!best || y > best.y) best = { y, si: tris[id].si };
  }
  return best;
};

const pts = track.pitLane.points;
// resample the lane path every 0.25 m
const path = [];
for (let i = 0; i + 1 < pts.length; i++) {
  const [a, b] = [pts[i], pts[i + 1]];
  const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
  for (let d = 0; d < l; d += 0.25) {
    const f = d / l;
    path.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, tx: (b[0] - a[0]) / l, tz: (b[2] - a[2]) / l });
  }
}
const lanes = [];
for (let lat = -HALF; lat <= HALF + 1e-6; lat += 0.5) {
  const h = path.map((p) => top(p.x + p.tz * lat, p.z - p.tx * lat, p.y));
  lanes.push({ lat, h });
}
const report = [];
const W = 12; // 3 m half-window in samples (0.25 m)
for (let i = 0; i < path.length; i += 40) {
  let bump = 0;
  let step = 0;
  let worstLat = 0;
  const surfaces = new Set();
  let missing = 0;
  for (const { lat, h } of lanes)
    for (let k = i; k < Math.min(path.length, i + 40); k++) {
      if (!h[k]) {
        missing++;
        continue;
      }
      surfaces.add(NAMES[h[k].si] ?? h[k].si);
      const a = h[Math.max(0, k - W)];
      const b = h[Math.min(path.length - 1, k + W)];
      if (a && b) {
        const dev = Math.abs(h[k].y - (a.y + b.y) / 2);
        if (dev > bump) {
          bump = dev;
          worstLat = lat;
        }
      }
      const n = h[k + 1];
      if (n) step = Math.max(step, Math.abs(n.y - h[k].y));
    }
  report.push({ at: Math.round(i / 4), bump, step, worstLat, surfaces: [...surfaces].join(','), missing, x: path[i].x.toFixed(1), z: path[i].z.toFixed(1) });
}
report.sort((a, b) => b.bump - a.bump);
console.log(`pit lane ${(path.length / 4).toFixed(0)} m, ${lanes.length} lanes ±${HALF} m`);
for (const r of report.slice(0, TOP))
  console.log(
    `${String(r.at).padStart(4)} m  bump ${(r.bump * 100).toFixed(1).padStart(5)} cm (lat ${r.worstLat})  step ${(r.step * 100).toFixed(1).padStart(5)} cm  ${r.surfaces}${r.missing ? `  missing ${r.missing}` : ''}  @ ${r.x},${r.z}`,
  );
