import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { nearestCenterlineIndex, progressAt, type Surface, type TrackData } from '@apex/shared';
import { fetchWithProgress, loadCollision, parseGltf, type CollisionMesh } from './assets';
import { RAY_GROUPS, TRACK_GROUPS, type GroundHit, type GroundQuery } from '../physics/vehicle';
import type { QualityConfig } from '../settings';

type R = typeof RAPIER;

/** Large areas whose small texture tile repeats visibly: they get world-space macro variation. */
const GROUND_MAT_RE = /^(grass|top2|terrain_fill|astroturf|sand|gravel)/i;
const PAVED_MAT_RE = /^(asph|conc_|pavement|pits|concrete|paddock_roof|ponyva|tiles)/i;

/**
 * The source model's asphalt and concrete textures are nearly uniform (pixel deviation 1–4 of 255: the original
 * game added detail and wear maps the export does not carry), so large paved areas looked untextured. A procedural
 * detail texture adds the grain back: multi-scale noise for the binder and light/dark speckles for the aggregate,
 * tiled in world space (about 1.6 m).
 */
let detailTex: THREE.DataTexture | null = null;
function pavedDetail(): THREE.DataTexture {
  if (detailTex) return detailTex;
  const N = 256;
  const d = new Uint8Array(N * N * 4);
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const lattice = (f: number) => {
    const g = new Float32Array((f + 1) * (f + 1)).map(() => rnd());
    for (let i = 0; i <= f; i++) {
      g[i * (f + 1) + f] = g[i * (f + 1)];
      g[f * (f + 1) + i] = g[i];
    }
    return (x: number, y: number) => {
      const fx = (x / N) * f;
      const fy = (y / N) * f;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (a: number, b: number) => g[(b % (f + 1)) * (f + 1) + (a % (f + 1))];
      return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
    };
  };
  const o1 = lattice(8);
  const o2 = lattice(32);
  const o3 = lattice(128);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0.45 * o1(x, y) + 0.3 * o2(x, y) + 0.25 * o3(x, y);
      const r = rnd();
      if (r < 0.035)
        v += 0.35; // light stone
      else if (r < 0.07) v -= 0.3; // dark pore
      const b = Math.max(0, Math.min(255, Math.round(v * 255)));
      const k = (y * N + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = b;
      d[k + 3] = 255;
    }
  detailTex = new THREE.DataTexture(d, N, N);
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.magFilter = THREE.LinearFilter;
  detailTex.minFilter = THREE.LinearMipmapLinearFilter;
  detailTex.generateMipmaps = true;
  detailTex.anisotropy = 8;
  detailTex.needsUpdate = true;
  return detailTex;
}

/**
 * Macro variation (as racing games break texture tiling): the colour is modulated by two octaves of smooth
 * value noise in world space, metres to tens of metres across, plus a slight dry/lush hue drift on grass. Paved
 * surfaces get a weaker, greyer version (patches of newer and older asphalt).
 */
