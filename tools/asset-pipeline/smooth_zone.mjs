/**
 * Rebuilds the road surface of a stretch of a circuit, the visible model and the collision together.
 *
 * Some stretches of the source models are badly built: Spa's turn 9 descends a 7 % slope in 5 m slices, each with its
 * own tilt (a sawtooth of 4-9 cm across the whole road), with stray road pieces 15-35 cm over it. The car bounces and
 * the road is visibly not flat. Smoothing only the wheels' rays (smoothRoad) leaves the model as it is.
 *
 * Here the stretch gets one smooth surface: the road's height across each section (from the collision's top surface)
 * fitted with a camber curve (quadratic), the curves smoothed along the lap (a 5 m box twice), faded in and out over
 * TAPER m at the ends and over EDGE_FADE m beyond the road's edges. Every surface vertex there (asphalt, kerbs, paint,
 * verges; not walls, rails or buildings) takes that surface's height plus what it stood above the road, clamped to
 * LAYER_MIN..LAYER_MAX (paint and kerbs keep their few cm, a stray layer loses its height).
 *
 *   node tools/asset-pipeline/smooth_zone.mjs --track=apps/client/public/assets/tracks/spa.json --zone=3100:3480 \
 *     --apxc=apps/client/public/assets/maps/spa/collision.apxc --glb=apps/client/public/assets/maps/spa/map_track.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dequantize, prune, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

const TAPER = 30;
const EDGE_FADE = 4;
const LAYER_MIN = -0.03;
const LAYER_MAX = 0.06;
/** Paint over the road (lines, decals): at least this far above it, so it shows and never flickers. */
const PAINT_MIN = 0.006;
const PAINT_MAT = /^(lines|redline|box_decal)/i;
/** The most a vertex moves (m). */
const MAX_MOVE = 0.4;
const SURF_MAT = /^(asph|curb|lines|astroturf|grass|gravel|sand|redline|box_decal|pits|conc_)/i;
const SURFACES = ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'];

const opts = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const td = JSON.parse(readFileSync(opts.track, 'utf8'));
const [S0, S1] = opts.zone.split(':').map(Number);
const cl = td.centerline;
const cum = td.cumS;
const N = cum.length;

