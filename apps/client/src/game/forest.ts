import * as THREE from 'three';
import { fetchWithProgress, url } from './assets';
import type { QualityConfig } from '../settings';
import { addWindUniforms, alphaMipFix, loadTreeModels, mergeParts, modelParts, windChunk } from './vegetation';

/**
 * The Eifel forest around the circuit: hundreds of thousands of spruce and beech trees placed on the map's
 * satellite photo by tools/asset-pipeline/forest_scatter.mjs (forest.bin: 8 bytes per tree, sorted in 128 m cells).
 *
 * Species: three Norway spruce models and a maple standing in for the beeches (assets/vegetation/trees.glb, from the
 * Low_Poly_Trees and Maple_tree models; vegetation.ts). Without them, procedural low-poly trees (below) stand in.
 *
 * Two levels of detail, each one InstancedMesh per species, refilled when the camera has moved ~20 m:
 *  - near (≤ forestNear m; the 3.5k-triangle maples ≤ 40 % of it): the 3D models, swaying in the wind, with crown
 *    normals (shaded as a soft volume, not as flat cards) and baked occlusion (darker inside and low in the crown);
 *  - far  (≤ forestFar m): camera-facing impostor cards baked at load from the same models, with a baked normal map
 *    so the sun lights them from the right side; thinned by forestDensity.
 * So the whole forest costs ~2 draw calls per species (+ the shadow pass) whatever its size.
 */

export interface ForestRef {
  file: string;
  meta: string;
}
/** A trackside tree of the source map (Track.extractCardTrees): base position, height (m), conifer or not. */
export interface CardTree {
  x: number;
  y: number;
  z: number;
  h: number;
  spruce: boolean;
}
/** Every tree, sorted by grid cell. */
interface TreeArrays {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  s: Float32Array;
  yaw: Float32Array;
  type: Uint8Array;
  /** 1: a trackside tree (never thinned out: they line the road, a missing one pops in when you get close). */
  pinned: Uint8Array;
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
type Grid = Pick<ForestMeta, 'cell' | 'origin' | 'nx' | 'nz' | 'cells'>;

/** forest.bin (8 bytes per tree) → arrays. */
function parseForest(meta: ForestMeta, raw: ArrayBuffer): TreeArrays {
  const n = meta.count;
  const dv = new DataView(raw);
  const t: TreeArrays = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    s: new Float32Array(n),
    yaw: new Float32Array(n),
    type: new Uint8Array(n),
    pinned: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    // v2: uint16 0.2 m from the origin; v1: int16 0.1 m from the map origin
    t.x[i] = meta.version >= 2 ? meta.origin[0] + dv.getUint16(o, true) / 5 : dv.getInt16(o, true) / 10;
    t.z[i] = meta.version >= 2 ? meta.origin[1] + dv.getUint16(o + 2, true) / 5 : dv.getInt16(o + 2, true) / 10;
    t.y[i] = dv.getInt16(o + 4, true) / 20;
    t.s[i] = dv.getUint8(o + 6) / 100;
    const ty = dv.getUint8(o + 7);
    t.type[i] = ty >> 7;
    t.yaw[i] = ((ty & 127) / 127) * Math.PI * 2;
  }
  return t;
}

