/**
 * Ground flatness probe on the collision mesh (what the wheel rays ride on), no physics.
 *
 * Samples every ground surface under a dense lattice along the lap: lanes every 0.5 m across the road (plus a
 * margin), points every 0.25 m along it. Per stretch it reports
 *   - bump: the largest deviation of the top surface from a 3 m moving straight line (what a wheel feels);
 *   - steps: jumps over 1 cm between neighbouring samples once the slope is removed;
 *   - stacked: samples where a second ground surface lies within 15 cm under the top one (overlapping meshes,
 *     the hole fill just under the road, duplicated layers: z-fighting in the render, a step when the top one ends);
 *   - which surfaces win.
 *
 *   pnpm tsx tools/sim/flatness.ts [--from 0] [--to 5202] [--seg 50] [--margin 4] [--track file] [--collision file]
 *       [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Surface, TrackData } from '../../packages/shared/src/index.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const pub = 'apps/client/public/assets';
const track = JSON.parse(readFileSync(opt('track', `${pub}/track.json`), 'utf8')) as TrackData;
const from = Number(opt('from', '0'));
const to = Number(opt('to', String(track.length)));
const SEG = Number(opt('seg', '50'));
const MARGIN = Number(opt('margin', '4'));
const DS = 0.25;
const DL = 0.5;

/* ---------------------------------------------------------- collision --- */
interface Part {
  surface: Surface;
  pos: Float32Array;
  idx: Uint32Array;
}
const parts: Part[] = [];
{
  const raw = readFileSync(opt('collision', `${pub}/track/collision.apxc`));
  const buf = raw[0] === 0x1f ? gunzipSync(raw) : raw;
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
    parts.push({ surface: track.collision.surfaces[si], pos, idx });
  }
}

/** 2D hash of every non-wall triangle that faces up enough to be driven on (or is a curb side). */
const CELL = 4;
// only the area around the scanned stretch
const bb = [Infinity, Infinity, -Infinity, -Infinity];
for (let i = 0; i < track.cumS.length; i++) {
  const si = track.cumS[i];
  const inside = to - from >= track.length - 1 || (si >= from - 60 && si <= to + 60) || si >= track.length + from - 60 || si <= to + 60 - track.length;
  if (!inside) continue;
  const x = track.centerline[i * 3];
  const z = track.centerline[i * 3 + 2];
  bb[0] = Math.min(bb[0], x - 60);
  bb[1] = Math.min(bb[1], z - 60);
  bb[2] = Math.max(bb[2], x + 60);
  bb[3] = Math.max(bb[3], z + 60);
}
const bx0 = Math.floor(bb[0] / CELL);
const bz0 = Math.floor(bb[1] / CELL);
const bx1 = Math.floor(bb[2] / CELL);
const bz1 = Math.floor(bb[3] / CELL);
const tris: { a: number[]; b: number[]; c: number[]; surface: Surface; part: number }[] = [];
const hash = new Map<number, number[]>();
const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);
parts.forEach((p, pi) => {
  if (p.surface === 'wall') return;
  for (let t = 0; t < p.idx.length; t += 3) {
    const v = [p.idx[t], p.idx[t + 1], p.idx[t + 2]].map((i) => [p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]]);
    const ti = tris.length;
    const x0 = Math.max(bx0, Math.floor(Math.min(v[0][0], v[1][0], v[2][0]) / CELL));
    const x1 = Math.min(bx1, Math.floor(Math.max(v[0][0], v[1][0], v[2][0]) / CELL));
    const z0 = Math.max(bz0, Math.floor(Math.min(v[0][2], v[1][2], v[2][2]) / CELL));
    const z1 = Math.min(bz1, Math.floor(Math.max(v[0][2], v[1][2], v[2][2]) / CELL));
    if (x0 > x1 || z0 > z1) continue;
    tris.push({ a: v[0], b: v[1], c: v[2], surface: p.surface, part: pi });
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let l = hash.get(k);
        if (!l) hash.set(k, (l = []));
        l.push(ti);
      }
  }
});

