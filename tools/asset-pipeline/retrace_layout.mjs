#!/usr/bin/env node
/**
 * Re-route the stretches of a layout's centreline that leave the asphalt, along the road.
 *
 * The short Nürburgring layout is the GP lap with a link road spliced in (track_analysis.py, build_layout): where the
 * link meets the GP road the splice cut straight across a sand trap instead of following the road round the hairpin,
 * and the bots (and the racing line, the track-limit check, resets) drove that diagonal onto the sand and into the wall.
 *
 * Here: find runs of centreline points with no asphalt or kerb within 1.5 m, widen each run by `--pad` m, and replace it
 * with the cheapest path over the road (asphalt + kerb on the collision mesh, 0.5 m cells) between its ends, a path
 * that keeps to the middle of the road (cost rises near its edges); smooth it, resample every 5 m, then recompute what
 * hangs on the centreline: lap distances, widths, gates, sectors, the first timed gate, the pit lane's entry/exit
 * distances and the minimum lap time. Writes the intermediate track_base_<id>.json back; then
 *
 *   node tools/asset-pipeline/optimize.mjs --map nurburgring --only tracks
 *
 * turns it into the game's layout JSON (heights, track limits, the server's validation data).
 *
 *   node tools/asset-pipeline/retrace_layout.mjs --layout nurburgring_short [--base out/map/track_base_<id>.json]
 *       [--pad 15] [--from <m>] [--to <m>] [--dry]
 *
 * A route that turns back on itself (more than 100° between two 5 m steps: the ends lay past a junction) is refused.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTrack } from '../sim/trackfile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const ID = opt('layout', 'nurburgring_short');
const BASE = path.resolve(here, opt('base', `out/map/track_base_${ID}.json`));
const PAD = Number(opt('pad', '15'));
const DRY = args.includes('--dry');
/** Only runs within this stretch of the lap (m). */
const FROM_S = Number(opt('from', '0'));
const TO_S = Number(opt('to', '1e9'));
const GATE_SPACING_M = 35;
const RUNOFF_MARGIN_M = 14;
const STEP_M = 5;
const R = 0.5;

const base = JSON.parse(readFileSync(BASE, 'utf8'));
const { collision: buf } = loadTrack(ID);
let cl = base.centerline;
let n = cl.length / 3;

/* --------------------------------------------------------- road raster --- */
let x0 = Infinity;
let x1 = -Infinity;
let z0 = Infinity;
let z1 = -Infinity;
for (let i = 0; i < n; i++) {
  x0 = Math.min(x0, cl[i * 3]);
  x1 = Math.max(x1, cl[i * 3]);
  z0 = Math.min(z0, cl[i * 3 + 2]);
  z1 = Math.max(z1, cl[i * 3 + 2]);
}
x0 -= 80;
x1 += 80;
z0 -= 80;
z1 += 80;
const W = Math.ceil((x1 - x0) / R);
const H = Math.ceil((z1 - z0) / R);
const road = new Uint8Array(W * H);
const height = new Float32Array(W * H).fill(-1e9);
{
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 12;
  for (let b = 0; b < dv.getUint32(8, true); b++) {
    const si = dv.getUint32(o, true);
    const nv = dv.getUint32(o + 4, true);
    const ni = dv.getUint32(o + 8, true);
    o += 12;
    const P = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
    o += nv * 12;
    const I = new Uint32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + ni * 4));
    o += ni * 4;
    if (si > 1) continue; // asphalt, kerb
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]].map((k) => [(P[k * 3] - x0) / R, P[k * 3 + 1], (P[k * 3 + 2] - z0) / R]);
      const xa = Math.max(0, Math.floor(Math.min(v[0][0], v[1][0], v[2][0])));
      const xb = Math.min(W - 1, Math.ceil(Math.max(v[0][0], v[1][0], v[2][0])));
      const za = Math.max(0, Math.floor(Math.min(v[0][2], v[1][2], v[2][2])));
      const zb = Math.min(H - 1, Math.ceil(Math.max(v[0][2], v[1][2], v[2][2])));
      if (xa > xb || za > zb) continue;
      const [a, bb, c] = v;
      const d = (bb[2] - c[2]) * (a[0] - c[0]) + (c[0] - bb[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-9) continue;
      for (let z = za; z <= zb; z++)
        for (let x = xa; x <= xb; x++) {
          const px = x + 0.5;
          const pz = z + 0.5;
          const l1 = ((bb[2] - c[2]) * (px - c[0]) + (c[0] - bb[0]) * (pz - c[2])) / d;
          const l2 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / d;
          if (l1 < 0 || l2 < 0 || 1 - l1 - l2 < 0) continue;
          const k = z * W + x;
          road[k] = 1;
          height[k] = Math.max(height[k], l1 * a[1] + l2 * bb[1] + (1 - l1 - l2) * c[1]);
        }
    }
  }
}
const cell = (x, z) => [Math.floor((x - x0) / R), Math.floor((z - z0) / R)];
const onRoad = (x, z, rad = 1.5) => {
  const [cx, cz] = cell(x, z);
  const r = Math.ceil(rad / R);
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      const X = cx + dx;
      const Z = cz + dz;
      if (X >= 0 && X < W && Z >= 0 && Z < H && road[Z * W + X]) return true;
    }
  return false;
};

