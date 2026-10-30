/**
 * Debug picture of a stretch of a layout: the collision surfaces from above (grey asphalt, red kerb, green grass,
 * brown gravel, sand, white walls) at 0.5 m per pixel with the centreline (yellow every 50 m).
 *
 *   node tools/sim/plotregion.mjs <layout id> <fromS> <toS> <out.png> ['[[x,z],…] extra points']
 */

import sharp from 'sharp';
import { loadTrack } from './trackfile.mjs';
const [id, s0, s1, out, extra] = process.argv.slice(2);
const { track, collision: buf } = loadTrack(id);
const cl = track.centerline,
  cs = track.cumS,
  n = cl.length / 3;
const idx = [];
for (let i = 0; i < n; i++) if (cs[i] >= +s0 && cs[i] <= +s1) idx.push(i);
let x0 = Infinity,
  x1 = -Infinity,
  z0 = Infinity,
  z1 = -Infinity;
for (const i of idx) {
  x0 = Math.min(x0, cl[i * 3]);
  x1 = Math.max(x1, cl[i * 3]);
  z0 = Math.min(z0, cl[i * 3 + 2]);
  z1 = Math.max(z1, cl[i * 3 + 2]);
}
const M = 60;
x0 -= M;
x1 += M;
z0 -= M;
z1 += M;
const R = 0.5,
  W = Math.ceil((x1 - x0) / R),
  H = Math.ceil((z1 - z0) / R);
const img = Buffer.alloc(W * H * 3, 20);
const COL = [
  [90, 90, 95],
  [220, 60, 60],
  [40, 120, 40],
  [150, 120, 80],
  [200, 180, 120],
  [255, 255, 255],
];
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let o = 12;
for (let b = 0; b < dv.getUint32(8, true); b++) {
  const si = dv.getUint32(o, true),
    nv = dv.getUint32(o + 4, true),
    ni = dv.getUint32(o + 8, true);
  o += 12;
  const P = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
  o += nv * 12;
  const I = new Uint32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + ni * 4));
  o += ni * 4;
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]].map((k) => [(P[k * 3] - x0) / R, (P[k * 3 + 2] - z0) / R]);
    const xa = Math.max(0, Math.floor(Math.min(...v.map((p) => p[0])))),
      xb = Math.min(W - 1, Math.ceil(Math.max(...v.map((p) => p[0]))));
    const za = Math.max(0, Math.floor(Math.min(...v.map((p) => p[1])))),
      zb = Math.min(H - 1, Math.ceil(Math.max(...v.map((p) => p[1]))));
    if (xa > xb || za > zb) continue;
    const [a, bb, c] = v,
      d = (bb[1] - c[1]) * (a[0] - c[0]) + (c[0] - bb[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-9) {
      if (si === 5)
        for (const p of v) {
          const px = Math.round(p[0]),
            pz = Math.round(p[1]);
          if (px >= 0 && px < W && pz >= 0 && pz < H) img.set(COL[5], (pz * W + px) * 3);
        }
      continue;
    }
    for (let z = za; z <= zb; z++)
      for (let x = xa; x <= xb; x++) {
        const l1 = ((bb[1] - c[1]) * (x - c[0]) + (c[0] - bb[0]) * (z - c[1])) / d,
          l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (z - c[1])) / d;
        if (l1 < 0 || l2 < 0 || 1 - l1 - l2 < 0) continue;
        const k = (z * W + x) * 3;
        if (si === 0 || img[k] === 20 || si === 5) img.set(COL[si] ?? [255, 0, 255], k);
      }
  }
}
const dot = (x, z, c, r = 1) => {
  const px = Math.round((x - x0) / R),
    pz = Math.round((z - z0) / R);
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      const X = px + dx,
        Z = pz + dz;
      if (X >= 0 && X < W && Z >= 0 && Z < H) img.set(c, (Z * W + X) * 3);
    }
};
for (const i of idx) dot(cl[i * 3], cl[i * 3 + 2], cs[i] % 50 < 6 ? [255, 255, 0] : [0, 200, 255], 1);
if (extra) {
  const e = JSON.parse(extra);
  for (const [x, z] of e) dot(x, z, [255, 0, 255], 1);
}
await sharp(img, { raw: { width: W, height: H, channels: 3 } })
  .png()
  .toFile(out);
console.log(W, H, 'origin', x0.toFixed(1), z0.toFixed(1));
