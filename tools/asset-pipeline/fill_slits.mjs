/**
 * Fills the slits in a circuit's collision: gaps up to MAX_GAP wide between two ground surfaces (most often between
 * the road's edge and the verge beside it, where the source model's pieces don't quite meet). A wheel running wide
 * dropped into them and the car jumped (Spa: 0.5 m wide and metres long beside the left edge in a dozen places,
 * tools/sim/holes.ts and ridescan.ts). fill_holes.mjs fills the big holes on a 2 m lattice; these are too narrow for it.
 *
 * Every 0.5 m along the lap and every 0.25 m across it (out to the track limits + OUT_M), the top ground surface (not
 * walls). A run of missing samples no wider than MAX_GAP, with ground on both sides at heights within MAX_STEP of each
 * other, is bridged: a flush quad from one side's height to the other's, of the outer side's surface. The quads go
 * into the collision as extra parts (the visible model is left as it is: a crack there shows, but holds no wheel).
 *
 *   node tools/asset-pipeline/fill_slits.mjs --track=apps/client/public/assets/tracks/spa.json \
 *     --apxc=apps/client/public/assets/maps/spa/collision.apxc [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

const STEP_S = 0.5;
const STEP_L = 0.25;
const MAX_GAP = 2.0;
const MAX_STEP = 0.3;
const OUT_M = 4;
const SURFACES = ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'];

const opts = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const td = JSON.parse(readFileSync(opts.track, 'utf8'));
const cl = td.centerline;
const cum = td.cumS;
const N = cum.length;
const L = td.length;

function readApxc(file) {
  const raw = readFileSync(file);
  const gz = raw[0] === 0x1f && raw[1] === 0x8b;
  const buf = gz ? gunzipSync(raw) : raw;
  const n = buf.readUInt32LE(8);
  const parts = [];
  let o = 12;
  for (let i = 0; i < n; i++) {
    const si = buf.readUInt32LE(o);
    const nv = buf.readUInt32LE(o + 4);
    const ni = buf.readUInt32LE(o + 8);
    o += 12;
    const pos = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
    o += nv * 12;
    const idx = new Int32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + ni * 4));
    o += ni * 4;
    parts.push({ si, pos, idx });
  }
  return { gz, head: Buffer.from(buf.subarray(0, 12)), parts };
}
function writeApxc(file, { gz, head, parts }) {
  const chunks = [Buffer.from(head)];
  chunks[0].writeUInt32LE(parts.length, 8);
  for (const p of parts) {
    const h = Buffer.alloc(12);
    h.writeUInt32LE(p.si, 0);
    h.writeUInt32LE(p.pos.length / 3, 4);
    h.writeUInt32LE(p.idx.length, 8);
    chunks.push(h, Buffer.from(p.pos.buffer, p.pos.byteOffset, p.pos.byteLength), Buffer.from(p.idx.buffer, p.idx.byteOffset, p.idx.byteLength));
  }
  const out = Buffer.concat(chunks);
  writeFileSync(file, gz ? gzipSync(out, { level: 9 }) : out);
}

const col = readApxc(opts.apxc);
// the surface triangles on a 2 m grid, for a top-surface lookup
const CELL = 2;
const grid = new Map();
const tris = [];
const wallGrid = new Map();
for (const p of col.parts) {
  if (SURFACES[p.si] === 'wall') {
    // where walls stand (a 0.5 m grid): a gap under a wall is its footprint, not a slit
    // (along every edge of its triangles: a long wall has vertices only at its ends)
    for (let t = 0; t < p.idx.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const u = p.idx[t + e] * 3;
        const w = p.idx[t + ((e + 1) % 3)] * 3;
        const len = Math.hypot(p.pos[w] - p.pos[u], p.pos[w + 2] - p.pos[u + 2]);
        for (let k = 0; k <= Math.ceil(len / 0.25); k++) {
          const f = k / Math.max(1, Math.ceil(len / 0.25));
          wallGrid.set(
            `${Math.floor((p.pos[u] + (p.pos[w] - p.pos[u]) * f) / 0.5)},${Math.floor((p.pos[u + 2] + (p.pos[w + 2] - p.pos[u + 2]) * f) / 0.5)}`,
            true,
          );
        }
      }
    continue;
  }
  for (let t = 0; t < p.idx.length; t += 3) {
    const g = [0, 1, 2].flatMap((k) => [p.pos[p.idx[t + k] * 3], p.pos[p.idx[t + k] * 3 + 1], p.pos[p.idx[t + k] * 3 + 2]]);
    const n = tris.push({ g, si: p.si }) - 1;
    for (let gx = Math.floor(Math.min(g[0], g[3], g[6]) / CELL); gx <= Math.floor(Math.max(g[0], g[3], g[6]) / CELL); gx++)
      for (let gz = Math.floor(Math.min(g[2], g[5], g[8]) / CELL); gz <= Math.floor(Math.max(g[2], g[5], g[8]) / CELL); gz++) {
        const k = `${gx},${gz}`;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(n);
      }
  }
}
function triH(g, x, z) {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = g;
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return null;
  const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
  const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) return null;
  return u * ay + v * by + (1 - u - v) * cy;
}
/** The top surface at (x, z) within 1.5 m of yref: { y, si } or null. */
function top(x, z, yref) {
  let best = null;
  for (const n of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
    const h = triH(tris[n].g, x, z);
    if (h !== null && Math.abs(h - yref) < 1.5 && (!best || h > best.y)) best = { y: h, si: tris[n].si };
  }
  return best;
}
function frameAt(s) {
  s = ((s % L) + L) % L;
  let lo = 0;
  let hi = N - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (cum[m] <= s) lo = m;
    else hi = m - 1;
  }
  const i = lo;
  const j = (i + 1) % N;
  const u = (s - cum[i]) / Math.max(1e-6, (j ? cum[j] : L) - cum[i]);
  const x = cl[i * 3] + (cl[j * 3] - cl[i * 3]) * u;
  const y = cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * u;
  const z = cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * u;
  let tx = cl[j * 3] - cl[i * 3];
  let tz = cl[j * 3 + 2] - cl[i * 3 + 2];
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  // left normal
  return { i, x, y, z, tx, tz, nx: tz, nz: -tx };
}

