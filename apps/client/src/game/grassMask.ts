import * as THREE from 'three';
import type { TrackData } from '@apex/shared';

/**
 * The mask as a texture for the ground shaders (track.ts): where it is set, the lawn and the terrain are drawn as if
 * STRUCTURE_PUSH m further from the camera, so a grandstand sunk into a hillside shows its steps instead of the
 * hill's triangles poking through them. rect: x0, z0, 1/width, 1/height (m).
 */
export const STRUCTURE_MASK = {
  tex: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1) as THREE.Texture },
  rect: { value: new THREE.Vector4(0, 0, 1, 1) },
};
export const STRUCTURE_PUSH = 1.5;

/** Grid cell of the mask (m). */
const CELL = 0.5;
/** Only structures this close to the centreline matter (the grass grows within ~110 m of it). */
const NEAR = 130;

/**
 * Where grass must not grow: the ground footprint of the circuit's structures (grandstands, buildings, boards,
 * gantries, walls), from their render meshes, on a 0.5 m grid, one cell wider all round. The grass is placed on the
 * collision ground, and the stands have no collision: blades grew up through their lowest rows and the lawn shells
 * showed over their floors.
 */
export class GrassMask {
  private readonly cells = new Set<number>();

  static build(chunks: { object: THREE.Object3D; kind: string }[], track: TrackData, ground: Set<THREE.Material>): GrassMask {
    const mask = new GrassMask();
    const near = new Set<number>();
    const C = 24;
    const ck = (x: number, z: number) => Math.floor(x / C) * 100003 + Math.floor(z / C);
    const cl = track.centerline;
    const reach = Math.ceil(NEAR / C);
    for (let i = 0; i < cl.length; i += 3 * 4)
      for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) near.add(ck(cl[i] + dx * C, cl[i + 2] + dz * C));
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const ch of chunks) {
      if (ch.kind !== 'scenery') continue;
      ch.object.updateMatrixWorld(true);
      ch.object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
        // ground surfaces modelled with the scenery (infields, hillsides, paddocks) are not structures
        if ([mesh.material].flat().some((m) => ground.has(m) || /grass|turf|terrain|ground|top\d|fill|sand|gravel|asph|road|soil|dirt/i.test(m.name))) return;
        const pos = mesh.geometry.getAttribute('position');
        if (!pos) return;
        const idx = mesh.geometry.getIndex();
        const count = idx ? idx.count : pos.count;
        for (let i = 0; i + 2 < count; i += 3) {
          a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
          b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
          c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
          if (!near.has(ck((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3))) continue;
          mask.fill(a, b, c);
        }
      });
    }
    return mask;
  }

  private key(ix: number, iz: number): number {
    return ix * 1_000_003 + iz;
  }

  /** Mark the cells a triangle covers seen from above (its edges too: walls and boards are thin). */
  private fill(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    const x0 = Math.floor(Math.min(a.x, b.x, c.x) / CELL) - 1;
    const x1 = Math.floor(Math.max(a.x, b.x, c.x) / CELL) + 1;
    const z0 = Math.floor(Math.min(a.z, b.z, c.z) / CELL) - 1;
    const z1 = Math.floor(Math.max(a.z, b.z, c.z) / CELL) + 1;
    // a huge triangle is terrain-like (a hillside, a car park): not a structure's footprint
    if ((x1 - x0) * (z1 - z0) > 40_000) return;
    const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
    const thin = Math.abs(d) < 0.02;
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const px = (ix + 0.5) * CELL;
        const pz = (iz + 0.5) * CELL;
        let inside: boolean;
        if (thin) inside = segDist(px, pz, a, b) < CELL || segDist(px, pz, b, c) < CELL || segDist(px, pz, c, a) < CELL;
        else {
          const w0 = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) / d;
          const w1 = ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) / d;
          // a cell's width of margin around the triangle
          const m = (CELL * 1.5) / Math.sqrt(Math.abs(d));
          inside = w0 > -m && w1 > -m && 1 - w0 - w1 > -m;
        }
        if (inside) this.cells.add(this.key(ix, iz));
      }
  }

  /** Fill STRUCTURE_MASK (1 m per texel, coarser on a huge circuit). */
  publish(): void {
    if (!this.cells.size) return;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const k of this.cells) {
      const ix = Math.round(k / 1_000_003);
      const iz = k - ix * 1_000_003;
      x0 = Math.min(x0, ix);
      x1 = Math.max(x1, ix);
      z0 = Math.min(z0, iz);
      z1 = Math.max(z1, iz);
    }
    const ex = (x1 - x0 + 1) * CELL;
    const ez = (z1 - z0 + 1) * CELL;
    const texel = Math.max(1, ex / 4096, ez / 4096);
    const w = Math.ceil(ex / texel);
    const hgt = Math.ceil(ez / texel);
    const data = new Uint8Array(w * hgt);
    for (const k of this.cells) {
      const ix = Math.round(k / 1_000_003);
      const iz = k - ix * 1_000_003;
      const tx = Math.min(w - 1, Math.floor(((ix - x0) * CELL) / texel));
      const tz = Math.min(hgt - 1, Math.floor(((iz - z0) * CELL) / texel));
      data[tz * w + tx] = 255;
    }
    const tex = new THREE.DataTexture(data, w, hgt, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    STRUCTURE_MASK.tex.value.dispose();
    STRUCTURE_MASK.tex.value = tex;
    STRUCTURE_MASK.rect.value.set(x0 * CELL, z0 * CELL, 1 / (w * texel), 1 / (hgt * texel));
  }

  /** Is (x, z) under or right beside a structure? */
  covers(x: number, z: number): boolean {
    return this.cells.has(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
  }
}

function segDist(px: number, pz: number, a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2)) : 0;
  return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
}