/* distance to the road's edge (cells), two-pass chamfer */
const edge = new Float32Array(W * H);
for (let k = 0; k < W * H; k++) edge[k] = road[k] ? 1e9 : 0;
for (let z = 0; z < H; z++)
  for (let x = 0; x < W; x++) {
    const k = z * W + x;
    if (!edge[k]) continue;
    if (x > 0) edge[k] = Math.min(edge[k], edge[k - 1] + 1);
    if (z > 0) edge[k] = Math.min(edge[k], edge[k - W] + 1);
    if (x > 0 && z > 0) edge[k] = Math.min(edge[k], edge[k - W - 1] + 1.414);
    if (x < W - 1 && z > 0) edge[k] = Math.min(edge[k], edge[k - W + 1] + 1.414);
  }
for (let z = H - 1; z >= 0; z--)
  for (let x = W - 1; x >= 0; x--) {
    const k = z * W + x;
    if (!edge[k]) continue;
    if (x < W - 1) edge[k] = Math.min(edge[k], edge[k + 1] + 1);
    if (z < H - 1) edge[k] = Math.min(edge[k], edge[k + W] + 1);
    if (x < W - 1 && z < H - 1) edge[k] = Math.min(edge[k], edge[k + W + 1] + 1.414);
    if (x > 0 && z < H - 1) edge[k] = Math.min(edge[k], edge[k + W - 1] + 1.414);
  }

/* ------------------------------------------------------- off-road runs --- */
const cumOf = (c) => {
  const m = c.length / 3;
  const s = new Float64Array(m);
  for (let i = 1; i < m; i++) s[i] = s[i - 1] + Math.hypot(c[i * 3] - c[(i - 1) * 3], c[i * 3 + 2] - c[(i - 1) * 3 + 2]);
  return s;
};
let cum = cumOf(cl);
const runs = [];
for (let i = 0; i < n; i++) {
  if (onRoad(cl[i * 3], cl[i * 3 + 2])) continue;
  let j = i;
  while (j + 1 < n && !onRoad(cl[(j + 1) * 3], cl[(j + 1) * 3 + 2])) j++;
  if (cum[i] >= FROM_S && cum[j] <= TO_S) runs.push([i, j]);
  i = j;
}
console.log(`${ID}: ${n} points, ${runs.length} off-road run(s): ${runs.map(([a, b]) => `${cum[a].toFixed(0)}–${cum[b].toFixed(0)} m`).join(', ') || 'none'}`);
if (!runs.length) process.exit(0);

/* ----------------------------------------------------------------- A* --- */
function route(ax, az, bx, bz) {
  const [sx, sz] = cell(ax, az);
  const [tx, tz] = cell(bx, bz);
  const start = sz * W + sx;
  const goal = tz * W + tx;
  const g = new Map([[start, 0]]);
  const from = new Map();
  // binary heap of [f, k]
  const heap = [[0, start]];
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const NB = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ];
  let guard = 0;
  while (heap.length && guard++ < 6e6) {
    const [, k] = pop();
    if (k === goal) break;
    const x = k % W;
    const z = (k - x) / W;
    const gk = g.get(k);
    for (const [dx, dz, len] of NB) {
      const X = x + dx;
      const Z = z + dz;
      if (X < 0 || X >= W || Z < 0 || Z >= H) continue;
      const nk = Z * W + X;
      if (!road[nk] && nk !== goal) continue;
      // keep to the middle: near the edge a step costs up to 9×
      const cost = len * (1 + 8 * Math.exp(-edge[nk] / 4));
      const ng = gk + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        from.set(nk, k);
        push([ng + Math.hypot(X - tx, Z - tz), nk]);
      }
    }
  }
  if (!from.has(goal)) return null;
  const pts = [];
  for (let k = goal; k !== undefined; k = from.get(k)) pts.push([(k % W) * R + x0 + R / 2, Math.floor(k / W) * R + z0 + R / 2]);
  return pts.reverse();
}

