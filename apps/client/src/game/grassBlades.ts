import * as THREE from 'three';
import type { TrackData } from '@apex/shared';
import type { GroundHit, GroundQuery } from '../physics/vehicle';
import { lawnDetail, lawnMean } from './track';
import type { GrassMask } from './grassMask';

/**
 * Real blades over the verge's lawn (High/Ultra), on top of the shells (grassShells.ts). Shells make a dense mown
 * carpet but have no outline: from a driver's eye, a few cm above the ground and looking across it, a lawn is
 * blades against the light. So near the camera, open-world games add blade geometry (Ghost of Tsushima's procedural
 * grass, GDC 2021, and its open reimplementations):
 *  - each tuft a clump of curved, tapering blades of geometry (opaque: no alpha test to shimmer, MSAA smooths them),
 *    every blade its own height, lean, curl and shade; mown short right by the track, longer further out (the
 *    strips by the fences are cut less often);
 *  - normals rounded across each blade and bent towards the sky (a field is lit like a field, not like thousands
 *    of little walls); roots dark, tips lighter and drier;
 *  - sunlight through the blades when the sun is behind them (thin leaves transmit green light);
 *  - wind as gusts travelling across the field (scrolling noise) plus a flutter, stronger in rain; cars passing
 *    close push and flatten the blades;
 *  - on the GPU: positions in static buffers per stretch of track, rotated, scaled, swayed and faded by the vertex
 *    shader (the blades shrink into the shells towards the radius: no line where they end).
 * Placed at load on the grass found by ray casts, denser right at the edge.
 */

/** One chunk per this much centreline (m): culled as a whole. */
const CHUNK_M = 60;
/** Cars that bend the grass around them (the nearest to the camera). */
export const GRASS_CARS = 6;
const MAX_TUFTS = 1_400_000;

export interface BladeDetail {
  /** Blades per tuft. */
  blades: number;
  /** Tufts per m² right at the edge (fewer further out). */
  perM2: number;
  /** Width of the strip beside the edge (m). */
  band: number;
}

