import * as THREE from 'three';
import { fetchWithProgress, url } from './assets';
import type { QualityConfig } from '../settings';

/**
 * The Eifel forest around the circuit: hundreds of thousands of spruce and beech trees placed on the map's
 * satellite photo by tools/asset-pipeline/forest_scatter.mjs (forest.bin: 8 bytes per tree, sorted in 128 m cells).
 *
 * Two levels of detail, each one InstancedMesh per species, refilled when the camera has moved ~20 m:
 *  - near (≤ forestNear m): low-poly 3D trees (stacked jagged tiers for spruce, lumpy crown for beech), cast shadows;
 *  - far  (≤ forestFar m): camera-facing impostor cards baked at load from the same 3D trees, thinned by forestDensity.
 * So the whole forest costs 4 draw calls (+2 in the shadow pass) whatever its size.
 */

export interface ForestRef {
  file: string;
  meta: string;
}
interface ForestMeta {
  version: number;
  cell: number;
  origin: [number, number];
  nx: number;
  nz: number;
  count: number;
  cells: [number, number, number][]; // cell index, first tree, count
}

const SPRUCE_H = 25; // metres at scale 1
const BEECH_H = 21;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Needle / leaf clumps: soft blotches, used as a multiplier on the vertex colours. */
function foliageTexture(): THREE.DataTexture {
  const N = 128;
  const d = new Uint8Array(N * N * 4);
  const r = rng(77);
  const v = new Float32Array(N * N).fill(0.72);
  for (let k = 0; k < 900; k++) {
    const cx = r() * N;
    const cy = r() * N;
    const rad = 1.5 + r() * 4;
    const b = (r() - 0.45) * 0.55;
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        const dd = Math.hypot(x - cx, y - cy) / rad;
        if (dd < 1) v[((y + N) % N) * N + ((x + N) % N)] += b * (1 - dd * dd);
      }
  }
  for (let i = 0; i < N * N; i++) {
    const c = Math.max(0, Math.min(255, Math.round(v[i] * 255)));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = c;
    d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

interface Builder {
  pos: number[];
  nor: number[];
  col: number[];
  uv: number[];
}
const push = (b: Builder, p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, u: number, v: number) => {
  b.pos.push(p.x, p.y, p.z);
  b.nor.push(n.x, n.y, n.z);
  b.col.push(c.r, c.g, c.b);
  b.uv.push(u, v);
};
function toGeometry(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.computeBoundingSphere();
  return g;
}

function trunk(b: Builder, h: number, r0: number, col: THREE.Color): void {
  const seg = 5;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const quad: [number, number][] = [
      [a0, 0],
      [a1, 0],
      [a1, 1],
      [a0, 0],
      [a1, 1],
      [a0, 1],
    ];
    for (const [a, t] of quad) {
      const r = r0 * (1 - 0.6 * t);
      p.set(Math.cos(a) * r, t * h, Math.sin(a) * r);
      n.set(Math.cos(a), 0, Math.sin(a));
      push(b, p, n, col, a, t);
    }
  }
}

/**
 * Norway spruce: a narrow cone of drooping, jagged branch tiers (~110 triangles). Normals lean outwards and up, so
 * the tiers read as soft volumes instead of facets; colours are darker inside and lower down (occlusion).
 */