/** Every ground height under (x, z), highest first. */
function heights(x: number, z: number, out: { y: number; s: Surface; part: number }[]): number {
  out.length = 0;
  const l = hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!l) return 0;
  for (const ti of l) {
    const { a, b, c } = tris[ti];
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) continue;
    const w0 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const w1 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    out.push({ y: w0 * a[1] + w1 * b[1] + w2 * c[1], s: tris[ti].surface, part: tris[ti].part });
  }
  out.sort((p, q) => q.y - p.y);
  return out.length;
}

/* --------------------------------------------------------------- scan --- */
const cl = track.centerline;
const n = cl.length / 3;
const cum = track.cumS;
function frameAt(s: number) {
  let i = 0;
  while (i < n - 1 && cum[i + 1] <= s) i++;
  const j = (i + 1) % n;
  const segLen = (j === 0 ? track.length : cum[j]) - cum[i];
  const f = segLen > 0 ? (s - cum[i]) / segLen : 0;
  const x = cl[i * 3] + (cl[j * 3] - cl[i * 3]) * f;
  const y = cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * f;
  const z = cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * f;
  let tx = cl[j * 3] - cl[i * 3];
  let tz = cl[j * 3 + 2] - cl[i * 3 + 2];
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  return { x, y, z, tx, tz, wl: track.widthL[i], wr: track.widthR[i] };
}