/** What the session tells the grass every frame. */
export interface GrassFrame {
  time: number;
  /** Wind over the ground (m/s, x/z). */
  windX: number;
  windZ: number;
  wet: number;
  /** Sun direction (world, towards the sun) and its light (colour × intensity). */
  sunDir: THREE.Vector3;
  sunLight: THREE.Color;
  camera: THREE.Camera;
  /** Cars near the camera: x, z, push strength (0..1, from speed); d: the caller's (distance², for picking). */
  cars: { x: number; z: number; push: number; d: number }[];
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/**
 * A clump of `n` blades, `h0`…`h1` m tall. uv.y = height along the blade (0 root … 1 tip). Colours per blade: the
 * dull green of a mown verge (low saturation), some yellower, some bluer.
 */
function tuftGeometry(n: number, seed: number, h0: number, h1: number): THREE.BufferGeometry {
  const r = rng(seed);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const SEG = 4;
  const c = new THREE.Color();
  for (let b = 0; b < n; b++) {
    // clumped: most blades near the centre of the tuft
    const rad = 0.18 * Math.sqrt(r()) * (0.4 + 0.6 * r());
    const at = r() * Math.PI * 2;
    const bx = Math.cos(at) * rad;
    const bz = Math.sin(at) * rad;
    const face = r() * Math.PI;
    const fx = Math.cos(face);
    const fz = Math.sin(face);
    const h = h0 + r() * (h1 - h0);
    const w = 0.006 + r() * 0.007 + h * 0.025;
    // leaning away from the clump's centre, curling over towards the tip
    const leanA = at + (r() - 0.5) * 1.2;
    const lean = (0.12 + r() * 0.45) * h;
    const lx = Math.cos(leanA);
    const lz = Math.sin(leanA);
    // the lawn's green (as the shells draw it: deep, fairly saturated), a few yellower and a few bluer
    c.setHSL((84 + r() * 18) / 360, 0.42 + r() * 0.16, 0.13 + r() * 0.07);
    if (r() < 0.08) c.offsetHSL(-0.03, 0.04, 0.05); // a dry one here and there
    const base = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const y = h * (t - 0.18 * t * t * (lean / h));
      const ox = bx + lx * lean * t * t;
      const oz = bz + lz * lean * t * t;
      const hw = w * Math.pow(1 - t, 0.75) * 0.5;
      // the blade's face normal (horizontal, across its width), bent back as it leans, rounded across it
      const nx = -fz;
      const nz = fx;
      for (const side of k === SEG ? [0.5] : [0, 1]) {
        const sgn = side === 0.5 ? 0 : side * 2 - 1;
        pos.push(ox + fx * hw * sgn, y, oz + fz * hw * sgn);
        const round = 0.45 * sgn;
        nrm.push(nx + fx * round, 0.35 + 0.4 * t, nz + fz * round);
        uv.push(side, t);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let k = 0; k < SEG - 1; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const a = base + (SEG - 1) * 2;
    idx.push(a, a + 2, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.normalizeNormals();
  return g;
}

const VERT_HEAD = /* glsl */ `
attribute vec4 aInst;
attribute float aScale;
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uCam;
uniform float uRadius;
uniform vec4 uCars[${GRASS_CARS}];
varying float vGrassH;
varying float vGrassDry;
varying vec2 vGrassXZ;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 gRot(vec2 v, float a) { float c = cos(a); float s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
`;

const VERT_BEGIN = /* glsl */ `
vec3 transformed = position * aScale;
transformed.xz = gRot(transformed.xz, aInst.w);
float gh = uv.y;
vec2 gp = aInst.xz;
// fade: shrink into the lawn towards the edge of the radius
float gFade = 1.0 - smoothstep(uRadius * 0.6, uRadius, distance(gp, uCam.xz));
// gusts travelling downwind, plus a quick flutter of each blade
float gWind = length(uWind);
vec2 gDir = gWind > 0.01 ? uWind / gWind : vec2(1.0, 0.0);
float gust = gNoise(gp * 0.06 - uWind * uTime * 0.09) * 1.4 + gNoise(gp * 0.31 - uWind * uTime * 0.35) * 0.4;
float flutter = sin(uTime * (2.6 + gWind * 0.5) + gp.x * 1.9 + gp.y * 1.3 + position.x * 31.0 + position.z * 17.0);
vec2 disp = gDir * (gWind * 0.006 * (0.3 + gust) + flutter * 0.0035 * (0.4 + gWind * 0.35));
// cars brushing past push the blades away and flatten them
for (int i = 0; i < ${GRASS_CARS}; i++) {
  vec2 dv = gp - uCars[i].xy;
  float dl = length(dv) + 1e-3;
  disp += dv / dl * uCars[i].z * 0.16 * (1.0 - smoothstep(0.6, 3.4, dl));
}
disp *= gh * gh * aScale * 4.0;
float gBend = length(disp);
transformed.xz += disp;
transformed.y = max(0.0, transformed.y - gBend * 0.55) * gFade;
transformed += aInst.xyz;
vGrassH = gh;
vGrassXZ = gp;
vGrassDry = gHash(floor(gp * 0.35)) * 0.6 + gHash(gp) * 0.4;
`;

const FRAG_HEAD = /* glsl */ `
uniform vec3 uSunView;
uniform vec3 uSunLight;
uniform float uWet;
uniform sampler2D uLawn;
uniform vec3 uLawnMean;
varying float vGrassH;
varying float vGrassDry;
varying vec2 vGrassXZ;
`;

/** The blades beside one layout: one mesh per stretch of track, shown within the radius. */
export class GrassBlades {
  readonly mesh = new THREE.Group();
  private chunks: { mesh: THREE.Mesh; x: number; z: number; r: number }[] = [];
  private readonly uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(1, 0) },
    uCam: { value: new THREE.Vector3() },
    uRadius: { value: 40 },
    uCars: { value: Array.from({ length: GRASS_CARS }, () => new THREE.Vector4(1e9, 1e9, 0, 0)) },
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
    uSunLight: { value: new THREE.Vector3(1, 1, 1) },
    uWet: { value: 0 },
    // the lawn photo the ground is textured with (track.ts), at the same scales: a blade takes the colour of the
    // patch it grows from, so blades and ground show the same lighter and darker patches
    uLawn: { value: lawnDetail() },
    uLawnMean: lawnMean,
  };
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.78, metalness: 0 });

