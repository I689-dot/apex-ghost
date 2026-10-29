import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { parseGltf } from './assets';

/**
 * Shared vegetation assets (tools/asset-pipeline/vegetation.mjs → public/assets/vegetation): the spruces and the
 * maple of the forest.
 * They are small (~0.5 MB) and part of the app bundle, so they always come from the page itself, never from
 * VITE_ASSET_BASE: the mobile app has them offline from the first launch.
 */
export const VEG_BASE = `${import.meta.env.BASE_URL}assets/vegetation/`;

let trees: Promise<GLTF | null> | null = null;

async function load(file: string): Promise<GLTF | null> {
  try {
    const res = await fetch(`${VEG_BASE}${file}`);
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    return await parseGltf(await res.arrayBuffer());
  } catch (e) {
    console.warn('[vegetation] not loaded, using the procedural fallback', e);
    return null;
  }
}

export function loadTreeModels(): Promise<GLTF | null> {
  trees ??= load('trees.glb');
  return trees;
}

/** Wind shared by every swaying material: time (s) and strength (0 calm … ~2 storm). Updated by the session. */
export const WIND = { time: { value: 0 }, strength: { value: 1 } };

/** One mesh part of a model: float geometry in model space (node transform and UV transform baked) and its texture. */
export interface ModelPart {
  geometry: THREE.BufferGeometry;
  map: THREE.Texture | null;
  alpha: boolean;
  name: string;
}

/**
 * Parts of a named node of a loaded glTF. The pipeline quantises meshes (normalised integers + a node scale) and
 * texture coordinates (KHR_texture_transform); instancing needs plain float geometry in the model's own space.
 */
const partCache = new WeakMap<GLTF, Map<string, ModelPart[]>>();

export function modelParts(gltf: GLTF, node: string): ModelPart[] {
  let byNode = partCache.get(gltf);
  if (!byNode) partCache.set(gltf, (byNode = new Map()));
  let parts = byNode.get(node);
  if (!parts) byNode.set(node, (parts = extractParts(gltf, node)));
  // callers own (scale, dispose) their geometry
  return parts.map((p) => ({ ...p, geometry: p.geometry.clone() }));
}

function extractParts(gltf: GLTF, node: string): ModelPart[] {
  const root = gltf.scene.getObjectByName(node);
  if (!root) return [];
  // the models sit at the origin of their scene; the node transforms left are the quantisation's (dequantise)
  gltf.scene.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const m = mesh.matrixWorld;
    const src = mesh.geometry;
    const pos = src.getAttribute('position');
    const nor = src.getAttribute('normal');
    const uv = src.getAttribute('uv');
    const n = pos.count;
    const P = new Float32Array(n * 3);
    const N = new Float32Array(n * 3);
    const U = new Float32Array(n * 2);
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const uvm = new THREE.Matrix3();
    if (mat.map) {
      mat.map.updateMatrix();
      uvm.copy(mat.map.matrix);
    }
    const t = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      P.set([v.x, v.y, v.z], i * 3);
      if (nor) {
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        N.set([v.x, v.y, v.z], i * 3);
      }
      if (uv) {
        t.set(uv.getX(i), uv.getY(i), 1).applyMatrix3(uvm);
        U[i * 2] = t.x;
        U[i * 2 + 1] = t.y;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    const idx = src.getIndex();
    if (idx) g.setIndex(Array.from(idx.array as ArrayLike<number>));
    if (!nor) g.computeVertexNormals();
    if (mat.map) {
      // the UV transform is now in the geometry
      mat.map.offset.set(0, 0);
      mat.map.repeat.set(1, 1);
      mat.map.rotation = 0;
      mat.map.updateMatrix();
      mat.map.colorSpace = THREE.SRGBColorSpace;
    }
    parts.push({ geometry: g, map: mat.map ?? null, alpha: mat.alphaTest > 0 || mat.transparent, name: mat.name });
  });
  return parts;
}