/* ------------------------------------------------------- splice each run --- */
const xyz = [];
for (let i = 0; i < n; i++) xyz.push([cl[i * 3], cl[i * 3 + 1], cl[i * 3 + 2]]);
let out = xyz;
// last run first, so earlier indices stay valid
for (const [ra, rb] of runs.slice().reverse()) {
  let a = ra;
  let b = rb;
  while (a > 0 && cum[ra] - cum[a] < PAD) a--;
  while (b < n - 1 && cum[b] - cum[rb] < PAD) b++;
  const path_ = route(out[a][0], out[a][2], out[b][0], out[b][2]);
  if (!path_) {
    console.log(`  ${cum[ra].toFixed(0)}–${cum[rb].toFixed(0)} m: no road path between ${cum[a].toFixed(0)} and ${cum[b].toFixed(0)} m, left as it is`);
    continue;
  }
  // smooth (moving average over ±6 cells, 4 passes; ends pinned to the old line)
  let p = path_;
  for (let pass = 0; pass < 4; pass++) {
    const q = p.map((v) => v.slice());
    for (let i = 1; i < p.length - 1; i++) {
      let sx = 0;
      let sz = 0;
      let c = 0;
      for (let k = Math.max(0, i - 6); k <= Math.min(p.length - 1, i + 6); k++) {
        sx += p[k][0];
        sz += p[k][1];
        c++;
      }
      q[i] = [sx / c, sz / c];
    }
    p = q;
  }
  // resample every STEP_M
  const res = [];
  let acc = 0;
  res.push(p[0]);
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    acc += d;
    if (acc >= STEP_M) {
      res.push(p[i]);
      acc = 0;
    }
  }
  const mid = res.slice(1, -1).map(([x, z]) => {
    const [cx, cz] = cell(x, z);
    const h = height[cz * W + cx];
    return [x, h > -1e8 ? h : out[a][1], z];
  });
  // the route may run past a junction to the old line's anchor and come back up it: cut such loops (a later point
  // within 6 m of an earlier one, more than 3 steps on)
  let joined = [...out.slice(Math.max(0, a - 20), a + 1), ...mid, ...out.slice(b, Math.min(out.length, b + 40))];
  const before = joined.length;
  for (let i = 0; i < joined.length; i++)
    for (let j = joined.length - 1; j > i + 3; j--)
      if (Math.hypot(joined[j][0] - joined[i][0], joined[j][2] - joined[i][2]) < 6) {
        joined = [...joined.slice(0, i + 1), ...joined.slice(j + 1)];
        break;
      }
  const lo = Math.max(0, a - 20);
  const hi = Math.min(out.length, b + 40);
  if (joined.length !== before) console.log(`  a loop of ${before - joined.length} points cut where the route met the old line`);
  // refuse a route that still doubles back (its ends were past a junction), joins included
  const chain = joined;
  let reversed = false;
  for (let k = 1; k + 1 < chain.length; k++) {
    const h1 = Math.atan2(chain[k][0] - chain[k - 1][0], chain[k][2] - chain[k - 1][2]);
    const h2 = Math.atan2(chain[k + 1][0] - chain[k][0], chain[k + 1][2] - chain[k][2]);
    if (Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) > (100 * Math.PI) / 180) reversed = true;
  }
  if (reversed) {
    console.log(`  ${cum[ra].toFixed(0)}–${cum[rb].toFixed(0)} m: the road route turns back on itself, left as it is`);
    continue;
  }
  const oldLen = cum[b] - cum[a];
  out = [...out.slice(0, lo), ...joined, ...out.slice(hi)];
  console.log(
    `  ${cum[ra].toFixed(0)}–${cum[rb].toFixed(0)} m re-routed: ${cum[a].toFixed(0)}–${cum[b].toFixed(0)} m (${oldLen.toFixed(0)} m), ${hi - lo} points → ${joined.length}`,
  );
}

