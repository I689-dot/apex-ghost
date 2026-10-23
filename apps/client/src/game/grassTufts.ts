import * as THREE from 'three';
import type { TrackData } from '@apex/shared';
import type { GroundHit, GroundQuery } from '../physics/vehicle';

/**
 * Real grass beside the track: the map's grass is a 256 px tile that reads as a green carpet from the cockpit, so
 * the strip beside the road (0.6–9 m past the edge, where the driver looks) gets 3D tufts: crossed cards of
 * blades, placed at load on the grass found by ray casts, drawn within `radius` m of the camera from one
 * instanced mesh refilled after the camera has moved a few metres (like the forest's near trees).
 */

const CELL = 16;
const BAND_M = 8.6;
const TUFTS_PER_M2 = 5;
const MAX_TUFTS = 600_000;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Blades fanning out from the base, lighter at the tips, transparent around them. */
function bladeTexture(): THREE.CanvasTexture {
  const W = 64;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const r = rng(99);
  for (let k = 0; k < 26; k++) {
    const x0 = W / 2 + (r() - 0.5) * W * 0.5;
    const lean = (r() - 0.5) * W * 0.55;
    const h = H * (0.45 + r() * 0.55);
    const grad = g.createLinearGradient(0, H, 0, H - h);
    // the dull green of the verge texture, not lime: low saturation, a little lighter at the tips
    const l = 26 + r() * 9;
    grad.addColorStop(0, `hsl(${80 + r() * 14}, 30%, ${l - 5}%)`);
    grad.addColorStop(1, `hsl(${68 + r() * 18}, 36%, ${l + 10}%)`);
    g.strokeStyle = grad;
    g.lineWidth = 1.4 + r() * 1.6;
    g.beginPath();
    g.moveTo(x0, H);
    g.quadraticCurveTo(x0 + lean * 0.3, H - h * 0.6, x0 + lean, H - h);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GrassTufts {
  readonly mesh: THREE.InstancedMesh;
  /** x, y, z, yaw, scale per tuft, grouped by cell. */
  private data: Float32Array;
  private cells = new Map<number, [number, number]>();
  private last = new THREE.Vector3(Infinity, 0, 0);
  private lastRadius = -1;

  private constructor(data: Float32Array, cells: Map<number, [number, number]>, capacity: number) {
    this.data = data;
    this.cells = cells;
    // two crossed cards, 0.36 m wide, 0.2 m tall (mown verge grass), standing on the ground
    const a = new THREE.PlaneGeometry(0.36, 0.2);
    a.translate(0, 0.1, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    const geo = new THREE.BufferGeometry();
    const pos = [...a.getAttribute('position').array, ...b.getAttribute('position').array];
    const uv = [...a.getAttribute('uv').array, ...b.getAttribute('uv').array];
    const nrm: number[] = [];
    for (let i = 0; i < pos.length / 3; i++) nrm.push(0, 1, 0); // lit like the ground under them, not like a wall
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    // both windings of both cards, front faces only: with DoubleSide three.js flips the normal of a back face, and
    // half the tufts (seen from behind) went dark
    const ia = Array.from(a.getIndex()?.array ?? []);
    const one = [...ia, ...ia.map((i) => i + 4)];
    const back: number[] = [];
    for (let k = 0; k < one.length; k += 3) back.push(one[k], one[k + 2], one[k + 1]);
    geo.setIndex([...one, ...back]);
    const mat = new THREE.MeshLambertMaterial({ map: bladeTexture(), alphaTest: 0.45 });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.name = 'grass-tufts';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** Tufts on the grass beside this layout (null: no grass found). */
  static build(track: TrackData, ground: GroundQuery, capacity = 12_000): GrassTufts | null {
    const r = rng(4242);
    const cl = track.centerline;
    const n = cl.length / 3;
    const hit: GroundHit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
    const tmp: number[] = [];
    const byCell = new Map<number, number[]>();
    const key = (x: number, z: number) => Math.floor(x / CELL) * 73856093 + Math.floor(z / CELL);
    // the ground is sampled on a 1 m grid beside the edge; each grass cell gets several tufts (fewer per m² on long
    // layouts, so the 24 km one stays within MAX_TUFTS)
    const perM2 = Math.max(1.5, Math.min(TUFTS_PER_M2, MAX_TUFTS / (track.length * 2 * BAND_M * 0.6)));
    let total = 0;
    for (let i = 0; i < n && total < MAX_TUFTS; i++) {
      const j = (i + 1) % n;
      const dx = cl[j * 3] - cl[i * 3];
      const dz = cl[j * 3 + 2] - cl[i * 3 + 2];
      const seg = Math.hypot(dx, dz);
      if (!seg) continue;
      const tx = dx / seg;
      const tz = dz / seg;
      for (let along = 0; along < seg; along += 1) {
        for (const side of [1, -1]) {
          const edge = (side > 0 ? (track.limitL?.[i] ?? track.widthL[i]) : (track.limitR?.[i] ?? track.widthR[i])) + 0.6;
          for (let off = edge; off < edge + BAND_M; off += 1) {
            const x = cl[i * 3] + tx * along + tz * off * side;
            const z = cl[i * 3 + 2] + tz * along - tx * off * side;
            if (!ground.cast(x, cl[i * 3 + 1] + 4, z, 0, -1, 0, 12, hit) || hit.surface !== 'grass' || hit.ny < 0.8) continue;
            const kk = key(x, z);
            let l = byCell.get(kk);
            if (!l) byCell.set(kk, (l = []));
            // thicker right at the edge, where the driver looks
            const here = Math.floor(perM2 * (1.4 - (0.8 * (off - edge)) / BAND_M) + r());
            for (let k = 0; k < here; k++) l.push(x + r() - 0.5, hit.py, z + r() - 0.5, r() * Math.PI * 2, 0.6 + r() * 0.6);
            total += here;
          }
        }
      }
    }
    if (!total) return null;
    const cells = new Map<number, [number, number]>();
    for (const [k, l] of byCell) {
      cells.set(k, [tmp.length / 5, l.length / 5]);
      for (const v of l) tmp.push(v);
    }
    return new GrassTufts(new Float32Array(tmp), cells, capacity);
  }

  /** Refill around the camera after it has moved ~3 m (radius 0: hidden). */
  update(cam: THREE.Vector3, radius: number): void {
    if (radius <= 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    if (cam.distanceToSquared(this.last) < 9 && radius === this.lastRadius) return;
    this.last.copy(cam);
    this.lastRadius = radius;
    const m = this.mesh;
    const d = this.data;
    const r2 = radius * radius;
    const cap = m.instanceMatrix.count;
    const c = Math.ceil(radius / CELL);
    const cx = Math.floor(cam.x / CELL);
    const cz = Math.floor(cam.z / CELL);
    let count = 0;
    for (let ix = cx - c; ix <= cx + c && count < cap; ix++)
      for (let iz = cz - c; iz <= cz + c && count < cap; iz++) {
        const cell = this.cells.get(ix * 73856093 + iz);
        if (!cell) continue;
        for (let t = cell[0]; t < cell[0] + cell[1] && count < cap; t++) {
          const o = t * 5;
          const ddx = d[o] - cam.x;
          const ddz = d[o + 2] - cam.z;
          const dd = ddx * ddx + ddz * ddz;
          if (dd > r2) continue;
          // thinner towards the edge of the radius, so it fades instead of ending on a line
          if (dd > r2 * 0.45 && (t * 2654435761) % 1000 > 1000 * (1 - (dd - r2 * 0.45) / (r2 * 0.55))) continue;
          _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, d[o + 3]);
          _m.compose(_p.set(d[o], d[o + 1], d[o + 2]), _q, _s.setScalar(d[o + 4]));
          m.setMatrixAt(count++, _m);
        }
      }
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
