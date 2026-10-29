import * as THREE from 'three';
import type { TrackData } from '@apex/shared';
import type { QualityConfig } from '../settings';
import { addWindUniforms } from './vegetation';

/**
 * Mown grass with depth on the verges (shell texturing, as racing games grow short lawns): the lawn near the camera is
 * drawn again in `grassShells` thin layers stacked up to SHELL_H above the ground. A blade height field (512 px, ~1.2 m
 * across, the blades tapering to points) decides per pixel and layer whether a blade reaches that high, so the stack
 * reads as dense blades with dark roots and light tips, seen side-on from the cockpit with real parallax.
 *
 *  - The shells use the verge's own material (its texture, the macro variation and the lawn photo detail of
 *    track.ts), so blades and ground match.
 *  - Built once at load from the lawn triangles within ~110 m of the racing line, in world space, grouped in 24 m cells;
 *    each frame only the cells within `grassShellRadius` of the camera are drawn, all layers of a cell in one
 *    instanced draw, lowest layer first. The shells don't write depth (painted bottom-up like a height field): with
 *    depth, screen-space AO took every gap between blades for a crevice and sprinkled the lawn with black dots.
 *  - The ground under the blades is darkened near the camera (SHELL_GROUND, read by track.ts): soil and shade
 *    between the blades, so the lit blades stand out.
 *  - The layers thin out towards the radius (the upper ones first), so the blades shorten into the flat lawn.
 */