/** Forest trees + trackside trees, re-sorted into 128 m cells (a counting sort on typed arrays: ~600k trees). */
function mergeTrees(base: TreeArrays | null, extra: CardTree[]): { trees: TreeArrays; grid: Grid } {
  const nb = base ? base.x.length : 0;
  const n = nb + extra.length;
  const arrays = (): TreeArrays => ({
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    s: new Float32Array(n),
    yaw: new Float32Array(n),
    type: new Uint8Array(n),
    pinned: new Uint8Array(n),
  });
  const all = arrays();
  if (base) for (const k of ['x', 'y', 'z', 's', 'yaw', 'type', 'pinned'] as const) all[k].set(base[k]);
  extra.forEach((e, j) => {
    const i = nb + j;
    all.x[i] = e.x;
    all.y[i] = e.y + 0.2;
    all.z[i] = e.z;
    all.s[i] = e.h / (e.spruce ? SPRUCE_H : BEECH_H);
    all.yaw[i] = ((i * 2654435761) % 6283) / 1000;
    all.type[i] = e.spruce ? 0 : 1;
    all.pinned[i] = 1;
  });
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, all.x[i]);
    z0 = Math.min(z0, all.z[i]);
    x1 = Math.max(x1, all.x[i]);
    z1 = Math.max(z1, all.z[i]);
  }
  const cell = 128;
  const nx = Math.max(1, Math.ceil((x1 - x0 + 1) / cell));
  const nz = Math.max(1, Math.ceil((z1 - z0 + 1) / cell));
  const cellOf = new Int32Array(n);
  const counts = new Int32Array(nx * nz);
  for (let i = 0; i < n; i++) {
    const c = Math.min(nz - 1, Math.floor((all.z[i] - z0) / cell)) * nx + Math.min(nx - 1, Math.floor((all.x[i] - x0) / cell));
    cellOf[i] = c;
    counts[c]++;
  }
  const start = new Int32Array(nx * nz);
  const cells: [number, number, number][] = [];
  let acc = 0;
  for (let c = 0; c < nx * nz; c++) {
    start[c] = acc;
    if (counts[c]) cells.push([c, acc, counts[c]]);
    acc += counts[c];
  }
  const trees = arrays();
  for (let i = 0; i < n; i++) {
    const k = start[cellOf[i]]++;
    trees.x[k] = all.x[i];
    trees.y[k] = all.y[i];
    trees.z[k] = all.z[i];
    trees.s[k] = all.s[i];
    trees.yaw[k] = all.yaw[i];
    trees.type[k] = all.type[i];
    trees.pinned[k] = all.pinned[i];
  }
  return { trees, grid: { cell, origin: [x0, z0], nx, nz, cells } };
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

interface Species {
  /** Near geometry (metres, base at the origin) and its materials (one per geometry group). */
  geo: THREE.BufferGeometry;
  mats: THREE.Material[];
  /** Impostor bake materials (unlit albedo, normals), one per group. */
  bakeAlbedo: THREE.Material[];
  bakeNormal: THREE.Material[];
  height: number;
  /** Card width / tree height. */
  wFrac: number;
  /** Share of forestNear drawn as 3D trees (heavy models stop earlier). */
  nearShare: number;
}

const SPRUCE_TINT = new THREE.Color(0.5, 0.58, 0.47);
const MAPLE_TINT = new THREE.Color(0.86, 0.92, 0.78);

/** Unlit albedo for the impostor bake. */
function bakeAlbedoMaterial(map: THREE.Texture | null, color: THREE.Color, alpha: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, color, vertexColors: true, alphaTest: alpha ? 0.5 : 0, side: alpha ? THREE.DoubleSide : THREE.FrontSide });
}

