import { nearestCenterlineIndex, type TrackData } from '@apex/shared';
import type { GroundHit } from '../physics/vehicle';

/** Ground height under (x, z) from yTop down at most maxD (null: no ground, or a wall). */
export type GroundDown = (x: number, yTop: number, z: number, maxD: number) => number | null;

interface Patch {
  x: Float32Array;
  z: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
  h: Float32Array;
  slope: Float32Array;
  /** How far from the plane (m) a hit may be and still be put on it. */
  tol: number;
}

/**
 * Smoothed driving surfaces over stretches where the map's collision is rough:
 *  - the pit lane: 5–9 cm bumps and steps of up to 10 cm (box decals, mesh seams, the kerbs at the entry;
 *    tools/sim/pitflat.mjs), and cars bounced all the way down the lane;
 *  - stretches of a layout listed in its `smoothRoad` ([fromS, toS] pairs): on the 24h layout the lap leaves and
 *    rejoins the GP circuit over overlapping road meshes with steps of 0.7–1 m (tools/sim/flatness.ts), which launched
 *    the cars into spins.
 * Per metre along the path: the height at its centre and the cross slope (medians of the ground across it), smoothed
 * along it; wheel rays that land within the corridor, close enough to that plane, ride the plane instead.
 * Shared by the game (track.ts) and the headless bot check (tools/sim/ailap.ts).
 */
export class RoadPatches {
  private patches: Patch[] = [];
  /** Corridor cells (1 m) → patch index × 1e6 + station. */
  private cells = new Map<number, number>();

  static build(td: TrackData, ground: GroundDown): RoadPatches {
    const r = new RoadPatches();
    const lane = td.pitLane;
    if (lane && lane.points.length >= 4) r.add(td, ground, lane.points as [number, number, number][], 9, 4, 0.15, true);
    const cl = td.centerline;
    const n = cl.length / 3;
    for (const [from, to] of td.smoothRoad ?? []) {
      const pts: [number, number, number][] = [];
      for (let i = 0; i < n; i++) if (td.cumS[i] >= from - 15 && td.cumS[i] <= to + 15) pts.push([cl[i * 3], cl[i * 3 + 1], cl[i * 3 + 2]]);
      if (pts.length >= 4) r.add(td, ground, pts, 7, 8, 1.1, false);
    }
    return r;
  }