function addMacroVariation(m: THREE.MeshStandardMaterial, strength: number, hue: boolean, detail = 0): void {
  m.onBeforeCompile = (sh) => {
    if (detail > 0) sh.uniforms.apxDetail = { value: pavedDetail() };
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vApxW;\nvoid main() {')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvApxW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vApxW;
${detail > 0 ? 'uniform sampler2D apxDetail;' : ''}
float apxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float apxNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(apxHash(i), apxHash(i + vec2(1.0, 0.0)), f.x), mix(apxHash(i + vec2(0.0, 1.0)), apxHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec2 wp = vApxW.xz;
  float n = apxNoise(wp / 37.0) * 0.65 + apxNoise(wp / 9.0) * 0.35;
  diffuseColor.rgb *= 1.0 + (n - 0.5) * ${(strength * 2).toFixed(2)};
  ${hue ? 'float d = apxNoise(wp / 61.0 + 7.3); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.04, 0.78), smoothstep(0.55, 0.9, d) * 0.6);' : ''}
  ${detail > 0 ? `float g = texture2D(apxDetail, wp / 1.6).r * 0.6 + texture2D(apxDetail, wp / 7.3 + 0.37).r * 0.4; diffuseColor.rgb *= 1.0 + (g - 0.5) * ${(detail * 2).toFixed(2)};` : ''}
}`,
      );
  };
  m.customProgramCacheKey = () => `macro-${strength}-${hue}-${detail}`;
}

const ROAD_MAT_RE = /^(asph|curb|lines|redline|pits|conc_|travert_0|box_decal|pavement)/i;
const LIGHT_MAT_RE = /^(lights_emissive|lights_0)/i;
/** Small, dense trackside detail: invisible far away, so culled per mesh by distance. */
const DETAIL_MAT_RE =
  /^(galvanized|fence|fences_b|details|metals|signs|marshal|stairs|handle|spons|speaker|box_fence|electric_box|tent|medical|building|plastic_cone|tuv|logos|garage_spons)/i;
/**
 * Flat ground pieces exported among the scenery (the drainage grates along the track edges, kerb bits). There is
 * no ground under them, so when distance culling hid them the sky showed through as white strips along the
 * track ("missing textures"): they always draw, like the road (tools/e2e/trackscan.mjs).
 */
const GROUND_PIECE_RE = /^(grille|curb_misc)/i;

interface Chunk {
  object: THREE.Object3D;
  kind: string;
  center: THREE.Vector3;
  radius: number;
}

/** Loaded track: render scene, collision, and centreline helpers. */
export class Track {
  readonly root = new THREE.Group();
  readonly chunks: Chunk[] = [];
  private details: { mesh: THREE.Mesh; center: THREE.Vector3; radius: number }[] = [];
  readonly roadMaterials: { mat: THREE.MeshStandardMaterial; color: THREE.Color; roughness: number }[] = [];
  readonly lightMaterials: THREE.MeshStandardMaterial[] = [];
  readonly startLights: { red: THREE.MeshStandardMaterial[]; green: THREE.MeshStandardMaterial[] } = { red: [], green: [] };
  private colliderSurface = new Map<number, Surface>();
  private ray: RAPIER.Ray | null = null;
  /** The local car body, excluded from wheel ray casts. */
  excludeBody: RAPIER.RigidBody | undefined;

  constructor(readonly data: TrackData) {
    this.root.name = 'track';
  }

  static async load(data: TrackData, onBytes: (n: number) => void): Promise<{ track: Track; collision: CollisionMesh[] }> {
    const t = new Track(data);
    const files = [...new Set(data.chunks.map((c) => c.file))];
    const scenes = await Promise.all(files.map(async (f) => ({ f, g: await parseGltf(await fetchWithProgress(f, onBytes)) })));
    const collision = await loadCollision(data, onBytes);
    for (const { g } of scenes) {
      g.scene.updateMatrixWorld(true);
      t.root.add(g.scene);
    }
    for (const c of data.chunks) {
      const obj = t.root.getObjectByName(c.node);
      if (!obj) continue;
      t.chunks.push({ object: obj, kind: c.kind, center: new THREE.Vector3(...c.center), radius: c.radius });
    }
    // ground pieces leave their (culled) scenery chunk for an always-visible group
    const ground = new THREE.Group();
    ground.name = 'ground_pieces';
    const pieces: THREE.Mesh[] = [];
    t.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m0 = mesh.isMesh ? ([mesh.material].flat()[0] as THREE.Material | undefined) : undefined;
      if (m0 && GROUND_PIECE_RE.test(m0.name)) pieces.push(mesh);
    });
    t.root.add(ground);
    for (const m of pieces) ground.attach(m);
    const seen = new Set<THREE.Material>();
    t.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const kind = t.chunks.find((c) => c.object === mesh || c.object === mesh.parent)?.kind ?? 'scenery';
      mesh.receiveShadow = kind !== 'trees' && kind !== 'terrain';
      mesh.castShadow = kind === 'scenery' || kind === 'trees';
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm.isMeshStandardMaterial) continue;
        // Export slips: one grass material is fully metallic (a dark mirror on High/Ultra, where scenery is PBR),
        // and the main racing asphalt (asph_003) is glossier than the rest (0.80): a wet-looking glare lobe down
        // every straight towards the sun on a dry track. Dry asphalt and grass are rough dielectrics.
        if (GROUND_MAT_RE.test(sm.name)) sm.metalness = 0;
        if (/^asph/i.test(sm.name)) sm.roughness = Math.max(sm.roughness, 0.9);
        if (ROAD_MAT_RE.test(sm.name)) t.roadMaterials.push({ mat: sm, color: sm.color.clone(), roughness: sm.roughness });
        if (LIGHT_MAT_RE.test(sm.name)) t.lightMaterials.push(sm);
        if (/^red_lights/i.test(sm.name)) t.startLights.red.push(sm);
        if (/^green_lights/i.test(sm.name)) t.startLights.green.push(sm);
        sm.side = sm.alphaTest > 0 || sm.transparent ? THREE.DoubleSide : THREE.FrontSide;
        if (GROUND_MAT_RE.test(sm.name) || sm.name === 'grass_fill') addMacroVariation(sm, 0.22, /grass|top2|fill|turf/i.test(sm.name));
        else if (PAVED_MAT_RE.test(sm.name)) addMacroVariation(sm, 0.08, false, /^(paddock_roof|ponyva)/i.test(sm.name) ? 0.12 : 0.22);
      }
      const first = mats[0] as THREE.MeshStandardMaterial | undefined;
      if (first && DETAIL_MAT_RE.test(first.name)) {
        mesh.geometry.computeBoundingSphere();
        const bs = mesh.geometry.boundingSphere as THREE.Sphere;
        const center = bs.center.clone().applyMatrix4(mesh.matrixWorld);
        t.details.push({ mesh, center, radius: bs.radius });
      }
    });
    return { track: t, collision };
  }

  /** Build Rapier trimesh colliders; one per surface sub-mesh. */
  buildColliders(R: R, world: RAPIER.World, meshes: CollisionMesh[]): void {
    for (const m of meshes) {
      const desc = R.ColliderDesc.trimesh(m.positions, m.indices)
        .setCollisionGroups(TRACK_GROUPS)
        .setFriction(m.surface === 'wall' ? 0.25 : 0.8)
        .setRestitution(m.surface === 'wall' ? 0.15 : 0.0);
      const col = world.createCollider(desc);
      this.colliderSurface.set(col.handle, m.surface);
    }
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  surfaceOf(handle: number): Surface | undefined {
    return this.colliderSurface.get(handle);
  }

  /** Ground query for the wheels (excludes `excludeBody`, the local car). */
  groundQuery(world: RAPIER.World): GroundQuery {
    return {
      cast: (ox, oy, oz, dx, dy, dz, maxDist, out: GroundHit) => {
        const ray = this.ray;
        if (!ray) return null;
        ray.origin.x = ox;
        ray.origin.y = oy;
        ray.origin.z = oz;
        ray.dir.x = dx;
        ray.dir.y = dy;
        ray.dir.z = dz;
        const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, RAY_GROUPS);
        if (!hit) return null;
        const toi = hit.timeOfImpact;
        out.dist = toi;
        out.px = ox + dx * toi;
        out.py = oy + dy * toi;
        out.pz = oz + dz * toi;
        let nx = hit.normal.x;
        let ny = hit.normal.y;
        let nz = hit.normal.z;
        if (nx * dx + ny * dy + nz * dz > 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        out.nx = nx;
        out.ny = ny;
        out.nz = nz;
        out.surface = this.colliderSurface.get(hit.collider.handle) ?? 'asphalt';
        return out;
      },
    };
  }

  /** Tree shadows are expensive (alpha-tested foliage): only on presets that want them. */
  private lambert = new Map<THREE.Material, THREE.MeshLambertMaterial>();

  applyQuality(q: QualityConfig): void {
    for (const c of this.chunks) {
      const cast = c.kind === 'trees' ? q.treeShadows : c.kind === 'scenery' ? q.sceneryShadows : false;
      c.object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = cast;
        mesh.userData.pbr ??= mesh.material;
        const pbr = mesh.userData.pbr as THREE.Material | THREE.Material[];
        if (q.pbrScenery) {
          mesh.material = pbr;
          mesh.receiveShadow = c.kind !== 'trees' && c.kind !== 'terrain';
          return;
        }
        // cheap path: Lambert for everything except the road surface; only the track receives shadows
        const swap = (m: THREE.Material): THREE.Material => (ROAD_MAT_RE.test(m.name) ? m : this.lambertOf(m));
        mesh.material = Array.isArray(pbr) ? pbr.map(swap) : swap(pbr);
        mesh.receiveShadow = c.kind === 'track';
      });
    }
  }

  private lambertOf(m: THREE.Material): THREE.Material {
    const sm = m as THREE.MeshStandardMaterial;
    if (!sm.isMeshStandardMaterial) return m;
    let l = this.lambert.get(m);
    if (!l) {
      l = new THREE.MeshLambertMaterial({
        name: sm.name,
        map: sm.map,
        color: sm.color,
        emissive: sm.emissive,
        emissiveMap: sm.emissiveMap,
        emissiveIntensity: sm.emissiveIntensity,
        alphaTest: sm.alphaTest,
        transparent: sm.transparent,
        opacity: sm.opacity,
        side: sm.side,
        vertexColors: sm.vertexColors,
      });
      this.lambert.set(m, l);
      // keep night lamps / start lights working with the cheap material too
      if (this.lightMaterials.includes(sm)) this.lightLambert.push(l);
      if (this.startLights.red.includes(sm)) this.startLambert.red.push(l);
      if (this.startLights.green.includes(sm)) this.startLambert.green.push(l);
    }
    return l;
  }

  private lightLambert: THREE.MeshLambertMaterial[] = [];
  private startLambert: { red: THREE.MeshLambertMaterial[]; green: THREE.MeshLambertMaterial[] } = { red: [], green: [] };

  /** All standard materials of the track (for reflection environment assignment). */
  materials(): THREE.MeshStandardMaterial[] {
    const set = new Set<THREE.MeshStandardMaterial>();
    this.root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial) set.add(x as THREE.MeshStandardMaterial);
    });
    return [...set];
  }

  /** Distance culling of heavy chunks (frustum culling is done by three.js per mesh). */
  updateVisibility(camPos: THREE.Vector3, q: QualityConfig): void {
    for (const c of this.chunks) {
      if (c.kind === 'track' || c.kind === 'terrain') continue;
      const max = c.kind === 'trees' ? q.treeDistance : q.sceneryDistance;
      c.object.visible = c.center.distanceTo(camPos) - c.radius < max;
    }
    for (const d of this.details) d.mesh.visible = d.center.distanceTo(camPos) - d.radius < q.detailDistance;
  }

  /** Make every chunk visible (shader/texture warm-up). */
  showAll(): void {
    for (const c of this.chunks) c.object.visible = true;
    for (const d of this.details) d.mesh.visible = true;
  }

  /** Darker, glossier asphalt as the track gets wet. */
  applyWetness(w: number, envIntensity = 1): void {
    for (const r of this.roadMaterials) {
      r.mat.color.copy(r.color).multiplyScalar(1 - 0.38 * w);
      r.mat.roughness = r.roughness * (1 - 0.62 * w);
      r.mat.envMapIntensity = (1 + 1.4 * w) * envIntensity;
    }
  }

  setNight(nightFactor: number): void {
    for (const m of this.lightMaterials) m.emissiveIntensity = 0.3 + 4 * nightFactor;
    for (const m of this.lightLambert) m.emissiveIntensity = 0.3 + 4 * nightFactor;
  }

  /** Start lights: n red lamps lit (0..5), or green. */
  setStartLights(red: boolean, green: boolean): void {
    for (const m of [...this.startLights.red, ...this.startLambert.red]) m.emissiveIntensity = red ? 6 : 0.05;
    for (const m of [...this.startLights.green, ...this.startLambert.green]) m.emissiveIntensity = green ? 6 : 0.05;
  }

  /* --------------------------------------------------- centreline --- */

  private hint = -1;

  /** Progress along the lap (m), heading alignment (dot of car fwd and track dir), lateral offset. */
  locate(x: number, y: number, z: number, fx: number, fz: number, out: { s: number; dot: number; index: number; lateral: number }): void {
    const d = this.data;
    const i = nearestCenterlineIndex(d, x, y, z, this.hint, 30);
    this.hint = i;
    out.index = i;
    out.s = progressAt(d, i, x, z);
    const cl = d.centerline;
    const n = cl.length / 3;
    const j = (i + 1) % n;
    let tx = cl[j * 3] - cl[i * 3];
    let tz = cl[j * 3 + 2] - cl[i * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const fl = Math.hypot(fx, fz) || 1;
    out.dot = (fx * tx + fz * tz) / fl;
    out.lateral = (x - cl[i * 3]) * tz - (z - cl[i * 3 + 2]) * tx;
  }

  resetHint(): void {
    this.hint = -1;
  }

  /** Position and heading on the centreline at distance s. */
  pointAt(s: number, out: { x: number; y: number; z: number; yaw: number }): void {
    const d = this.data;
    const L = d.length;
    s = ((s % L) + L) % L;
    let lo = 0;
    let hi = d.cumS.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (d.cumS[m] <= s) lo = m;
      else hi = m - 1;
    }
    const n = d.cumS.length;
    const i = lo;
    const j = (i + 1) % n;
    const segLen = (j === 0 ? L : d.cumS[j]) - d.cumS[i];
    const u = segLen > 0 ? (s - d.cumS[i]) / segLen : 0;
    const cl = d.centerline;
    out.x = cl[i * 3] + (cl[j * 3] - cl[i * 3]) * u;
    out.y = cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * u;
    out.z = cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * u;
    out.yaw = Math.atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]);
  }
}