interface Seg {
  s0: number;
  bump: number;
  bumpAt: string;
  steps: number;
  maxStep: number;
  stacked: number;
  stackedRoad: number;
  samples: number;
  miss: number;
  surf: Record<string, number>;
}
// --profile s0,s1,lat: every ground layer along one lane, every 5 cm
const prof = opt('profile', '');
if (prof) {
  const [p0, p1, plat] = prof.split(',').map(Number);
  const hs2: { y: number; s: Surface; part: number }[] = [];
  for (let s = p0; s <= p1; s += 0.05) {
    const f = frameAt(s);
    heights(f.x + f.tz * plat, f.z - f.tx * plat, hs2);
    const layers = hs2.filter((h) => h.y < f.y + 1.5 && h.y > f.y - 4).map((h) => `${h.y.toFixed(3)} ${h.s}`);
    console.log(s.toFixed(2), layers.join(' | '));
  }
  process.exit(0);
}
// --xprofile s,lat0,lat1: every ground layer across the road, every 5 cm
const xprof = opt('xprofile', '');
if (xprof) {
  const [ps, l0, l1] = xprof.split(',').map(Number);
  const hs2: { y: number; s: Surface; part: number }[] = [];
  const f = frameAt(ps);
  for (let lat = l0; lat <= l1; lat += 0.05) {
    heights(f.x + f.tz * lat, f.z - f.tx * lat, hs2);
    const layers = hs2.filter((h) => h.y < f.y + 1.5 && h.y > f.y - 4).map((h) => `${h.y.toFixed(3)} ${h.s}`);
    console.log(lat.toFixed(2), layers.join(' | '));
  }
  process.exit(0);
}
const segs: Seg[] = [];
const pairs: Record<string, number> = {};
const BIG = Number(opt('big', '1'));
const big: string[] = [];
const hs: { y: number; s: Surface; part: number }[] = [];
const WIN = Math.round(1.5 / DS); // ±1.5 m window
for (let s0 = from; s0 < to; s0 += SEG) {
  const seg: Seg = { s0, bump: 0, bumpAt: '', steps: 0, maxStep: 0, stacked: 0, stackedRoad: 0, samples: 0, miss: 0, surf: {} };
  const mid = frameAt(s0 + SEG / 2);
  const wl = mid.wl + MARGIN;
  const wr = mid.wr + MARGIN;
  for (let lat = -wr; lat <= wl; lat += DL) {
    const ys: number[] = [];
    const ss: (Surface | null)[] = [];
    for (let s = s0 - 1.5; s <= s0 + SEG + 1.5; s += DS) {
      const f = frameAt(((s % track.length) + track.length) % track.length);
      // left of the race direction is (tz, -tx)
      const x = f.x + f.tz * lat;
      const z = f.z - f.tx * lat;
      heights(x, z, hs);
      // the ground a wheel ray from 1.5 m above the line would hit
      const top = hs.find((h) => h.y < f.y + 1.5 && h.y > f.y - 4);
      ys.push(top ? top.y : NaN);
      ss.push(top ? top.s : null);
      if (top && s >= s0 && s < s0 + SEG) {
        seg.samples++;
        seg.surf[top.s] = (seg.surf[top.s] ?? 0) + 1;
        const under = hs.find((h) => h !== top && h.y < top.y && h.y > top.y - 0.15);
        if (under && top.y - under.y > 0.002) {
          seg.stacked++;
          const pk = `${top.s}>${under.s} ${top.y - under.y < 0.02 ? '<2cm' : top.y - under.y < 0.05 ? '2-5cm' : top.y - under.y < 0.1 ? '5-10cm' : '10-15cm'}`;
          pairs[pk] = (pairs[pk] ?? 0) + 1;
          if (top.s === 'asphalt' || top.s === 'curb' || under.s === 'asphalt' || under.s === 'curb') seg.stackedRoad++;
        }
      } else if (!top && s >= s0 && s < s0 + SEG) seg.miss++;
    }
    for (let k = WIN; k < ys.length - WIN; k++) {
      const sk = s0 - 1.5 + k * DS;
      if (sk < s0 || sk >= s0 + SEG) continue;
      // least-squares line through the ±1.5 m window, deviation of the centre sample
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      let m = 0;
      for (let q = -WIN; q <= WIN; q++) {
        const y = ys[k + q];
        if (!Number.isFinite(y)) continue;
        sx += q;
        sy += y;
        sxx += q * q;
        sxy += q * y;
        m++;
      }
      if (m < WIN || !Number.isFinite(ys[k])) continue;
      const b = (m * sxy - sx * sy) / (m * sxx - sx * sx);
      const a = (sy - b * sx) / m;
      const dev = Math.abs(ys[k] - a);
      // only judge what a car drives on (and the grass right beside it)
      if (dev > seg.bump) {
        seg.bump = dev;
        seg.bumpAt = `s ${sk.toFixed(1)} lat ${lat.toFixed(1)} ${ss[k]}`;
      }
      const step = Math.abs(ys[k + 1] - ys[k] - b);
      if (Number.isFinite(step) && step > 0.01) {
        seg.steps++;
        seg.maxStep = Math.max(seg.maxStep, step);
        if (step > BIG) big.push(`s ${sk.toFixed(1)} lat ${lat.toFixed(1)} ${(step * 100).toFixed(1)} cm ${ss[k]}→${ss[k + 1]}`);
      }
    }
  }
  segs.push(seg);
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '0.0');
console.log('   s    bump(cm) where                                 steps>1cm  maxStep  stacked%  stackedRoad%  miss  surfaces');
for (const g of segs) {
  const surf = Object.entries(g.surf)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v, g.samples)}%`)
    .join(' ');
  console.log(
    `${String(g.s0).padStart(5)}  ${(g.bump * 100).toFixed(1).padStart(6)}   ${g.bumpAt.padEnd(38)} ${String(g.steps).padStart(6)}  ${(g.maxStep * 100).toFixed(1).padStart(6)}  ${pct(g.stacked, g.samples).padStart(7)}  ${pct(g.stackedRoad, g.samples).padStart(10)}  ${String(g.miss).padStart(5)}  ${surf}`,
  );
}
const tot = segs.reduce(
  (a, g) => ({ steps: a.steps + g.steps, stacked: a.stacked + g.stacked, samples: a.samples + g.samples, road: a.road + g.stackedRoad, miss: a.miss + g.miss }),
  { steps: 0, stacked: 0, samples: 0, road: 0, miss: 0 },
);
const bumps = segs.map((g) => g.bump).sort((a, b) => a - b);
const bumpsOver = (cm: number) => segs.filter((g) => g.bump > cm / 100).length;
console.log(
  `total: ${tot.samples} samples, ${tot.miss} without ground, steps>1cm ${tot.steps}, stacked ${pct(tot.stacked, tot.samples)}% (road ${pct(tot.road, tot.samples)}%), ` +
    `bump median ${(bumps[bumps.length >> 1] * 100).toFixed(1)} cm, max ${(bumps[bumps.length - 1] * 100).toFixed(1)} cm, stretches with a bump over 3 cm: ${bumpsOver(3)} of ${segs.length}`,
);
console.log(
  'stacked layers (top>under, gap):',
  Object.entries(pairs)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(', '),
);
if (big.length) console.log(`steps over ${BIG * 100} cm:\n` + big.join('\n'));
const jsonOut = opt('json', '');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(segs, null, 1));