/* ------------------------------------------------- everything downstream --- */
n = out.length;
cl = out.flat();
// closing segment included: cumS[i] is the distance from point 0; length closes the loop
const seg = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const j = (i + 1) % n;
  seg[i] = Math.hypot(out[j][0] - out[i][0], out[j][2] - out[i][2]);
}
cum = new Float64Array(n);
for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + seg[i - 1];
const length = cum[n - 1] + seg[n - 1];
const tan = (i) => {
  const a = out[(i - 2 + n) % n];
  const b = out[(i + 2) % n];
  const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  return [(b[0] - a[0]) / l, 0, (b[2] - a[2]) / l];
};
// widths: keep the old ones where the point is unchanged, measure across the road raster for new points
const oldKey = new Map();
for (let i = 0; i < base.centerline.length / 3; i++) oldKey.set(`${base.centerline[i * 3].toFixed(3)},${base.centerline[i * 3 + 2].toFixed(3)}`, i);
const widthL = [];
const widthR = [];
for (let i = 0; i < n; i++) {
  const k = oldKey.get(`${out[i][0].toFixed(3)},${out[i][2].toFixed(3)}`);
  if (k !== undefined) {
    widthL.push(base.widthL[k]);
    widthR.push(base.widthR[k]);
    continue;
  }
  const t = tan(i);
  const nx = t[2];
  const nz = -t[0]; // left
  const scan = (sgn) => {
    let d = 0;
    while (d < 25) {
      const [cx, cz] = cell(out[i][0] + nx * (d + R) * sgn, out[i][2] + nz * (d + R) * sgn);
      if (cx < 0 || cx >= W || cz < 0 || cz >= H || !road[cz * W + cx]) break;
      d += R;
    }
    return Math.max(2.5, d);
  };
  widthL.push(+scan(1).toFixed(2));
  widthR.push(+scan(-1).toFixed(2));
}
const gates = [];
const ng = Math.round(length / GATE_SPACING_M);
for (let g = 0; g < ng; g++) {
  const sg = (g * length) / ng;
  let i = 0;
  while (i + 1 < n && cum[i + 1] <= sg) i++;
  const t = tan(i);
  gates.push({
    s: cum[i],
    p: out[i].map((v) => +v.toFixed(3)),
    d: [+t[0].toFixed(5), 0, +t[2].toFixed(5)],
    hw: +(Math.max(widthL[i], widthR[i]) + RUNOFF_MARGIN_M).toFixed(2),
  });
}
const nearS = (p) => {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = (out[i][0] - p[0]) ** 2 + (out[i][2] - p[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return cum[best];
};
const pole = base.grid?.[0]?.p ?? base.grid?.[0]?.position ?? null;
const poleS = pole ? nearS(pole) : base.gates[Math.max(0, base.firstGate - 1)].s;
// the pole sits just behind the line: its lap distance is near the end of the lap
const firstGate = Math.max(
  0,
  gates.findIndex((g) => g.s > (poleS > length / 2 ? 0 : poleS) + 5),
);
const result = {
  ...base,
  length: +length.toFixed(2),
  centerline: cl.map((v) => +v.toFixed(3)),
  cumS: Array.from(cum, (v) => +v.toFixed(3)),
  widthL,
  widthR,
  gates,
  sectorGates: [Math.round(ng / 3), Math.round((2 * ng) / 3)],
  firstGate,
  minLapMs: Math.floor((length / 75) * 1000),
  pitLane: base.pitLane
    ? { ...base.pitLane, entryS: +nearS(base.pitLane.points[0]).toFixed(1), exitS: +nearS(base.pitLane.points[base.pitLane.points.length - 1]).toFixed(1) }
    : null,
};
console.log(
  `  length ${base.length} → ${result.length} m, gates ${base.gates.length} → ${gates.length}, first gate ${base.firstGate} → ${firstGate}, pit entry/exit ${base.pitLane?.entryS}/${base.pitLane?.exitS} → ${result.pitLane?.entryS}/${result.pitLane?.exitS}`,
);
if (!DRY) {
  writeFileSync(BASE, JSON.stringify(result));
  console.log(`  wrote ${path.relative(process.cwd(), BASE)}`);
}