/** Merge geometries (same attributes) into one with a group per part. */
export function mergeParts(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv', 'color'].filter((a) => geos.every((g) => g.getAttribute(a)));
  const out = new THREE.BufferGeometry();
  let vtx = 0;
  const index: number[] = [];
  let start = 0;
  geos.forEach((g, k) => {
    const idx = g.getIndex();
    const count = idx ? idx.count : g.getAttribute('position').count;
    for (let i = 0; i < count; i++) index.push((idx ? idx.getX(i) : i) + vtx);
    out.addGroup(start, count, k);
    start += count;
    vtx += g.getAttribute('position').count;
  });
  for (const a of names) {
    const size = geos[0].getAttribute(a).itemSize;
    const arr = new Float32Array(vtx * size);
    let o = 0;
    for (const g of geos) {
      const src = g.getAttribute(a);
      for (let i = 0; i < src.count; i++) for (let c = 0; c < size; c++) arr[o++] = src.getComponent(i, c);
    }
    out.setAttribute(a, new THREE.BufferAttribute(arr, size));
  }
  out.setIndex(index);
  out.computeBoundingSphere();
  return out;
}

/**
 * Sway in the wind (vertex shader, after `transformed` is set): the whole plant bends with the square of the height
 * (`bend` m of tip travel per m² of height), its leaves flutter (`flutter` m). Each instance gets its own phase
 * from its position, so a forest doesn't move in lockstep.
 */
export function windChunk(bend: number, flutter: number): string {
  return /* glsl */ `
  {
    #ifdef USE_INSTANCING
    vec2 apxRoot = instanceMatrix[3].xz;
    #else
    vec2 apxRoot = vec2(0.0);
    #endif
    float apxPh = dot(apxRoot, vec2(0.071, 0.113));
    float apxT = apxWindTime;
    float apxH = max(transformed.y, 0.0);
    float apxGust = 0.6 + 0.4 * sin(apxT * 0.37 + apxPh * 0.2);
    float apxSway = (sin(apxT * 1.1 + apxPh) * 0.7 + sin(apxT * 2.3 + apxPh * 1.7) * 0.3) * apxGust * apxWind;
    transformed.x += apxSway * apxH * apxH * ${bend.toExponential(3)};
    transformed.z += apxSway * 0.4 * apxH * apxH * ${bend.toExponential(3)};
    float apxF = sin(apxT * 6.5 + dot(transformed, vec3(2.3, 1.7, 2.9)) + apxPh) * ${flutter.toFixed(4)} * apxWind * min(apxH, 1.0);
    transformed += vec3(apxF, apxF * 0.5, -apxF * 0.7);
  }`;
}

/** Adds the wind uniforms to a shader (onBeforeCompile). */
export function addWindUniforms(sh: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }): void {
  sh.uniforms.apxWindTime = WIND.time;
  sh.uniforms.apxWind = WIND.strength;
  sh.vertexShader = sh.vertexShader.replace('void main() {', 'uniform float apxWindTime;\nuniform float apxWind;\nvoid main() {');
}

/**
 * Alpha-tested foliage thins out with distance: in the smaller mip levels a blade's alpha averages below the cut-off
 * and whole tufts vanish. Scaling alpha up with the mip level keeps the coverage (Ben Golus, "Anti-aliased
 * alpha test"). `k` per mip level, capped at `maxLod` levels: thin blades need it most; sparse leaf cards little,
 * or their empty areas (mip alpha ~0.2) turn into visible panes. Replaces `#include <alphatest_fragment>`.
 */
export function alphaMipFix(k: number, maxLod: number): string {
  return /* glsl */ `
#ifdef USE_MAP
{
  vec2 apxTs = vec2(textureSize(map, 0));
  vec2 apxDx = dFdx(vMapUv * apxTs);
  vec2 apxDy = dFdy(vMapUv * apxTs);
  float apxLod = clamp(0.5 * log2(max(dot(apxDx, apxDx), dot(apxDy, apxDy))), 0.0, ${maxLod.toFixed(1)});
  diffuseColor.a *= 1.0 + apxLod * ${k.toFixed(3)};
}
#endif
#include <alphatest_fragment>`;
}