/** View-space normals (= card space in the bake) encoded to RGB, alpha-cut like the albedo. */
function bakeNormalMaterial(map: THREE.Texture | null, alpha: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: alpha ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: { map: { value: map }, cut: { value: alpha && map ? 0.5 : -1 } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec2 vUv;
      void main() { vN = normalize(normalMatrix * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform sampler2D map; uniform float cut; varying vec3 vN; varying vec2 vUv;
      void main() { if (cut > 0.0 && texture2D(map, vUv).a < cut) discard; gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }`,
  });
}

/**
 * Foliage and bark of the near trees: Lambert (per pixel), wind sway, and for leaves the crown normals on both
 * faces (three.js flips the normal of a back face, which shaded half the cards of a crown dark).
 */
function nearMaterial(map: THREE.Texture | null, color: THREE.Color, leaf: boolean, height: number): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, color, vertexColors: true, alphaTest: leaf ? 0.5 : 0, side: leaf ? THREE.DoubleSide : THREE.FrontSide });
  // ~0.25 m of sway at the top of a 25 m tree in a normal breeze
  const bend = 0.25 / (height * height);
  m.onBeforeCompile = (sh) => {
    addWindUniforms(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${windChunk(bend, leaf ? 0.05 : 0)}`);
    if (leaf)
      sh.fragmentShader = sh.fragmentShader
        .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;')
        .replace('#include <alphatest_fragment>', alphaMipFix(0.1, 3));
  };
  m.customProgramCacheKey = () => `forest-near-${leaf}-${bend.toFixed(5)}`;
  return m;
}

/**
 * Crown normals and baked occlusion: leaf normals point out of the crown (a soft volume under the sun); vertex colours
 * darken the inside of the crown and its lower part, and the bark (in the shade of the crown).
 */
function shadeTree(parts: { geo: THREE.BufferGeometry; leaf: boolean }[]): void {
  const box = new THREE.Box3();
  for (const p of parts) if (p.leaf) box.union(new THREE.Box3().setFromBufferAttribute(p.geo.getAttribute('position') as THREE.BufferAttribute));
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const rad = Math.max(size.x, size.z) / 2 || 1;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const p of parts) {
    const pos = p.geo.getAttribute('position');
    const nor = p.geo.getAttribute('normal');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const hy = THREE.MathUtils.clamp((v.y - box.min.y) / (size.y || 1), 0, 1);
      if (p.leaf) {
        // ellipsoid around the crown: outward normal, blended with the card's own for some texture in the light
        n.set((v.x - c.x) / rad, ((v.y - c.y) / (size.y / 2 || 1)) * 0.6 + 0.25, (v.z - c.z) / rad).normalize();
        const own = new THREE.Vector3().fromBufferAttribute(nor, i);
        n.multiplyScalar(0.82).addScaledVector(own, 0.18).normalize();
        nor.setXYZ(i, n.x, n.y, n.z);
        const radial = Math.min(1, Math.hypot(v.x - c.x, v.z - c.z) / (rad * (0.35 + 0.65 * (1 - hy * 0.7))));
        const ao = (0.42 + 0.58 * THREE.MathUtils.smoothstep(radial, 0.15, 0.95)) * (0.72 + 0.28 * hy);
        col.set([ao, ao, ao], i * 3);
      } else col.set([0.55, 0.55, 0.55], i * 3);
    }
    p.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
}

/** Bakes a tree into an alpha-cut impostor card: albedo (unlit, occlusion baked) and normals. */
function bakeImpostor(renderer: THREE.WebGLRenderer, sp: Species, res: number): { map: THREE.Texture; normal: THREE.Texture } {
  const W = res;
  const H = Math.round(W / sp.wFrac);
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(sp.geo, sp.bakeAlbedo);
  scene.add(mesh);
  const half = (sp.height * sp.wFrac) / 2;
  const cam = new THREE.OrthographicCamera(-half, half, sp.height, 0, -60, 60);
  cam.position.set(0, 0, 30);
  cam.lookAt(0, 0, 0);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const out: THREE.Texture[] = [];
  for (const [mats, clear] of [
    [sp.bakeAlbedo, new THREE.Color(0.05, 0.08, 0.04)],
    [sp.bakeNormal, new THREE.Color(0.5, 0.5, 1)],
  ] as [THREE.Material[], THREE.Color][]) {
    mesh.material = mats;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    rt.texture.colorSpace = mats === sp.bakeAlbedo ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    renderer.setRenderTarget(rt);
    // edge texels average with the clear colour: a foliage tone (not black) avoids dark fringes
    renderer.setClearColor(clear, 0);
    renderer.clear();
    renderer.render(scene, cam);
    out.push(rt.texture);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  return { map: out[0], normal: out[1] };
}

/** Camera-facing (cylindrical) card for the far trees; the instance matrix gives position, yaw and scale. */
function impostorMaterial(map: THREE.Texture, normal: THREE.Texture | null, alphaToCoverage: boolean): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide });
  m.alphaToCoverage = alphaToCoverage;
  m.onBeforeCompile = (sh) => {
    if (normal) sh.uniforms.apxNormal = { value: normal };
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vApxR;\nvoid main() {')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace(
        '#include <project_vertex>',
        `vec3 apxC = instanceMatrix[3].xyz;
float apxS = length(instanceMatrix[1].xyz);
vec3 apxR = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]) + vec3(1e-5, 0.0, 0.0));
vApxR = apxR;
vec3 apxW = apxC + apxR * position.x * length(instanceMatrix[0].xyz) + vec3(0.0, position.y * apxS, 0.0);
vec4 mvPosition = viewMatrix * vec4(apxW, 1.0);
gl_Position = projectionMatrix * mvPosition;`,
      );
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', alphaMipFix(0.12, 3));
    if (normal)
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform sampler2D apxNormal;\nvarying vec3 vApxR;\nvoid main() {').replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 tn = texture2D(apxNormal, vMapUv).xyz * 2.0 - 1.0;
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 wn = normalize(vApxR * tn.x + up * tn.y + cross(vApxR, up) * tn.z);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
      );
  };
  m.customProgramCacheKey = () => `forest-impostor-${alphaToCoverage}-${!!normal}`;
  return m;
}

