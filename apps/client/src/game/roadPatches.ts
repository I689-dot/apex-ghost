import { nearestCenterlineIndex, type TrackData } from '@apex/shared';
import type { GroundHit } from '../physics/vehicle';

/** Ground height under (x, z) from yTop down at most maxD (null: no ground, or a wall). */
export type GroundDown = (x: number, yTop: number, z: number, maxD: number) => number | null;

interface Patch {
  x: Float32Array;
  z: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
  /** Distance from each station to the next (m). */
  seg: Float32Array;
  /** Smoothed height, station × lateral bin (0.5 m apart from -half), NaN where there is no ground. */
  h: Float32Array;
  bins: number;
  half: number;
  /** How far from the smoothed surface (m) a hit may be and still be put on it. */
  tol: number;
}

const BIN = 0.5;

/**
 * Smoothed driving surfaces over stretches where the map's collision is rough:
 *  - the pit lane: 5–9 cm bumps and steps of up to 10 cm (box decals, mesh seams, the kerbs at the entry;
 *    tools/sim/pitflat.mjs), and cars bounced all the way down the lane;
 *  - stretches of a layout listed in its `smoothRoad` ([fromS, toS] pairs): on the 24h layout the lap leaves and
 *    rejoins the GP circuit over overlapping road meshes with steps of 0.7–1 m (tools/sim/flatness.ts), which launched
 *    the cars into spins.
 * Per metre along the path and every 0.5 m across it: the ground's height, its kerb ridges and stripes taken out by a
 * median across (2 m) and its bumps by a median and a moving average along the path. The cross-section keeps its
 * real shape (a flat box area beside a drainage fall); the surface is interpolated between stations and across, so
 * a sloping lane has no steps. Wheel rays that land within the corridor, close enough to it, ride it instead.
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
    const bins = Math.round((HALF * 2) / BIN) + 1;
    const raw = new Float32Array(n * bins);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < bins; j++) {
        const lat = -HALF + j * BIN;
        raw[i * bins + j] = ground(px[i] + tz[i] * lat, py[i] + 2, pz[i] - tx[i] * lat, 4) ?? NaN;
      }
    // across: a median over 2 m (kerb ridges, painted stripes and decals 1 m wide are gone, the fall stays)
    const across = new Float32Array(n * bins);
    const win: number[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < bins; j++) {
        const c = raw[i * bins + j];
        if (Number.isNaN(c)) {
          across[i * bins + j] = NaN;
          continue;
        }
        win.length = 0;
        for (let k = Math.max(0, j - 2); k <= Math.min(bins - 1, j + 2); k++) {
          const v = raw[i * bins + k];
          // a wall's foot or a drop beside it is not part of this surface
          if (!Number.isNaN(v) && Math.abs(v - c) < tol) win.push(v);
        }
        across[i * bins + j] = median(win);
      }
    // along: a median over 5 m (seams, short bumps), then a moving average over ±smoothM
    const med = new Float32Array(n * bins);
    for (let j = 0; j < bins; j++)
      for (let i = 0; i < n; i++) {
        const c = across[i * bins + j];
        if (Number.isNaN(c)) {
          med[i * bins + j] = NaN;
          continue;
        }
        win.length = 0;
        for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) {
          const v = across[k * bins + j];
          if (!Number.isNaN(v) && Math.abs(v - c) < tol) win.push(v);
        }
        med[i * bins + j] = median(win);
      }
    const h = new Float32Array(n * bins);
    for (let j = 0; j < bins; j++)
      for (let i = 0; i < n; i++) {
        const c = med[i * bins + j];
        if (Number.isNaN(c)) {
          h[i * bins + j] = NaN;
          continue;
        }
        let sum = 0;
        let cnt = 0;
        for (let k = Math.max(0, i - smoothM); k <= Math.min(n - 1, i + smoothM); k++) {
          const v = med[k * bins + j];
          if (!Number.isNaN(v) && Math.abs(v - c) < tol) {
            sum += v;
            cnt++;
          }
        }
        h[i * bins + j] = sum / cnt;
      }
    const seg = new Float32Array(n);
    for (let i = 0; i + 1 < n; i++) seg[i] = Math.hypot(px[i + 1] - px[i], pz[i + 1] - pz[i]) || 1;
    seg[n - 1] = 1;
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
    this.patches.push({ x: Float32Array.from(px), z: Float32Array.from(pz), tx, tz, seg, h, bins, half: HALF, tol });
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
    // between this station and the next one along the path, between two bins across
    let along = (out.px - p.x[i]) * p.tx[i] + (out.pz - p.z[i]) * p.tz[i];
    if (along < 0 && i > 0) {
      i--;
      along += p.seg[i];
    }
    const i1 = Math.min(p.x.length - 1, i + 1);
    const f = i1 === i ? 0 : Math.max(0, Math.min(1, along / p.seg[i]));
    const lat = (out.px - p.x[i]) * p.tz[i] - (out.pz - p.z[i]) * p.tx[i];
    const jf = (lat + p.half) / BIN;
    const j = Math.max(0, Math.min(p.bins - 2, Math.floor(jf)));
    const g = Math.max(0, Math.min(1, jf - j));
    const h00 = p.h[i * p.bins + j];
    const h01 = p.h[i * p.bins + j + 1];
    const h10 = p.h[i1 * p.bins + j];
    const h11 = p.h[i1 * p.bins + j + 1];
    if (Number.isNaN(h00 + h01 + h10 + h11)) return;
    const ys = (h00 * (1 - g) + h01 * g) * (1 - f) + (h10 * (1 - g) + h11 * g) * f;
    const off = Math.abs(ys - out.py);
    if (off >= p.tol) return;
    // fade back to the real ground towards the tolerance: no step where the smoothing lets go
    const w = off < p.tol * 0.5 ? 1 : 1 - (off - p.tol * 0.5) / (p.tol * 0.5);
    // the surface's gradient along the path and across it (lateral + = left of travel: (tz, -tx))
    const gs = ((h10 - h00) * (1 - g) + (h11 - h01) * g) / (i1 === i ? 1 : p.seg[i]);
    const gl = ((h01 - h00) * (1 - f) + (h11 - h10) * f) / BIN;
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