  private constructor() {
    this.material.name = 'grass_blades';
    const u = this.uniforms;
    this.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', VERT_BEGIN);
      sh.fragmentShader = (FRAG_HEAD + sh.fragmentShader)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          // shaded at the root (the blades shade each other), lighter and drier at the tips; darker when wet
          vec3 gLawn = texture2D(uLawn, vGrassXZ / 3.2).rgb * 0.65 + texture2D(uLawn, mat2(0.8, -0.6, 0.6, 0.8) * vGrassXZ / 11.3 + 0.37).rgb * 0.35;
          diffuseColor.rgb *= mix(vec3(1.0), gLawn / max(uLawnMean, vec3(0.02)), 0.75);
          diffuseColor.rgb *= mix(0.7, 1.08, pow(vGrassH, 0.8));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.06, 0.8), vGrassDry * vGrassH * 0.35);
          diffuseColor.rgb *= 1.0 - 0.28 * uWet;`,
        )
        .replace(
          '#include <normal_fragment_begin>',
          /* glsl */ `#include <normal_fragment_begin>
          // a field is lit from the sky: most of the way to "up", whichever side of a blade we see (the backs of
          // blades leaning away read as black strokes at half way)
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.7));`,
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `#include <lights_fragment_end>
          // sunlight through the blades when the sun is behind them
          float gT = pow(max(dot(-normalize(vViewPosition), uSunView), 0.0), 3.0);
          reflectedLight.directDiffuse += uSunLight * diffuseColor.rgb * vec3(0.9, 1.15, 0.55) * gT * (0.15 + 0.85 * vGrassH) * 0.32;`,
        );
    };
    this.material.customProgramCacheKey = () => 'grass-blades';
  }

  /** Blades on this layout's verges (null: no grass found). */
  static build(track: TrackData, ground: GroundQuery, detail: BladeDetail, mask: GrassMask | null = null): GrassBlades | null {
    const r = rng(4242);
    const cl = track.centerline;
    const n = cl.length / 3;
    const hit: GroundHit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
    const band = detail.band;
    // fewer per m² on long layouts, so the 25 km one stays within MAX_TUFTS
    const perM2 = Math.max(1, Math.min(detail.perM2, MAX_TUFTS / (track.length * 2 * band * 0.55)));
    const grass = new GrassBlades();
    // three kinds of tuft: mown short by the edge, a little longer, and the uncut grass further out
    const tufts = [tuftGeometry(detail.blades, 7, 0.06, 0.13), tuftGeometry(detail.blades, 8, 0.08, 0.17), tuftGeometry(detail.blades, 9, 0.13, 0.32)];
    const chunks: number[][] = [[], [], []];
    let chunkFrom = 0;
    let total = 0;
    const flush = () => {
      chunks.forEach((chunk, kind) => {
        if (!chunk.length) return;
        const tuft = tufts[kind];
        const count = chunk.length / 5;
        const geo = new THREE.InstancedBufferGeometry();
        for (const k of ['position', 'normal', 'uv', 'color']) geo.setAttribute(k, tuft.getAttribute(k));
        geo.setIndex(tuft.getIndex());
        const inst = new Float32Array(count * 4);
        const scale = new Float32Array(count);
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        let sy = 0;
        for (let i = 0; i < count; i++) {
          for (let k = 0; k < 4; k++) inst[i * 4 + k] = chunk[i * 5 + k];
          scale[i] = chunk[i * 5 + 4];
          minX = Math.min(minX, chunk[i * 5]);
          maxX = Math.max(maxX, chunk[i * 5]);
          minZ = Math.min(minZ, chunk[i * 5 + 2]);
          maxZ = Math.max(maxZ, chunk[i * 5 + 2]);
          sy += chunk[i * 5 + 1];
        }
        geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
        geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
        geo.instanceCount = count;
        const x = (minX + maxX) / 2;
        const z = (minZ + maxZ) / 2;
        const rad = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 1;
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, sy / count, z), rad + 2);
        const m = new THREE.Mesh(geo, grass.material);
        m.name = 'grass-blades';
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.visible = false;
        grass.mesh.add(m);
        grass.chunks.push({ mesh: m, x, z, r: rad });
        chunks[kind] = [];
      });
    };
    let along = 0;
    for (let i = 0; i < n && total < MAX_TUFTS; i++) {
      const j = (i + 1) % n;
      const dx = cl[j * 3] - cl[i * 3];
      const dz = cl[j * 3 + 2] - cl[i * 3 + 2];
      const seg = Math.hypot(dx, dz);
      if (!seg) continue;
      const tx = dx / seg;
      const tz = dz / seg;
      for (let a = 0; a < seg; a += 1) {
        for (const side of [1, -1]) {
          // clear of the white line and the kerb: blades right on it read as black specks over the paint
          const edge = (side > 0 ? (track.limitL?.[i] ?? track.widthL[i]) : (track.limitR?.[i] ?? track.widthR[i])) + 0.9;
          for (let off = edge; off < edge + band; off += 1) {
            const x = cl[i * 3] + tx * a + tz * off * side;
            const z = cl[i * 3 + 2] + tz * a - tx * off * side;
            if (mask?.covers(x, z)) continue;
            if (!ground.cast(x, cl[i * 3 + 1] + 4, z, 0, -1, 0, 12, hit) || hit.surface !== 'grass' || hit.ny < 0.8) continue;
            // thicker right at the edge, where the driver looks
            const far = (off - edge) / band;
            const here = Math.floor(perM2 * (1.35 - 0.75 * far) + r());
            for (let k = 0; k < here; k++) {
              const px = x + r() - 0.5;
              const pz = z + r() - 0.5;
              if (mask?.covers(px, pz)) continue;
              // mown near the track; past ~60 % of the strip more and more of it uncut
              const kind = far < 0.25 ? 0 : far < 0.6 ? (r() < 0.8 ? 1 : 0) : r() < (far - 0.5) * 1.4 ? 2 : 1;
              const py = hit.py - (hit.nx * (px - x) + hit.nz * (pz - z)) / Math.max(0.5, hit.ny) - 0.01;
              chunks[kind].push(px, py, pz, r() * Math.PI * 2, 0.75 + r() * 0.5);
            }
            total += here;
          }
        }
      }
      along += seg;
      if (along - chunkFrom >= CHUNK_M) {
        flush();
        chunkFrom = along;
      }
    }
    flush();
    return total ? grass : null;
  }

  /** Show the chunks within `radius` m of the camera (0: hidden). */
  update(cam: THREE.Vector3, radius: number): void {
    this.mesh.visible = radius > 0;
    if (radius <= 0) return;
    this.uniforms.uCam.value.copy(cam);
    this.uniforms.uRadius.value = radius;
    for (const c of this.chunks) c.mesh.visible = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 < (radius + c.r) ** 2;
  }

  /** Wind, wetness, sunlight and the cars brushing the grass, once a frame. */
  frame(f: GrassFrame): void {
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uTime.value = f.time;
    u.uWind.value.set(f.windX, f.windZ);
    u.uWet.value = f.wet;
    u.uSunView.value.copy(f.sunDir).transformDirection(f.camera.matrixWorldInverse);
    u.uSunLight.value.set(f.sunLight.r, f.sunLight.g, f.sunLight.b);
    this.material.roughness = 0.78 - 0.4 * f.wet;
    for (let i = 0; i < GRASS_CARS; i++) {
      const c = f.cars[i];
      u.uCars.value[i].set(c ? c.x : 1e9, c ? c.z : 1e9, c ? c.push : 0, 0);
    }
  }

  dispose(): void {
    for (const c of this.chunks) c.mesh.geometry.dispose();
  }
}