// ------------------------------------------------------------------ collision
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
  const chunks = [head];
  head.writeUInt32LE(parts.length, 8);
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
// the road's top surface (asphalt and kerbs) on a grid
const CELL = 2;
const grid = new Map();
const tris = [];
for (const p of col.parts) {
  const sname = SURFACES[p.si];
  if (sname !== 'asphalt' && sname !== 'curb') continue;
  for (let t = 0; t < p.idx.length; t += 3) {
    const g = [0, 1, 2].flatMap((k) => [p.pos[p.idx[t + k] * 3], p.pos[p.idx[t + k] * 3 + 1], p.pos[p.idx[t + k] * 3 + 2]]);
    const n = tris.push(g) - 1;
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
function roadTop(x, z, yref) {
  let top = null;
  for (const n of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
    const h = triH(tris[n], x, z);
    if (h !== null && Math.abs(h - yref) < 2.5 && (top === null || h > top)) top = h;
  }
  return top;
}

// ------------------------------------------------------------------ the lap's frame
function frameAt(s) {
  let i = 0;
  while (i < N - 2 && cum[i + 1] < s) i++;
  const j = i + 1;
  const u = (s - cum[i]) / (cum[j] - cum[i]);
  const x = cl[i * 3] + (cl[j * 3] - cl[i * 3]) * u;
  const y = cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * u;
  const z = cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * u;
  let tx = cl[j * 3] - cl[i * 3];
  let tz = cl[j * 3 + 2] - cl[i * 3 + 2];
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  return { x, y, z, nx: -tz, nz: tx, half: Math.max(td.widthL[i] ?? 6, td.widthR[i] ?? 6) };
}

const STEP = 1;
const LAT = 0.5;
const sA = S0 - TAPER - 10;
const sB = S1 + TAPER + 10;
const rows = [];
for (let s = sA; s <= sB; s += STEP) {
  const f = frameAt(s);
  const samples = [];
  const raw = [];
  for (let lat = -16; lat <= 16 + 1e-6; lat += LAT) {
    const h = roadTop(f.x + f.nx * lat, f.z + f.nz * lat, f.y);
    raw.push(h);
    if (h !== null && Math.abs(lat) <= f.half + 0.5) samples.push([lat, h - f.y]);
  }
  // the camber curve: least squares quadratic, once more without the points far from it (stray pieces)
  const fit = (pts) => {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (const [x, y] of pts) {
      const x2 = x * x;
      s0++; s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2; t0 += y; t1 += x * y; t2 += x2 * y;
    }
    // solve [[s0 s1 s2][s1 s2 s3][s2 s3 s4]] [a b c] = [t0 t1 t2]
    const M = [[s0, s1, s2, t0], [s1, s2, s3, t1], [s2, s3, s4, t2]];
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-9) return null;
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const k = M[r][c] / M[c][c];
        for (let q = c; q < 4; q++) M[r][q] -= k * M[c][q];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  };
  let q = samples.length >= 6 ? fit(samples) : null;
  if (q) {
    const keep = samples.filter(([x, y]) => Math.abs(y - (q[0] + q[1] * x + q[2] * x * x)) < 0.05);
    if (keep.length >= 6) q = fit(keep) ?? q;
  }
  rows.push({ s, f, q, raw });
}
// fill gaps, then smooth along the lap
for (let i = 0; i < rows.length; i++) if (!rows[i].q) rows[i].q = (rows[i - 1] ?? rows.find((r) => r.q))?.q ?? [0, 0, 0];
// the fitted heights are relative to each section's centreline point: smooth the absolute height (a + centre y)
// a 5 m box filter twice (a 10 m triangle): it takes out the 5 m slices exactly and keeps the hill's own shape
const box = (arr, half) =>
  arr.map((_, i) => {
    const acc = [0, 0, 0];
    let n = 0;
    for (let k = -half; k <= half; k++) {
      const r = arr[i + k];
      if (!r) continue;
      for (let j = 0; j < 3; j++) acc[j] += r[j];
      n++;
    }
    return acc.map((v) => v / n);
  });
// --filter=N: the box's half width in metres (2: a 5 m box, it takes out the 5 m slices; 5: an 11 m box, the longer
// waves too, a real road's vertical curves being hundreds of metres in radius)
const HALF = Number(opts.filter ?? 2);
const smooth = box(box(rows.map((r) => [r.q[0] + r.f.y, r.q[1], r.q[2]]), HALF), HALF);


if (opts.debug) {
  const [d0, d1] = opts.debug.split(':').map(Number);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.s < d0 || r.s > d1) continue;
    const prof = [-6, -4, -2, 0, 2, 4, 6].map((l) => {
      const h = r.raw[Math.round((l + 16) / LAT)];
      const sm = smooth[i];
      const t = sm[0] + sm[1] * l + sm[2] * l * l;
      return h === null ? '   --/--' : `${((h - r.f.y) * 100).toFixed(0).padStart(4)}/${((t - r.f.y) * 100).toFixed(0).padStart(4)}`;
    });
    console.log(`s=${r.s} half=${r.f.half.toFixed(1)} raw/target cm (lat -6..6): ${prof.join(' ')}`);
  }
  process.exit(0);
}
// ------------------------------------------------------------------ the correction of one vertex
const cIdx = [];
for (let i = 0; i < N; i++) if (cum[i] >= sA - 5 && cum[i] <= sB + 5) cIdx.push(i);
function locate(x, z) {
  let best = Infinity;
  let bi = -1;
  for (const i of cIdx) {
    const d = (cl[i * 3] - x) ** 2 + (cl[i * 3 + 2] - z) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  if (bi < 0 || best > 40 * 40) return null;
  // project on the segment after (or before) the nearest point
  let s = null;
  let lat = 0;
  for (const [a, b] of [[bi, bi + 1], [bi - 1, bi]]) {
    if (a < 0 || b >= N) continue;
    const ax = cl[a * 3], az = cl[a * 3 + 2], bx = cl[b * 3], bz = cl[b * 3 + 2];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    const t = ((x - ax) * dx + (z - az) * dz) / L2;
    if (t >= -0.01 && t <= 1.01) {
      const tc = Math.max(0, Math.min(1, t));
      s = cum[a] + (cum[b] - cum[a]) * tc;
      const L = Math.sqrt(L2);
      lat = ((x - ax) * (-dz / L) + (z - az) * (dx / L)) * 1;
      break;
    }
  }
  if (s === null) {
    // past a segment's end (inside a bend): the nearest point, and the side from its normal
    s = cum[bi];
    const j = Math.min(N - 1, bi + 1);
    const i0 = j === bi ? bi - 1 : bi;
    const dx = cl[(i0 + 1) * 3] - cl[i0 * 3];
    const dz = cl[(i0 + 1) * 3 + 2] - cl[i0 * 3 + 2];
    const L = Math.hypot(dx, dz) || 1;
    lat = (x - cl[bi * 3]) * (-dz / L) + (z - cl[bi * 3 + 2]) * (dx / L);
  }
  return { s, lat };
}
function at(arr, s) {
  const k = (s - sA) / STEP;
  const i = Math.max(0, Math.min(arr.length - 2, Math.floor(k)));
  const u = Math.max(0, Math.min(1, k - i));
  return arr[i].map((v, j) => v + (arr[i + 1][j] - v) * u);
}
/** New height of a surface vertex at (x, y, z), or null to leave it. */
function corrected(x, y, z, paint = false) {
  const loc = locate(x, z);
  if (!loc) return null;
  const { s, lat } = loc;
  if (s < S0 - TAPER || s > S1 + TAPER) return null;
  const ws = s < S0 ? (s - (S0 - TAPER)) / TAPER : s > S1 ? (S1 + TAPER - s) / TAPER : 1;
  const half = frameAt(s).half + 1.5;
  const wl = Math.abs(lat) <= half ? 1 : Math.max(0, 1 - (Math.abs(lat) - half) / EDGE_FADE);
  const w = Math.max(0, Math.min(1, ws)) * wl;
  if (w <= 0) return null;
  const q = at(smooth, s);
  const latC = Math.max(-half, Math.min(half, lat));
  const target = q[0] + q[1] * latC + q[2] * latC * latC;
  // a surface of another level of the circuit passing near (a road above or below): not this one
  if (Math.abs(y - target) > 1.0) return null;
  const raw = roadTop(x, z, y);
  let want;
  if (raw !== null && Math.abs(y - raw) <= 0.6) {
    // on the road (asphalt, kerb, paint over it): onto the new surface, keeping a thin layer
    // paint (lines, decals) always just above the asphalt, never under it
    want = target + Math.max(paint ? PAINT_MIN : LAYER_MIN, Math.min(LAYER_MAX, y - raw));
  } else {
    // off it (a verge, a bank, gravel): moved as much as the road's edge beside it moved
    const f = frameAt(s);
    const ex = f.x + f.nx * latC;
    const ez = f.z + f.nz * latC;
    const edgeRaw = roadTop(ex, ez, target);
    if (edgeRaw === null) return null;
    want = y + (target - edgeRaw);
  }
  // never more than MAX_MOVE: a vertex left behind while its neighbours move would make a spike
  want = y + Math.max(-MAX_MOVE, Math.min(MAX_MOVE, want - y));
  return y + (want - y) * w;
}

// ------------------------------------------------------------------ apply
let movedC = 0;
let maxC = 0;
const hist = [0, 0, 0, 0, 0];
const bucket = (d) => hist[d < 0.02 ? 0 : d < 0.05 ? 1 : d < 0.1 ? 2 : d < 0.2 ? 3 : 4]++;
for (const p of col.parts) {
  if (SURFACES[p.si] === 'wall') continue;
  for (let i = 0; i < p.pos.length; i += 3) {
    const y = corrected(p.pos[i], p.pos[i + 1], p.pos[i + 2]);
    if (y === null) continue;
    maxC = Math.max(maxC, Math.abs(y - p.pos[i + 1]));
    bucket(Math.abs(y - p.pos[i + 1]));
    if (opts.report && Math.abs(y - p.pos[i + 1]) > 0.2 && (globalThis.__rep = (globalThis.__rep ?? 0) + 1) <= 25) {
      const L = locate(p.pos[i], p.pos[i + 2]);
      console.log(`big move ${SURFACES[p.si]} s=${L.s.toFixed(1)} lat=${L.lat.toFixed(2)} y=${p.pos[i + 1].toFixed(2)} -> ${y.toFixed(2)} raw=${roadTop(p.pos[i], p.pos[i + 2], p.pos[i + 1])?.toFixed(2)}`);
    }
    // the collision moves after every height has been read (raw surface from the original)
    p.next ??= new Map();
    p.next.set(i + 1, y);
    movedC++;
  }
}
for (const p of col.parts) if (p.next) for (const [k, y] of p.next) p.pos[k] = y;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const glbs = (opts.glb ?? '').split(',').filter(Boolean);
const results = [];
for (const file of glbs) {
  const doc = await io.read(file);
  await doc.transform(dequantize());
  let moved = 0;
  let maxM = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    // world <- local: affine; local y from a new world y keeping x and z
    for (const prim of mesh.listPrimitives()) {
      if (!SURF_MAT.test(prim.getMaterial()?.getName() ?? '')) continue;
      const pos = prim.getAttribute('POSITION');
      // a primitive's attribute may be shared by other primitives: edit each once
      if (pos.__done) continue;
      pos.__done = true;
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        const x = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
        const y = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
        const z = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
        const ny = corrected(x, y, z, PAINT_MAT.test(prim.getMaterial()?.getName() ?? ''));
        if (ny === null) continue;
        // only the world y changes: local += dy * (inverse world's column for y); for these nodes (no rotation)
        // that is dy / m[5] on local y
        const dy = ny - y;
        if (Math.abs(m[4]) > 1e-6 || Math.abs(m[6]) > 1e-6 || Math.abs(m[1]) > 1e-6) continue;
        el[1] += dy / m[5];
        pos.setElement(i, el);
        moved++;
        maxM = Math.max(maxM, Math.abs(dy));
      }
    }
  }
  // as optimize.mjs finishFloat: float positions (no quantisation steps), meshopt-compressed
  await doc.transform(prune(), reorder({ encoder: MeshoptEncoder }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(file, doc);
  results.push(`${file}: ${moved} vertices moved (up to ${(maxM * 100).toFixed(1)} cm)`);
}
writeApxc(opts.apxc, col);
console.log(`${opts.apxc}: ${movedC} collision vertices moved (up to ${(maxC * 100).toFixed(1)} cm; <2 / <5 / <10 / <20 / more cm: ${hist.join(' / ')})`);
for (const r of results) console.log(r);