function spruceGeometry(): THREE.BufferGeometry {
  const b: Builder = { pos: [], nor: [], col: [], uv: [] };
  const r = rng(11);
  trunk(b, 6, 0.32, new THREE.Color(0.16, 0.11, 0.08));
  const tiers = 7;
  const seg = 8;
  const H = SPRUCE_H;
  const crownBase = 2.6;
  // Norway spruce reads almost black-green from the road: low albedo, a touch blue
  const tip = new THREE.Color(0.042, 0.068, 0.04);
  const inner = new THREE.Color(0.009, 0.016, 0.012);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let t = 0; t < tiers; t++) {
    const f0 = t / tiers;
    const f1 = (t + 1) / tiers;
    // each tier: from its bottom ring (wide, drooping) up to the next tier's middle (overlap hides the gaps)
    const yBot = crownBase + (H - crownBase) * f0 * 0.97;
    const yTop = crownBase + (H - crownBase) * Math.min(1, f1 + 0.11);
    const radius = 3.6 * Math.pow(1 - f0, 0.95) + 0.35;
    const shade = 0.55 + 0.45 * f0;
    const rot = r() * Math.PI;
    for (let i = 0; i < seg; i++) {
      const a0 = rot + (i / seg) * Math.PI * 2;
      const a1 = rot + ((i + 1) / seg) * Math.PI * 2;
      const j0 = 0.75 + r() * 0.45;
      const j1 = 0.75 + r() * 0.45;
      const tipPt = (a: number, j: number) => p.set(Math.cos(a) * radius * j, yBot - 0.5 * j, Math.sin(a) * radius * j);
      const top = () => p.set(0, yTop, 0);
      // outer face of the tier
      const tri: [() => THREE.Vector3, number, number][] = [
        [() => tipPt(a0, j0), a0, 1],
        [top, (a0 + a1) / 2, 0],
        [() => tipPt(a1, j1), a1, 1],
      ];
      for (const [pt, a, outer] of tri) {
        pt();
        n.set(Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8).normalize();
        c.copy(inner)
          .lerp(tip, outer ? 1 : 0.35)
          .multiplyScalar(shade);
        push(b, p, n, c, a * 1.3, p.y * 0.35);
      }
      // underside (seen from the road below the crown): dark
      const under: [() => THREE.Vector3, number][] = [
        [() => tipPt(a0, j0), a0],
        [() => tipPt(a1, j1), a1],
        [() => p.set(0, yBot + 1.6, 0), (a0 + a1) / 2],
      ];
      for (const [pt, a] of under) {
        pt();
        n.set(Math.cos(a) * 0.5, -0.3, Math.sin(a) * 0.5).normalize();
        c.copy(inner).multiplyScalar(1.4 * shade);
        push(b, p, n, c, a * 1.3, p.y * 0.35);
      }
    }
  }
  return toGeometry(b);
}

/** Beech / oak: an irregular, lumpy crown on a taller trunk (~130 triangles). */
function beechGeometry(): THREE.BufferGeometry {
  const b: Builder = { pos: [], nor: [], col: [], uv: [] };
  const r = rng(23);
  trunk(b, 9, 0.38, new THREE.Color(0.25, 0.23, 0.2));
  const light = new THREE.Color(0.07, 0.11, 0.035);
  const dark = new THREE.Color(0.016, 0.03, 0.012);
  const blobs: [number, number, number, number][] = [
    [0, 14.5, 0, 5.4],
    [2.7, 12, 1.3, 4.0],
    [-2.5, 12.4, -1.5, 4.1],
    [0.7, 17.6, -0.9, 3.5],
    [-0.8, 11.2, 2.6, 3.4],
  ];
  // 20-face blobs with sphere normals: smooth shading, ~110 triangles for the crown
  const ico = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const ip = ico.getAttribute('position');
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (const [bx, by, bz, br] of blobs) {
    const bump = new Map<string, number>();
    for (let i = 0; i < ip.count; i++) {
      n.fromBufferAttribute(ip, i).normalize();
      const key = `${n.x.toFixed(3)},${n.y.toFixed(3)},${n.z.toFixed(3)}`;
      if (!bump.has(key)) bump.set(key, 0.8 + r() * 0.4);
      const k = bump.get(key) as number;
      p.set(bx + n.x * br * k, by + n.y * br * k * 0.85, bz + n.z * br * k);
      c.copy(dark).lerp(light, THREE.MathUtils.clamp(0.35 + 0.5 * n.y + 0.25 * (k - 1), 0, 1));
      push(b, p, n, c, Math.atan2(n.z, n.x) * 1.5, p.y * 0.3);
    }
  }
  ico.dispose();
  return toGeometry(b);
}

/** Bakes a tree into an alpha-cut impostor texture (side view, soft fixed light). */
function bakeImpostor(renderer: THREE.WebGLRenderer, geo: THREE.BufferGeometry, map: THREE.Texture, h: number, wFrac: number): THREE.Texture {
  const W = 128;
  const H = Math.round(W / wFrac);
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  // unlit albedo (vertex colours carry the occlusion): the card is lit by the scene like the 3D trees
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, map }));
  scene.add(mesh);
  const half = (h * wFrac) / 2;
  const cam = new THREE.OrthographicCamera(-half, half, h, 0, -50, 50);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  // average a few azimuths for a rounder card
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  (mesh.material as THREE.Material).dispose();
  return rt.texture;
}