export class Forest {
  readonly root = new THREE.Group();
  private meta: Grid;
  private x: Float32Array;
  private y: Float32Array;
  private z: Float32Array;
  private s: Float32Array;
  private yaw: Float32Array;
  private type: Uint8Array;
  private keep: Float32Array; // per-tree hash 0..1 for density thinning
  private tint: Float32Array; // per-tree brightness variation
  private slim: Float32Array; // per-tree crown width / height ratio factor
  /** Species index of each tree (a spruce variant or the broadleaf). */
  private kind: Uint8Array;
  private species: Species[] = [];
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private lastQ: QualityConfig | null = null;

  private constructor(trees: TreeArrays, grid: Grid) {
    this.meta = grid;
    const n = trees.x.length;
    ({ x: this.x, y: this.y, z: this.z, s: this.s, yaw: this.yaw, type: this.type } = trees);
    const pinned = trees.pinned;
    this.keep = new Float32Array(n);
    this.tint = new Float32Array(n);
    this.slim = new Float32Array(n);
    this.kind = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      // density thinning drops trees with keep > density: trackside trees are always kept
      this.keep[i] = pinned[i] ? 0 : ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      this.tint[i] = 0.8 + 0.4 * (((h >>> 8) & 255) / 255);
      this.slim[i] = 0.78 + 0.4 * (((h >>> 20) & 255) / 255);
    }
    this.root.name = 'forest';
  }

  /** The map's scattered forest (if any) and its trackside trees (null when there are neither). */
  static async load(
    ref: ForestRef | undefined,
    extra: CardTree[],
    renderer: THREE.WebGLRenderer,
    onBytes: (n: number) => void,
    q: QualityConfig,
  ): Promise<Forest | null> {
    try {
      const models = loadTreeModels();
      let base: TreeArrays | null = null;
      if (ref) {
        const [meta, raw] = await Promise.all([fetch(url(ref.meta)).then((r) => r.json() as Promise<ForestMeta>), fetchWithProgress(ref.file, onBytes)]);
        base = parseForest(meta, raw);
      }
      if (!base && !extra.length) return null;
      const { trees, grid } = mergeTrees(base, extra);
      const f = new Forest(trees, grid);
      f.build(renderer, await models, q);
      return f;
    } catch (e) {
      console.warn('forest not loaded', e);
      return null;
    }
  }

  /** Spruces and maple from the models; the procedural trees when they are missing. */
  private makeSpecies(models: Awaited<ReturnType<typeof loadTreeModels>>): void {
    const fromModel = (node: string, height: number, tint: THREE.Color, nearShare: number): Species | null => {
      if (!models) return null;
      const parts = modelParts(models, node);
      if (!parts.length) return null;
      // bark first, then leaves
      parts.sort((a, b) => Number(a.alpha) - Number(b.alpha));
      const shaded = parts.map((p) => ({ geo: p.geometry.scale(height, height, height), leaf: p.alpha }));
      shadeTree(shaded);
      const geo = mergeParts(shaded.map((p) => p.geo));
      for (const p of shaded) p.geo.dispose();
      const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
      const wFrac = (Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) * 2 * 1.04) / height;
      const white = new THREE.Color(1, 1, 1);
      return {
        geo,
        mats: parts.map((p) => nearMaterial(p.map, p.alpha ? tint : white.clone().multiplyScalar(0.8), p.alpha, height)),
        bakeAlbedo: parts.map((p) => bakeAlbedoMaterial(p.map, p.alpha ? tint : white.clone().multiplyScalar(0.8), p.alpha)),
        bakeNormal: parts.map((p) => bakeNormalMaterial(p.map, p.alpha)),
        height,
        wFrac,
        nearShare,
      };
    };
    const spruces = [0, 1, 2].map((k) => fromModel(`spruce_${k}`, SPRUCE_H, SPRUCE_TINT, 1)).filter((s): s is Species => !!s);
    const maple = fromModel('maple', BEECH_H, MAPLE_TINT, 0.4);
    if (spruces.length && maple) {
      this.species = [...spruces, maple];
      const nS = spruces.length;
      for (let i = 0; i < this.kind.length; i++) this.kind[i] = this.type[i] ? nS : Math.floor(this.keep[i] * 7919) % nS;
      return;
    }
    // procedural fallback: one spruce, one beech
    const map = foliageTexture();
    const proc = (geo: THREE.BufferGeometry, height: number, wFrac: number): Species => {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map });
      return {
        geo,
        mats: [mat],
        bakeAlbedo: [new THREE.MeshBasicMaterial({ vertexColors: true, map })],
        bakeNormal: [bakeNormalMaterial(null, false)],
        height,
        wFrac,
        nearShare: 1,
      };
    };
    this.species = [proc(spruceGeometry(), SPRUCE_H, 0.48), proc(beechGeometry(), BEECH_H, 0.74)];
    for (let i = 0; i < this.kind.length; i++) this.kind[i] = this.type[i];
  }

  private build(renderer: THREE.WebGLRenderer, models: Awaited<ReturnType<typeof loadTreeModels>>, q: QualityConfig): void {
    this.makeSpecies(models);
    const card = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    // impostor resolution: sharper cards on presets that draw them closer
    const res = q.forestNear >= 100 ? 256 : 128;
    for (const [k, sp] of this.species.entries()) {
      const near = new THREE.InstancedMesh(sp.geo, sp.mats.length > 1 ? sp.mats : sp.mats[0], 1);
      near.frustumCulled = false;
      near.count = 0;
      near.name = `forest_near_${k}`;
      const tex = bakeImpostor(renderer, sp, res);
      // the card covers the bake's frame
      const g = card.clone().scale(sp.height * sp.wFrac, sp.height, 1);
      const far = new THREE.InstancedMesh(g, impostorMaterial(tex.map, tex.normal, false), 1);
      far.frustumCulled = false;
      far.count = 0;
      far.name = `forest_far_${k}`;
      this.near.push(near);
      this.far.push(far);
      this.root.add(near, far);
    }
    for (const sp of this.species) for (const m of [...sp.bakeAlbedo, ...sp.bakeNormal]) m.dispose();
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
      for (const m of this.far) (m.material as THREE.MeshLambertMaterial).alphaToCoverage = q.antialias === 'msaa';
      this.lastQ = q;
    }
    const S = this.species.length;
    const nearD2 = this.species.map((sp) => (q.forestNear * sp.nearShare) ** 2);
    const farD = q.forestFar;
    const farD2 = farD * farD;
    const { cell, origin, nx, nz, cells } = this.meta;
    const ci0 = Math.max(0, Math.floor((cam.x - farD - origin[0]) / cell));
    const ci1 = Math.min(nx - 1, Math.floor((cam.x + farD - origin[0]) / cell));
    const cj0 = Math.max(0, Math.floor((cam.z - farD - origin[1]) / cell));
    const cj1 = Math.min(nz - 1, Math.floor((cam.z + farD - origin[1]) / cell));
    // pass 1: count, pass 2: write (avoids growing arrays per frame)
    const nN = new Array<number>(S).fill(0);
    const nF = new Array<number>(S).fill(0);
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
          const t = this.kind[i];
          if (d2 <= nearD2[t]) {
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
    for (let t = 0; t < S; t++) {
      this.near[t] = this.ensureCapacity(this.near[t], nN[t]);
      this.far[t] = this.ensureCapacity(this.far[t], nF[t]);
    }
    const counts = [nN.slice(), nF.slice()];
    nN.fill(0);
    nF.fill(0);
    visit(true);
    for (let t = 0; t < S; t++) {
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
      for (const x of [m.material].flat()) x.dispose();
      m.dispose();
    }
  }
}
