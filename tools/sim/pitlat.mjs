/**
 * Pit lane check: prints the surface types across the track (lateral −45 … +8 m, # asphalt, c kerb, . grass,
 * W wall) every 10 m of the lap, with the traced pit lane marked P, so the trace can be compared with the real
 * lane. Run from the repo root.
 *
 *   node tools/sim/pitlat.mjs [fromS] [toS]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const S = ['#', 'c', '.', 'g', 's', 'W'];
const buf = gunzipSync(readFileSync('apps/client/public/assets/track/collision.apxc'));
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let o = 12;
const grid = new Map();
const C = 8;
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
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]].map((k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
    const id = tris.push({ si, v }) - 1;
    const xa = Math.floor(Math.min(...v.map((p) => p[0])) / C);
    const xb = Math.floor(Math.max(...v.map((p) => p[0])) / C);
    const za = Math.floor(Math.min(...v.map((p) => p[2])) / C);
    const zb = Math.floor(Math.max(...v.map((p) => p[2])) / C);
    if ((xb - xa + 1) * (zb - za + 1) > 2500) continue;
    for (let x = xa; x <= xb; x++)
      for (let z = za; z <= zb; z++) {
        const k = x * 100000 + z;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(id);
      }
  }
}
const surf = (x, z) => {
  let best = ' ';
  for (const id of grid.get(Math.floor(x / C) * 100000 + Math.floor(z / C)) ?? []) {
    const [a, b, c] = tris[id].v;
    const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(det) < 1e-9) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
    if (l1 < 0 || l2 < 0 || 1 - l1 - l2 < 0) continue;
    if (tris[id].si === 5) return 'W';
    if (best === ' ' || best === '.') best = S[tris[id].si];
  }
  return best;
};
const t = JSON.parse(readFileSync('apps/client/public/assets/track.json', 'utf8'));
const cl = t.centerline;
const cs = t.cumS;
const N = cl.length / 3;
const pit = t.pitLane.points;
const [from, to] = [Number(process.argv[2] ?? 4950), Number(process.argv[3] ?? 5200)];
for (let s = from; s <= to; s += 10) {
  const sm = s % t.length;
  let i = 0;
  while (i < N - 1 && cs[i] < sm) i++;
  const j = (i + 1) % N;
  let tx = cl[j * 3] - cl[i * 3];
  let tz = cl[j * 3 + 2] - cl[i * 3 + 2];
  const l = Math.hypot(tx, tz);
  tx /= l;
  tz /= l;
  let row = '';
  for (let lat = -45; lat <= 8; lat++) {
    const x = cl[i * 3] + tz * lat;
    const z = cl[i * 3 + 2] - tx * lat;
    row += pit.some((p) => Math.hypot(p[0] - x, p[2] - z) < 0.8) ? 'P' : surf(x, z);
  }
  console.log(String(Math.round(sm)).padStart(5), row);
}
console.log('      lateral -45 ... +8 (centreline at column 46)');