  private add(td: TrackData, ground: GroundDown, pts: [number, number, number][], HALF: number, smoothM: number, tol: number, offCircuit: boolean): void {
    // resample the path every metre
    const px: number[] = [];
    const py: number[] = [];
    const pz: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
      for (let d = 0; d < l; d += 1) {
        const f = d / l;
        px.push(a[0] + (b[0] - a[0]) * f);
        py.push(a[1] + (b[1] - a[1]) * f);
        pz.push(a[2] + (b[2] - a[2]) * f);
      }
    }
    const n = px.length;
    if (n < 4) return;
    const tx = new Float32Array(n);
    const tz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2);
      const b = Math.min(n - 1, i + 2);
      const l = Math.hypot(px[b] - px[a], pz[b] - pz[a]) || 1;
      tx[i] = (px[b] - px[a]) / l;
      tz[i] = (pz[b] - pz[a]) / l;
    }
    const median = (v: number[]) => {
      v.sort((p, q) => p - q);
      return v[v.length >> 1];
    };
    const h0 = new Float32Array(n);
    const s0 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const nx = tz[i];
      const nz = -tx[i];
      const left: number[] = [];
      const mid: number[] = [];
      const right: number[] = [];
      for (let lat = -HALF; lat <= HALF; lat += 0.5) {
        const y = ground(px[i] + nx * lat, py[i] + 2, pz[i] + nz * lat, 4);
        if (y === null) continue;
        (lat < -1.5 ? right : lat > 1.5 ? left : mid).push(y);
      }
      h0[i] = mid.length ? median(mid) : py[i];
      s0[i] = left.length > 2 && right.length > 2 ? (median(left) - median(right)) / (HALF + 1.5) : 0;
    }
    const h = new Float32Array(n);
    const slope = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sh = 0;
      let c = 0;
      for (let k = Math.max(0, i - smoothM); k <= Math.min(n - 1, i + smoothM); k++) {
        sh += h0[k];
        c++;
      }
      h[i] = sh / c;
      // the cross slope over three times as long: where it changed quickly (the box area begins), the far side of
      // the lane stepped
      let ss = 0;
      let cs = 0;
      for (let k = Math.max(0, i - smoothM * 3); k <= Math.min(n - 1, i + smoothM * 3); k++) {
        ss += s0[k];
        cs++;
      }
      // drainage cross-falls and road camber are a few degrees: anything steeper is a kerb or a step
      slope[i] = Math.max(-0.06, Math.min(0.06, ss / cs));
    }
    const pi = this.patches.length;
    let hint = -1;
    const cl = td.centerline;
    const m = cl.length / 3;
    for (let i = 0; i < n; i++) {
      if (offCircuit) hint = nearestCenterlineIndex(td, px[i], py[i], pz[i], hint);
      for (let lat = -HALF; lat <= HALF; lat += 0.5) {
        const x = px[i] + tz[i] * lat;
        const z = pz[i] - tx[i] * lat;
        const k = Math.floor(x) * 100003 + Math.floor(z);
        if (this.cells.has(k)) continue;
        if (offCircuit) {
          // the pit lane's corridor stops short of the circuit's own surface
          const j = nearestCenterlineIndex(td, x, py[i], z, hint, 30);
          const jx = cl[((j + 1) % m) * 3] - cl[j * 3];
          const jz = cl[((j + 1) % m) * 3 + 2] - cl[j * 3 + 2];
          const jl = Math.hypot(jx, jz) || 1;
          const side = ((x - cl[j * 3]) * jz - (z - cl[j * 3 + 2]) * jx) / jl;
          if (Math.abs(side) < (side >= 0 ? td.widthL[j] : td.widthR[j]) + 1.0) continue;
        }
        this.cells.set(k, pi * 1e6 + i);
      }
    }
    this.patches.push({ x: Float32Array.from(px), z: Float32Array.from(pz), tx, tz, h, slope, tol });
  }

  /** A ground hit inside a patch, close to its plane: moved onto the plane (the ray from o along d). */
  apply(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: GroundHit): void {
    const cellV = this.cells.get(Math.floor(out.px) * 100003 + Math.floor(out.pz));
    if (cellV === undefined) return;
    const p = this.patches[Math.floor(cellV / 1e6)];
    // the cell names a station near it; the nearest one of its neighbours is the right one (corridors overlap in bends)
    let i = cellV % 1e6;
    let best = Infinity;
    for (let k = Math.max(0, i - 4); k <= Math.min(p.x.length - 1, i + 4); k++) {
      const d = (out.px - p.x[k]) ** 2 + (out.pz - p.z[k]) ** 2;
      if (d < best) {
        best = d;
        i = k;
      }
    }
    // the smoothed plane at this station: height + cross slope, and its gradient along the path
    const lat = (out.px - p.x[i]) * p.tz[i] - (out.pz - p.z[i]) * p.tx[i];
    const ys = p.h[i] + p.slope[i] * lat;
    const off = Math.abs(ys - out.py);
    if (off >= p.tol) return;
    // fade back to the real ground towards the tolerance: no step where the smoothing lets go
    const w = off < p.tol * 0.5 ? 1 : 1 - (off - p.tol * 0.5) / (p.tol * 0.5);
    const a = Math.max(0, i - 1);
    const b = Math.min(p.h.length - 1, i + 1);
    const gs = (p.h[b] - p.h[a]) / Math.max(1, b - a);
    const gl = p.slope[i];
    let pnx = -gs * p.tx[i] - gl * p.tz[i];
    let pnz = -gs * p.tz[i] + gl * p.tx[i];
    let pny = 1;
    const pl = Math.hypot(pnx, pny, pnz);
    pnx /= pl;
    pny /= pl;
    pnz /= pl;
    const denom = dx * pnx + dy * pny + dz * pnz;
    if (denom > -1e-3) return;
    const t = ((out.px - ox) * pnx + (ys - oy) * pny + (out.pz - oz) * pnz) / denom;
    if (t <= 0 || t >= maxDist) return;
    out.dist += (t - out.dist) * w;
    out.px = ox + dx * out.dist;
    out.py = oy + dy * out.dist;
    out.pz = oz + dz * out.dist;
    const nx = out.nx + (pnx - out.nx) * w;
    const ny = out.ny + (pny - out.ny) * w;
    const nz = out.nz + (pnz - out.nz) * w;
    const nl = Math.hypot(nx, ny, nz) || 1;
    out.nx = nx / nl;
    out.ny = ny / nl;
    out.nz = nz / nl;
  }
}