const SHELL_H = 0.075;
const MAX_SHELLS = 16;
const CELL = 24;
const NEAR_TRACK = 110;
/** The shell radius for the lawn's ground shader (0: no shells, no darkening). */
export const SHELL_GROUND = { value: 0 };

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** R: blade height (tapering: each blade is a small cone in the field), G: per-blade colour variation. */
function bladeTexture(): THREE.DataTexture {
  const N = 512;
  const h = new Float32Array(N * N);
  const g = new Float32Array(N * N).fill(0.5);
  const r = rng(9091);
  for (let k = 0; k < 42000; k++) {
    const cx = r() * N;
    const cy = r() * N;
    // most blades near the mowing height, a few shorter ones and a few that escaped the mower
    const height = Math.min(1, 0.55 + r() * 0.4 + (r() < 0.04 ? 0.25 : 0));
    const rad = 1.1 + r() * 1.3;
    const tone = r();
    // a blade is a little elongated in a random direction
    const a = r() * Math.PI;
    const ex = Math.cos(a);
    const ey = Math.sin(a);
    for (let y = Math.floor(cy - rad * 2); y <= cy + rad * 2; y++)
      for (let x = Math.floor(cx - rad * 2); x <= cx + rad * 2; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const along = dx * ex + dy * ey;
        const across = -dx * ey + dy * ex;
        const d = Math.hypot(along / 1.8, across) / rad;
        if (d >= 1) continue;
        const i = ((y + N) % N) * N + ((x + N) % N);
        const v = height * (1 - d * d);
        if (v > h[i]) {
          h[i] = v;
          g[i] = tone;
        }
      }
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(h[i] * 255);
    data[i * 4 + 1] = Math.round(g[i] * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

interface Cell {
  mesh: THREE.InstancedMesh;
  x: number;
  z: number;
}

export class GrassShells {
  readonly root = new THREE.Group();
  private cells: Cell[] = [];
  private readonly radius = { value: 0 };
  private readonly count = { value: 1 };
  private last = new THREE.Vector3(Infinity, 0, 0);
  private lastQ: QualityConfig | null = null;
  private lastN = -1;

  /** Shells over the lawn of these meshes near the racing line (null: no lawn). */
  static build(trackRoot: THREE.Object3D, lawn: Set<THREE.Material>, track: TrackData): GrassShells | null {
    if (!lawn.size) return null;
    // cells within NEAR_TRACK of the centreline
    const near = new Set<number>();
    const key = (x: number, z: number) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
    const cl = track.centerline;
    const reach = Math.ceil(NEAR_TRACK / CELL);
    for (let i = 0; i < cl.length; i += 3 * 4)
      for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) near.add(key(cl[i] + dx * CELL, cl[i + 2] + dz * CELL));
    // lawn triangles, world space, by (material, cell)
    const groups = new Map<THREE.Material, Map<number, { p: number[]; n: number[]; uv: number[] }>>();
    const v = new THREE.Vector3();
    const nv = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    trackRoot.updateMatrixWorld(true);
    trackRoot.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = [mesh.material].flat()[0] as THREE.Material;
      if (!lawn.has(mat)) return;
      const geo = mesh.geometry;
      const pos = geo.getAttribute('position');
      const nor = geo.getAttribute('normal');
      const uv = geo.getAttribute('uv');
      if (!nor || !uv) return;
      const idx = geo.getIndex();
      const e = mesh.matrixWorld.elements;
      nm.getNormalMatrix(mesh.matrixWorld);
      const count = idx ? idx.count : pos.count;
      let byCell = groups.get(mat);
      if (!byCell) groups.set(mat, (byCell = new Map()));
      for (let i = 0; i < count; i += 3) {
        let cx = 0;
        let cz = 0;
        for (let k = 0; k < 3; k++) {
          const a = idx ? idx.getX(i + k) : i + k;
          const x = pos.getX(a);
          const y = pos.getY(a);
          const z = pos.getZ(a);
          cx += e[0] * x + e[4] * y + e[8] * z + e[12];
          cz += e[2] * x + e[6] * y + e[10] * z + e[14];
        }
        const ck = key(cx / 3, cz / 3);
        if (!near.has(ck)) continue;
        let g = byCell.get(ck);
        if (!g) byCell.set(ck, (g = { p: [], n: [], uv: [] }));
        for (let k = 0; k < 3; k++) {
          const a = idx ? idx.getX(i + k) : i + k;
          v.fromBufferAttribute(pos, a).applyMatrix4(mesh.matrixWorld);
          nv.fromBufferAttribute(nor, a).applyMatrix3(nm).normalize();
          g.p.push(v.x, v.y, v.z);
          g.n.push(nv.x, nv.y, nv.z);
          g.uv.push(uv.getX(a), uv.getY(a));
        }
      }
    });
    const s = new GrassShells();
    const blades = bladeTexture();
    for (const [mat, byCell] of groups) {
      const shellMat = s.material(mat as THREE.MeshStandardMaterial, blades);
      for (const g of byCell.values()) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
        geo.computeBoundingSphere();
        (geo.boundingSphere as THREE.Sphere).radius += SHELL_H;
        const mesh = new THREE.InstancedMesh(geo, shellMat, MAX_SHELLS);
        mesh.name = 'grass-shells';
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        mesh.visible = false;
        s.root.add(mesh);
        const c = (geo.boundingSphere as THREE.Sphere).center;
        s.cells.push({ mesh, x: c.x, z: c.z });
      }
    }
    s.root.name = 'grass-shells';
    return s.cells.length ? s : null;
  }

  /** The verge's material (same texture and colour variation) with the shell offset and the blade cut-out. */
  private material(src: THREE.MeshStandardMaterial, blades: THREE.Texture): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ name: `${src.name}_shells`, map: src.map, color: src.color, depthWrite: false });
    const base = src.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      base.call(src, sh, r);
      sh.uniforms.apxBlades = { value: blades };
      // the ground's darkening is for the ground under the blades, not for the blades
      sh.uniforms.apxShellGround = { value: 0 };
      sh.uniforms.apxShellR = this.radius;
      sh.uniforms.apxShellN = this.count;
      addWindUniforms(sh);
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'uniform float apxShellN;\nvarying float vApxL;\nvarying vec3 vApxShellW;\nvoid main() {')
        .replace(
          '#include <project_vertex>',
          `// lowest layer first
float apxL = (float(gl_InstanceID) + 1.0) / apxShellN;
vec4 apxWp = modelMatrix * vec4(transformed, 1.0);
apxWp.xyz += normalize(mat3(modelMatrix) * objectNormal) * apxL * ${SHELL_H.toFixed(3)};
// the tips sway in the wind
float apxS = sin(apxWindTime * 1.9 + apxWp.x * 0.7 + apxWp.z * 0.45) + 0.5 * sin(apxWindTime * 3.3 + apxWp.z * 1.3);
apxWp.xz += vec2(0.8, 0.5) * apxS * 0.006 * apxWind * apxL * apxL;
vApxL = apxL;
vApxShellW = apxWp.xyz;
vec4 mvPosition = viewMatrix * apxWp;
gl_Position = projectionMatrix * mvPosition;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform sampler2D apxBlades;\nuniform float apxShellR;\nvarying float vApxL;\nvarying vec3 vApxShellW;\nvoid main() {')
        .replace(
          '#include <alphatest_fragment>',
          `{
  vec2 apxP = vApxShellW.xz;
  vec4 apxB1 = texture2D(apxBlades, apxP / 1.2);
  vec4 apxB2 = texture2D(apxBlades, mat2(0.6, -0.8, 0.8, 0.6) * apxP / 0.83 + 0.31);
  float apxBh = max(apxB1.r, apxB2.r * 0.93);
  float apxFade = 1.0 - smoothstep(apxShellR * 0.5, apxShellR, distance(vApxShellW, cameraPosition));
  // no blade this high here, or beyond what the distance fade leaves: the upper layers go first
  if (apxBh < vApxL || vApxL > apxFade) discard;
  // dark roots inside the sward, lighter tips, a little colour per blade
  diffuseColor.rgb *= mix(0.62, 1.3, vApxL * vApxL) * mix(0.86, 1.12, apxB1.g);
}
#include <alphatest_fragment>`,
        );
    };
    m.customProgramCacheKey = () => `grass-shells-${src.customProgramCacheKey()}`;
    return m;
  }

  /** Show the cells around the camera (after it moved a few metres, or when the preset changed). */
  update(cam: THREE.Vector3, q: QualityConfig, hide = false): void {
    const n = hide ? 0 : Math.min(MAX_SHELLS, q.grassShells);
    if (q !== this.lastQ || n !== this.lastN) {
      this.lastQ = q;
      this.lastN = n;
      this.last.set(Infinity, 0, 0);
      this.radius.value = q.grassShellRadius;
      SHELL_GROUND.value = n ? q.grassShellRadius : 0;
      this.count.value = Math.max(1, n);
      for (const c of this.cells) c.mesh.count = n;
    }
    if (!n) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    if (cam.distanceToSquared(this.last) < 9) return;
    this.last.copy(cam);
    const reach = (q.grassShellRadius + CELL * 0.75) ** 2;
    for (const c of this.cells) c.mesh.visible = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 < reach;
  }

  dispose(): void {
    for (const c of this.cells) c.mesh.geometry.dispose();
  }
}