const quads = new Map(); // si → [x,y,z...] (4 corners per quad)
let slits = 0;
const where = [];
for (let s = 0; s < L; s += STEP_S) {
  const f = frameAt(s);
  const limL = (td.limitL?.[f.i] ?? td.widthL[f.i]) + OUT_M;
  const limR = (td.limitR?.[f.i] ?? td.widthR[f.i]) + OUT_M;
  for (const side of [1, -1]) {
    const lim = side > 0 ? limL : limR;
    let prev = null; // last ground: { d, y, si }
    let gapFrom = null;
    for (let d = 0; d <= lim; d += STEP_L) {
      const g = top(f.x + f.nx * d * side, f.z + f.nz * d * side, f.y);
      if (!g) {
        if (prev && gapFrom === null) gapFrom = d;
        continue;
      }
      if (gapFrom !== null && prev) {
        const width = d - prev.d;
        // a wall over the gap (a pit wall, a barrier's foot): not a slit
        let walled = false;
        for (let e = gapFrom; e < d && !walled; e += STEP_L) {
          const wx = f.x + f.nx * e * side;
          const wz = f.z + f.nz * e * side;
          for (let a = -1; a <= 1 && !walled; a++)
            for (let b = -1; b <= 1 && !walled; b++) if (wallGrid.has(`${Math.floor(wx / 0.5) + a},${Math.floor(wz / 0.5) + b}`)) walled = true;
        }
        if (!walled && width - STEP_L <= MAX_GAP && Math.abs(g.y - prev.y) <= MAX_STEP) {
          slits++;
          if (where.length < 400) where.push(`${s.toFixed(1)} m ${(side * gapFrom).toFixed(2)}`);
          // a flush quad from the inner ground to the outer, 0.6 m along (overlapping the next station's)
          const si = SURFACES[g.si] === 'asphalt' && SURFACES[prev.si] !== 'asphalt' ? prev.si : g.si;
          const a = prev.d - 0.05;
          const b = d + 0.05;
          const out = quads.get(si) ?? [];
          for (const [ds, dd, yy] of [
            [-0.3, a, prev.y],
            [0.3, a, prev.y],
            [0.3, b, g.y],
            [-0.3, b, g.y],
          ])
            out.push(f.x + f.tx * ds + f.nx * dd * side, yy - 0.005, f.z + f.tz * ds + f.nz * dd * side);
          quads.set(si, out);
        }
      }
      gapFrom = null;
      prev = { d, y: g.y, si: g.si };
    }
  }
}
// group the slits found into stretches for the report
const stretches = [];
for (const w of where) {
  const [s, , lat] = w.split(' ');
  const last = stretches[stretches.length - 1];
  if (last && Number(s) - last.to <= 2 && Math.sign(Number(lat)) === last.side) last.to = Number(s);
  else stretches.push({ from: Number(s), to: Number(s), side: Math.sign(Number(lat)), lat: Number(lat) });
}
console.log(`${slits} slit samples; stretches: ${stretches.map((x) => `${x.from.toFixed(0)}-${x.to.toFixed(0)} m at ${x.lat.toFixed(1)}`).join(', ')}`);
if (opts.dry) process.exit(0);
for (const [si, flat] of quads) {
  const nq = flat.length / 12;
  const pos = new Float32Array(flat);
  const idx = new Int32Array(nq * 6);
  for (let q = 0; q < nq; q++) idx.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4, q * 4 + 3, q * 4 + 2], q * 6);
  col.parts.push({ si, pos, idx });
}
writeApxc(opts.apxc, col);
console.log(`${opts.apxc}: ${[...quads.values()].reduce((a, q) => a + q.length / 12, 0)} fill quads added`);