/** Camera-facing (cylindrical) card for the far trees; the instance matrix gives position, yaw and scale. */
function impostorMaterial(map: THREE.Texture, alphaToCoverage: boolean): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide });
  m.alphaToCoverage = alphaToCoverage;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);').replace(
      '#include <project_vertex>',
      `vec3 apxC = instanceMatrix[3].xyz;
float apxS = length(instanceMatrix[1].xyz);
vec3 apxR = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]) + vec3(1e-5, 0.0, 0.0));
vec3 apxW = apxC + apxR * position.x * length(instanceMatrix[0].xyz) + vec3(0.0, position.y * apxS, 0.0);
vec4 mvPosition = viewMatrix * vec4(apxW, 1.0);
gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  m.customProgramCacheKey = () => `forest-impostor-${alphaToCoverage}`;
  return m;
}

export class Forest {
  readonly root = new THREE.Group();
  private meta: ForestMeta;
  private x: Float32Array;
  private y: Float32Array;
  private z: Float32Array;
  private s: Float32Array;
  private yaw: Float32Array;
  private type: Uint8Array;
  private keep: Float32Array; // per-tree hash 0..1 for density thinning
  private tint: Float32Array; // per-tree brightness variation
  private slim: Float32Array; // per-tree crown width / height ratio factor
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private lastQ: QualityConfig | null = null;
  private nearMat: THREE.MeshLambertMaterial;

  private constructor(meta: ForestMeta, raw: ArrayBuffer) {
    this.meta = meta;
    const n = meta.count;
    const dv = new DataView(raw);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.s = new Float32Array(n);
    this.yaw = new Float32Array(n);
    this.type = new Uint8Array(n);
    this.keep = new Float32Array(n);
    this.tint = new Float32Array(n);
    this.slim = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      // v2: uint16 0.2 m from the origin; v1: int16 0.1 m from the map origin
      this.x[i] = meta.version >= 2 ? meta.origin[0] + dv.getUint16(o, true) / 5 : dv.getInt16(o, true) / 10;
      this.z[i] = meta.version >= 2 ? meta.origin[1] + dv.getUint16(o + 2, true) / 5 : dv.getInt16(o + 2, true) / 10;
      this.y[i] = dv.getInt16(o + 4, true) / 20;
      this.s[i] = dv.getUint8(o + 6) / 100;
      const ty = dv.getUint8(o + 7);
      this.type[i] = ty >> 7;
      this.yaw[i] = ((ty & 127) / 127) * Math.PI * 2;
      let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      this.keep[i] = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      this.tint[i] = 0.8 + 0.4 * (((h >>> 8) & 255) / 255);
      this.slim[i] = 0.78 + 0.4 * (((h >>> 20) & 255) / 255);
    }
    this.root.name = 'forest';
    this.nearMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: foliageTexture() });
  }

  static async load(ref: ForestRef, renderer: THREE.WebGLRenderer, onBytes: (n: number) => void): Promise<Forest | null> {
    try {
      const [metaBuf, raw] = await Promise.all([fetch(url(ref.meta)).then((r) => r.json() as Promise<ForestMeta>), fetchWithProgress(ref.file, onBytes)]);
      const f = new Forest(metaBuf, raw);
      f.build(renderer);
      return f;
    } catch (e) {
      console.warn('forest not loaded', e);
      return null;
    }
  }

  private build(renderer: THREE.WebGLRenderer): void {
    const geos = [spruceGeometry(), beechGeometry()];
    const heights = [SPRUCE_H, BEECH_H];
    const widths = [0.48, 0.74]; // card width / tree height
    const card = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    for (let k = 0; k < 2; k++) {
      const near = new THREE.InstancedMesh(geos[k], this.nearMat, 1);
      near.frustumCulled = false;
      near.count = 0;
      near.name = `forest_near_${k}`;
      const tex = bakeImpostor(renderer, geos[k], this.nearMat.map as THREE.Texture, heights[k], widths[k]);
      // the card covers the bake's frame
      const g = card.clone().scale(heights[k] * widths[k], heights[k], 1);
      const far = new THREE.InstancedMesh(g, impostorMaterial(tex, false), 1);
      far.frustumCulled = false;
      far.count = 0;
      far.name = `forest_far_${k}`;
      this.near.push(near);
      this.far.push(far);
      this.root.add(near, far);
    }
  }

  private ensureCapacity(mesh: THREE.InstancedMesh, n: number): THREE.InstancedMesh {
    if (mesh.instanceMatrix.count >= n) return mesh;
    const cap = Math.ceil(n * 1.25);
    const next = new THREE.InstancedMesh(mesh.geometry, mesh.material, cap);
    next.frustumCulled = false;
    next.name = mesh.name;
    next.castShadow = mesh.castShadow;
    next.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.root.remove(mesh);
    mesh.dispose();
    this.root.add(next);
    return next;
  }

  /** Re-select near/far trees around the camera; cheap to call every frame (works only after ~20 m of travel). */
  update(cam: THREE.Vector3, q: QualityConfig, force = false): void {
    if (!force && q === this.lastQ && cam.distanceToSquared(this.lastPos) < 400) return;
    this.lastPos.copy(cam);
    if (q !== this.lastQ) {
      for (const m of this.near) m.castShadow = q.treeShadows;
      (this.far[0].material as THREE.MeshLambertMaterial).alphaToCoverage = q.antialias === 'msaa';
      (this.far[1].material as THREE.MeshLambertMaterial).alphaToCoverage = q.antialias === 'msaa';
      this.lastQ = q;
    }
    const nearD2 = q.forestNear * q.forestNear;
    const farD = q.forestFar;
    const farD2 = farD * farD;
    const { cell, origin, nx, nz, cells } = this.meta;
    const ci0 = Math.max(0, Math.floor((cam.x - farD - origin[0]) / cell));
    const ci1 = Math.min(nx - 1, Math.floor((cam.x + farD - origin[0]) / cell));
    const cj0 = Math.max(0, Math.floor((cam.z - farD - origin[1]) / cell));
    const cj1 = Math.min(nz - 1, Math.floor((cam.z + farD - origin[1]) / cell));
    // pass 1: count, pass 2: write (avoids growing arrays per frame)
    const nN = [0, 0];
    const nF = [0, 0];
    const visit = (write: boolean) => {
      for (const [c, first, count] of cells) {
        const ci = c % nx;
        const cj = (c - ci) / nx;
        if (ci < ci0 || ci > ci1 || cj < cj0 || cj > cj1) continue;
        for (let i = first; i < first + count; i++) {
          const dx = this.x[i] - cam.x;
          const dz = this.z[i] - cam.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > farD2) continue;
          const t = this.type[i];
          if (d2 <= nearD2) {
            if (this.keep[i] > q.forestNearDensity) continue;
            if (write) this.put(this.near[t], nN[t], i, 1);
            nN[t]++;
          } else {
            if (this.keep[i] > q.forestDensity) continue;
            if (write) this.put(this.far[t], nF[t], i, 1 + 0.25 * (1 - q.forestDensity));
            nF[t]++;
          }
        }
      }
    };
    visit(false);
    for (let t = 0; t < 2; t++) {
      this.near[t] = this.ensureCapacity(this.near[t], nN[t]);
      this.far[t] = this.ensureCapacity(this.far[t], nF[t]);
    }
    const counts = [nN.slice(), nF.slice()];
    nN[0] = nN[1] = nF[0] = nF[1] = 0;
    visit(true);
    for (let t = 0; t < 2; t++) {
      for (const [m, n] of [
        [this.near[t], counts[0][t]],
        [this.far[t], counts[1][t]],
      ] as [THREE.InstancedMesh, number][]) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.visible = n > 0;
      }
    }
  }

  private put(m: THREE.InstancedMesh, k: number, i: number, grow: number): void {
    const a = m.instanceMatrix.array as Float32Array;
    const s = this.s[i] * grow;
    const w = s * this.slim[i];
    const c = Math.cos(this.yaw[i]) * w;
    const sn = Math.sin(this.yaw[i]) * w;
    const o = k * 16;
    a[o] = c;
    a[o + 1] = 0;
    a[o + 2] = -sn;
    a[o + 3] = 0;
    a[o + 4] = 0;
    a[o + 5] = s;
    a[o + 6] = 0;
    a[o + 7] = 0;
    a[o + 8] = sn;
    a[o + 9] = 0;
    a[o + 10] = c;
    a[o + 11] = 0;
    a[o + 12] = this.x[i];
    a[o + 13] = this.y[i] - 0.4; // sink the base into slopes
    a[o + 14] = this.z[i];
    a[o + 15] = 1;
    if (!m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
    const col = m.instanceColor.array as Float32Array;
    const v = this.tint[i];
    col[k * 3] = v * (this.type[i] ? 1.03 : 0.97);
    col[k * 3 + 1] = v;
    col[k * 3 + 2] = v * 0.95;
  }

  /** Total trees drawn (near + far). */
  get drawn(): number {
    return this.near.reduce((s, m) => s + m.count, 0) + this.far.reduce((s, m) => s + m.count, 0);
  }

  dispose(): void {
    for (const m of [...this.near, ...this.far]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}
