import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { nearestCenterlineIndex, progressAt, type Surface, type TrackData } from '@apex/shared';
import { fetchWithProgress, loadCollision, parseGltf, type CollisionMesh } from './assets';
import { RAY_GROUPS, TRACK_GROUPS, WALL_GROUPS, type GroundHit, type GroundQuery } from '../physics/vehicle';
import type { QualityConfig } from '../settings';
import type { CardTree, Forest } from './forest';
import { VEG_BASE } from './vegetation';
import { SHELL_GROUND } from './grassShells';
import { STRUCTURE_MASK, STRUCTURE_PUSH } from './grassMask';
import { cutWallsAcrossLine } from './wallCut';
import { RoadPatches } from './roadPatches';

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
 * Gravel traps and sand: the source textures are flat tan tiles. A pebble tile (~0.3 m) of rounded stones with a
 * light top and a dark gap around each, so the trap reads as loose stones from the cockpit.
 */
let gravelTex: THREE.DataTexture | null = null;
function gravelDetail(): THREE.DataTexture {
  if (gravelTex) return gravelTex;
  const N = 256;
  const v = new Float32Array(N * N).fill(0.36);
  let seed = 8675309;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let k = 0; k < 1400; k++) {
    const cx = rnd() * N;
    const cy = rnd() * N;
    const rad = 2.5 + rnd() * 6;
    const tone = 0.45 + rnd() * 0.4;
    for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++)
      for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
        const dd = Math.hypot(x - cx, (y - cy) * 1.25) / rad;
        const i = ((y + N) % N) * N + ((x + N) % N);
        // lit from above: brighter towards the top of each stone, a dark rim where it meets the next
        if (dd < 1) v[i] = Math.max(v[i], tone + 0.18 * (1 - dd) - 0.12 * ((y - cy) / rad));
        else if (dd < 1.25) v[i] = Math.min(v[i], 0.22);
      }
  }
  const d = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const c = Math.max(0, Math.min(255, Math.round(v[i] * 255)));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = c;
    d[i * 4 + 3] = 255;
  }
  gravelTex = new THREE.DataTexture(d, N, N);
  gravelTex.wrapS = gravelTex.wrapT = THREE.RepeatWrapping;
  gravelTex.magFilter = THREE.LinearFilter;
  gravelTex.minFilter = THREE.LinearMipmapLinearFilter;
  gravelTex.generateMipmaps = true;
  gravelTex.anisotropy = 8;
  gravelTex.needsUpdate = true;
  return gravelTex;
}

let lawnTex: THREE.Texture | null = null;
/** Mean colour of the lawn tile: the shader divides by it, so the tile adds texture, not a colour cast. */
export const lawnMean = { value: new THREE.Vector3(0.5, 0.5, 0.5) };

/**
 * Mown lawn as seen from a race car: the source grass texture is a 256 px tile that turns to green mush within a few
 * metres, so a real lawn modulates it: assets/vegetation/lawn.jpg, a seamless top-down render of a photogrammetry
 * scan of a mown lawn (tools/asset-pipeline/vegetation.mjs). Flat grey until it has loaded.
 */
export function lawnDetail(): THREE.Texture {
  if (lawnTex) return lawnTex;
  const grey = document.createElement('canvas');
  grey.width = grey.height = 4;
  const gg = grey.getContext('2d') as CanvasRenderingContext2D;
  gg.fillStyle = '#808080';
  gg.fillRect(0, 0, 4, 4);
  const tex = new THREE.Texture(grey);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  lawnTex = tex;
  const photo = new Image();
  photo.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const cg = c.getContext('2d') as CanvasRenderingContext2D;
    cg.drawImage(photo, 0, 0, 32, 32);
    const px = cg.getImageData(0, 0, 32, 32).data;
    const m = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) m[k] += px[i + k] / 255 / (32 * 32);
    lawnMean.value.set(m[0], m[1], m[2]);
    tex.image = photo;
    tex.needsUpdate = true;
  };
  photo.src = `${VEG_BASE}lawn.jpg`;
  return tex;
}

/**
 * Photo-scanned surface detail (CC0, ambientCG: Asphalt031 for the racing asphalt, Concrete034 for walls, stands and
 * buildings; tools: see assets/textures/LICENSE.txt): one map each, R = albedo detail around mid-grey, G/B = the
 * normal's x/y. Layered in world space over the map's own 256 px tiles, which turn to flat grey mush within metres:
 * the aggregate of the asphalt, its glints and its relief, the grain and blotches of concrete.
 */
const TEX_BASE = `${import.meta.env.BASE_URL}assets/textures/`;
const photoDetails = new Map<string, { value: THREE.Texture }>();
function photoDetail(name: string): { value: THREE.Texture } {
  let u = photoDetails.get(name);
  if (u) return u;
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  flat.needsUpdate = true;
  u = { value: flat as THREE.Texture };
  photoDetails.set(name, u);
  const slot = u;
  new THREE.TextureLoader().load(`${TEX_BASE}${name}.jpg`, (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 16;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    slot.value = tex;
  });
  return u;
}

/** Walls, stands, buildings: concrete grain (full) and metal (half), triplanar in world space. */
const STRUCT_DETAIL_RE =
  /^(building|concrete_0|walls_new|wall_|openstand|stairs|gs_roof|garage_0|sound_barriers|box_struct|marshal|timetower|rockwall|medical|tuv|paddock)/i;
const METAL_DETAIL_RE = /^(galvanized|grail|metal_white|metals_|metal_wall|gantry|fence_green|fences_b|box_fence)/i;

function addStructureDetail(m: THREE.MeshStandardMaterial, strength: number): void {
  const base = m.onBeforeCompile;
  const baseKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    sh.uniforms.apxConc = photoDetail('concrete_detail');
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vApxSW;\nvarying vec3 vApxSN;\nvoid main() {')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvApxSW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvApxSN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform sampler2D apxConc;\nvarying vec3 vApxSW;\nvarying vec3 vApxSN;\nvec2 apxSDn = vec2(0.0);\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec3 w = pow(abs(normalize(vApxSN)), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec3 p = vApxSW / 1.9;
  vec3 tx = texture2D(apxConc, p.zy).rgb;
  vec3 ty = texture2D(apxConc, p.xz).rgb;
  vec3 tz = texture2D(apxConc, p.xy).rgb;
  vec3 t = tx * w.x + ty * w.y + tz * w.z;
  // large, soft blotches (weathering) over the fine grain
  vec3 q = vApxSW / 7.3;
  float big = texture2D(apxConc, q.xz + q.y * 0.37).r * w.y + texture2D(apxConc, q.zy).r * w.x + texture2D(apxConc, q.xy).r * w.z;
  diffuseColor.rgb *= 1.0 + ((t.r - 0.5) * 1.1 + (big - 0.5) * 0.9) * ${strength.toFixed(2)};
  apxSDn = (t.gb * 2.0 - 1.0) * ${(strength * 0.8).toFixed(2)};
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // the grain's relief, fading out with distance (sub-pixel there)
  float fade = 1.0 - smoothstep(25.0, 90.0, length(vViewPosition));
  vec3 n = normalize(vApxSN);
  vec3 tA = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 tB = cross(n, tA);
  normal = normalize(normal + mat3(viewMatrix) * (tA * apxSDn.x + tB * apxSDn.y) * fade);
}`,
      );
  };
  m.customProgramCacheKey = () => `${baseKey()}-struct${strength}`;
}

/**
 * Macro variation (as racing games break texture tiling): the colour is modulated by two octaves of smooth
 * value noise in world space, metres to tens of metres across, plus a slight dry/lush hue drift on grass. Paved
 * surfaces get a weaker, greyer version (patches of newer and older asphalt).
 */
function addMacroVariation(
  m: THREE.MeshStandardMaterial,
  strength: number,
  hue: boolean,
  detail = 0,
  kind: 'grass' | 'gravel' | 'paved' | 'asphalt' = 'paved',
): void {
  const asphalt = kind === 'asphalt';
  const grass = kind === 'grass';
  // detail tile sizes (m): fine and coarse
  const [fine, coarse] = grass ? [3.2, 11.3] : kind === 'gravel' ? [0.32, 1.25] : [1.6, 7.3];
  m.onBeforeCompile = (sh) => {
    if (detail > 0)
      sh.uniforms.apxDetail = asphalt ? photoDetail('asphalt_detail') : { value: grass ? lawnDetail() : kind === 'gravel' ? gravelDetail() : pavedDetail() };
    if (detail > 0 && grass) {
      sh.uniforms.apxDetailMean = lawnMean;
      sh.uniforms.apxShellGround = SHELL_GROUND;
    }
    if (hue) {
      sh.uniforms.apxStruct = STRUCTURE_MASK.tex;
      sh.uniforms.apxStructRect = STRUCTURE_MASK.rect;
    }
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vApxW;\nvoid main() {')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvApxW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vApxW;
${detail > 0 ? 'uniform sampler2D apxDetail;' : ''}
${detail > 0 && grass ? 'uniform vec3 apxDetailMean;\nuniform float apxShellGround;' : ''}
${hue ? 'uniform sampler2D apxStruct;\nuniform vec4 apxStructRect;\nuniform mat4 projectionMatrix;' : ''}
${asphalt ? 'vec2 apxADn = vec2(0.0);\nfloat apxAAlb = 0.0;' : ''}
float apxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float apxNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(apxHash(i), apxHash(i + vec2(1.0, 0.0)), f.x), mix(apxHash(i + vec2(0.0, 1.0)), apxHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {`,
      )
      .replace(
        '#include <logdepthbuf_fragment>',
        hue
          ? `#include <logdepthbuf_fragment>
{
  // under a grandstand or building (grassMask.ts): drawn further back, so the structure sunk into this ground wins
  vec2 apxSu = (vApxW.xz - apxStructRect.xy) * apxStructRect.zw;
  float apxIn = all(greaterThanEqual(apxSu, vec2(0.0))) && all(lessThan(apxSu, vec2(1.0))) ? texture2D(apxStruct, apxSu).r : 0.0;
  vec3 apxVp = -vViewPosition;
  vec4 apxClip = projectionMatrix * vec4(apxVp * (1.0 + ${STRUCTURE_PUSH.toFixed(2)} * apxIn / max(length(apxVp), 0.1)), 1.0);
  gl_FragDepth = apxIn > 0.5 ? clamp(apxClip.z / apxClip.w * 0.5 + 0.5, 0.0, 1.0) : gl_FragCoord.z;
}`
          : '#include <logdepthbuf_fragment>',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec2 wp = vApxW.xz;
  float n = apxNoise(wp / 37.0) * 0.65 + apxNoise(wp / 9.0) * 0.35;
  diffuseColor.rgb *= 1.0 + (n - 0.5) * ${(strength * 2).toFixed(2)};
  ${hue ? 'float d = apxNoise(wp / 61.0 + 7.3); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.04, 0.78), smoothstep(0.55, 0.9, d) * 0.6);' : ''}
  ${
    detail > 0 && grass
      ? `vec3 g = texture2D(apxDetail, wp / ${fine.toFixed(2)}).rgb * 0.65 + texture2D(apxDetail, mat2(0.8, -0.6, 0.6, 0.8) * wp / ${coarse.toFixed(2)} + 0.37).rgb * 0.35;
  vec3 gr = g / max(apxDetailMean, vec3(0.02));
  gr = mix(vec3(dot(gr, vec3(0.3, 0.5, 0.2))), gr, 0.7);
  diffuseColor.rgb *= mix(vec3(1.0), gr, ${Math.min(1, detail * 2.7).toFixed(2)});
  // mowing stripes, 6 m wide, the blades of each laid the opposite way: a band looks light seen with the grain and
  // dark against it, so the pattern changes with the viewing direction like on a real circuit
  vec2 apxSd = vec2(0.8, 0.6);
  float apxS = fract(dot(wp, apxSd) / 12.0);
  float apxLay = (smoothstep(0.0, 0.03, apxS) - smoothstep(0.5, 0.53, apxS)) * 2.0 - 1.0;
  vec3 apxV = normalize(vApxW - cameraPosition);
  float apxAlong = dot(normalize(apxV.xz + vec2(1e-4)), apxSd);
  diffuseColor.rgb *= 1.0 + apxLay * (0.06 + 0.13 * apxAlong * (1.0 - abs(apxV.y) * 0.6));
  // a lusher, deeper green
  diffuseColor.rgb *= vec3(0.93, 1.03, 0.86);
  // under the 3D blades near the camera (grassShells.ts): soil and shade between them
  if (apxShellGround > 0.0) diffuseColor.rgb *= 1.0 - 0.12 * (1.0 - smoothstep(apxShellGround * 0.5, apxShellGround, distance(vApxW, cameraPosition)));`
      : asphalt && detail > 0
        ? `// photo asphalt (Asphalt031): the aggregate at two scales, its relief and its glints
  vec3 a1 = texture2D(apxDetail, wp / 3.8).rgb;
  vec3 a2 = texture2D(apxDetail, mat2(0.8, -0.6, 0.6, 0.8) * wp / 11.3 + 0.41).rgb;
  apxAAlb = (a1.r * 0.62 + a2.r * 0.38) - 0.5;
  diffuseColor.rgb *= 1.0 + apxAAlb * ${(detail * 4.5).toFixed(2)};
  apxADn = (vec2(a1.g, a1.b) * 0.62 + vec2(a2.g, a2.b) * 0.38) * 2.0 - 1.0;`
        : detail > 0
          ? `float g = texture2D(apxDetail, wp / ${fine.toFixed(2)}).r * 0.6 + texture2D(apxDetail, wp / ${coarse.toFixed(2)} + 0.37).r * 0.4; diffuseColor.rgb *= 1.0 + (g - 0.5) * ${(detail * 2).toFixed(2)};`
          : ''
  }
}`,
      );
    if (asphalt)
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <roughnessmap_fragment>',
          // the stones polished by tyres catch the light, the binder between them stays matt
          '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (1.0 - apxAAlb * 0.55), 0.04, 1.0);',
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
{
  float fade = 1.0 - smoothstep(18.0, 70.0, length(vViewPosition));
  normal = normalize(normal + mat3(viewMatrix) * vec3(apxADn.x, 0.0, -apxADn.y) * 0.55 * fade);
}`,
        );
  };
  m.customProgramCacheKey = () => `macro-${strength}-${hue}-${detail}-${kind}-s`;
}

/**
 * Depth layers of the circuit's flat parts (measured with tools/e2e/decalheight.mjs on the GP: of the paint's
 * vertices 5 % lie under the asphalt and 39 % within a centimetre of it, of the kerbs 32 % under it and 92 % within a
 * centimetre; Zandvoort's are lower). Under the road the lines broke into dashes; level with it they flickered with distance. Paint and kerbs
 * are drawn a little higher (world up, in the shader: the collision, and so the physics, are untouched) and pulled
 * forwards in depth; adverts are pulled forwards off the barriers they are printed on; grass and terrain pushed
 * back, under the asphalt they meet.
 */
const DECAL_LAYERS: [RegExp, { lift: number; offset: number }][] = [
  // (Zandvoort's paint is lower still: 28 % under its asphalt, the lowest twentieth 4 cm under)
  [/^(lines|redline|box_decal|nurb_decal)/i, { lift: 0.035, offset: -2 }],
  [/^curb/i, { lift: 0.045, offset: -1 }],
  [/^(adv|spons|logos_wall|dorint_spons|garage_spons|signs|display)/i, { lift: 0, offset: -2 }],
  [/^(grass|grassbrd|grassblock|astroturf|sandbrd|travert_grass)/i, { lift: 0, offset: 1 }],
  [/^(top2|terrain_fill|grass_fill)/i, { lift: 0, offset: 2 }],
];

function applyDecalLayer(sm: THREE.MeshStandardMaterial): void {
  const layer = DECAL_LAYERS.find(([re]) => re.test(sm.name))?.[1];
  if (!layer) return;
  sm.polygonOffset = true;
  sm.polygonOffsetFactor = layer.offset;
  sm.polygonOffsetUnits = layer.offset * 4;
  if (!layer.lift) return;
  const base = sm.onBeforeCompile;
  const baseKey = sm.customProgramCacheKey.bind(sm);
  sm.onBeforeCompile = (sh, r) => {
    base.call(sm, sh, r);
    sh.vertexShader = sh.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 apxLift = modelMatrix * vec4(transformed, 1.0);
apxLift.y += ${layer.lift.toFixed(3)};
vec4 mvPosition = viewMatrix * apxLift;
gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  sm.customProgramCacheKey = () => `${baseKey()}-lift${layer.lift}`;
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
/**
 * Low vertical barriers along the road (guard rails, tyre walls, pit wall): under a pixel tall beyond ~1.5 km, but
 * on the 24 km layout the whole GP is in view from the Nordschleife, so they're culled per mesh at barrierDistance.
 */
const BARRIER_MAT_RE = /^(grail|tyrewall|walls_new|wall_pitlane)/i;
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
  chunks: Chunk[] = [];
  private details: { mesh: THREE.Mesh; center: THREE.Vector3; radius: number }[] = [];
  private barriers: { mesh: THREE.Mesh; center: THREE.Vector3; radius: number }[] = [];
  readonly roadMaterials: { mat: THREE.MeshStandardMaterial; color: THREE.Color; roughness: number }[] = [];
  readonly lightMaterials: THREE.MeshStandardMaterial[] = [];
  readonly startLights: { red: THREE.MeshStandardMaterial[]; green: THREE.MeshStandardMaterial[] } = { red: [], green: [] };
  private colliderSurface = new Map<number, Surface>();
  private ray: RAPIER.Ray | null = null;
  /** The local car body, excluded from wheel ray casts. */
  excludeBody: RAPIER.RigidBody | undefined;
  /** The mown grass of the verges and infields (grassShells.ts grows blades on it). */
  readonly lawnMaterials = new Set<THREE.MeshStandardMaterial>();
  /** Every ground surface (grass, gravel, terrain, paving): not structures (grassMask.ts). */
  readonly groundMaterials = new Set<THREE.Material>();
  /** Procedural forest around the circuit (null when the map has none or it failed to load). */
  forest: Forest | null = null;

  setForest(f: Forest): void {
    this.forest = f;
    this.root.add(f.root);
  }

  /**
   * The source map's trackside trees are crossed alpha cards (a vertical seam down every crown, flat from the side).
   * Each connected group of cards is one tree: its base, height and width are read here and the card chunks are
   * removed, so the forest plants its 3D models in the same places. Wide cards (rows of trees on one quad) give
   * several trees along their length; tall narrow ones and the pine material are spruces.
   */
  extractCardTrees(): CardTree[] {
    const out: CardTree[] = [];
    const v = new THREE.Vector3();
    for (const c of this.chunks.filter((ch) => ch.kind === 'trees')) {
      c.object.updateWorldMatrix(true, true);
      c.object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const pine = [mesh.material].flat().some((m) => /pine/i.test(m.name));
        const g = mesh.geometry;
        const pos = g.getAttribute('position');
        const idx = g.getIndex();
        const n = pos.count;
        const par = new Int32Array(n).map((_, i) => i);
        const find = (a: number) => {
          while (par[a] !== a) a = par[a] = par[par[a]];
          return a;
        };
        if (idx) for (let i = 0; i < idx.count; i += 3) par[find(idx.getX(i + 1))] = par[find(idx.getX(i + 2))] = find(idx.getX(i));
        // minX, minY, minZ, maxX, maxY, maxZ, then Σx, Σz, Σxz, count (the sign of the x/z covariance: which diagonal)
        const box = new Map<number, number[]>();
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          const r = find(i);
          const b = box.get(r);
          if (!b) box.set(r, [v.x, v.y, v.z, v.x, v.y, v.z, v.x, v.z, v.x * v.z, 1]);
          else {
            b[6] += v.x;
            b[7] += v.z;
            b[8] += v.x * v.z;
            b[9]++;
            b[0] = Math.min(b[0], v.x);
            b[1] = Math.min(b[1], v.y);
            b[2] = Math.min(b[2], v.z);
            b[3] = Math.max(b[3], v.x);
            b[4] = Math.max(b[4], v.y);
            b[5] = Math.max(b[5], v.z);
          }
        }
        for (const b of box.values()) {
          const h = b[4] - b[1];
          const wx = b[3] - b[0];
          const wz = b[5] - b[2];
          const w = Math.hypot(wx, wz);
          if (h < 1.5) continue;
          // a row of trees on one card: one tree per ~0.6 × height along it
          const k = w > 1.4 * h ? Math.max(2, Math.round(w / (0.6 * h))) : 1;
          const down = b[8] / b[9] - (b[6] / b[9]) * (b[7] / b[9]) < 0;
          for (let j = 0; j < k; j++) {
            const t = k === 1 ? 0.5 : (j + 0.5) / k;
            const z = down ? b[5] - wz * t : b[2] + wz * t;
            out.push({ x: b[0] + wx * t, y: b[1], z, h, spruce: pine || (k === 1 && w < 0.45 * h) });
          }
        }
        g.dispose();
      });
      c.object.removeFromParent();
    }
    this.chunks = this.chunks.filter((ch) => ch.kind !== 'trees');
    return out;
  }

  constructor(readonly data: TrackData) {
    this.root.name = 'track';
  }

  static async load(data: TrackData, onBytes: (n: number) => void): Promise<{ track: Track; collision: CollisionMesh[] }> {
    const t = new Track(data);
    const files = [...new Set(data.chunks.map((c) => c.file))];
    const scenes = await Promise.all(files.map(async (f) => ({ f, g: await parseGltf(await fetchWithProgress(f, onBytes)) })));
    const collision = await loadCollision(data, onBytes);
    for (const { f, g } of scenes) {
      // a layout can take some chunks of a file and replace others (the Nordschleife layout swaps the GP's terrain
      // and its junction walls for its own copies): drop the chunk nodes this layout does not list from that file
      const listed = new Set(data.chunks.filter((c) => c.file === f).map((c) => c.node));
      for (const child of [...g.scene.children]) if (child.name.startsWith('chunk_') && !listed.has(child.name)) g.scene.remove(child);
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
        if (GROUND_MAT_RE.test(sm.name) || sm.name === 'grass_fill') {
          const isGrass = /grass|fill|turf/i.test(sm.name);
          const isGravel = /^(gravel|sand)/i.test(sm.name);
          // the satellite terrain (top2) is only seen from afar: no close-up detail there; stones need contrast
          const det = /^top2/i.test(sm.name) ? 0 : isGrass ? 0.28 : isGravel ? 0.42 : 0.16;
          addMacroVariation(sm, 0.22, isGrass || /top2/i.test(sm.name), det, isGrass ? 'grass' : isGravel ? 'gravel' : 'paved');
          if (isGrass && det > 0) t.lawnMaterials.add(sm);
          t.groundMaterials.add(sm);
        } else if (PAVED_MAT_RE.test(sm.name)) {
          const asph = /^asph/i.test(sm.name);
          addMacroVariation(sm, 0.08, false, /^(paddock_roof|ponyva)/i.test(sm.name) ? 0.12 : asph ? 0.2 : 0.22, asph ? 'asphalt' : 'paved');
          t.groundMaterials.add(sm);
        }
        if (ROAD_MAT_RE.test(sm.name)) t.groundMaterials.add(sm);
        if (STRUCT_DETAIL_RE.test(sm.name) && !sm.transparent) addStructureDetail(sm, 0.5);
        else if (METAL_DETAIL_RE.test(sm.name) && !sm.transparent && sm.alphaTest === 0) addStructureDetail(sm, 0.25);
        applyDecalLayer(sm);
      }
      const first = mats[0] as THREE.MeshStandardMaterial | undefined;
      const culled = first && DETAIL_MAT_RE.test(first.name) ? t.details : first && BARRIER_MAT_RE.test(first.name) ? t.barriers : null;
      if (culled) {
        mesh.geometry.computeBoundingSphere();
        const bs = mesh.geometry.boundingSphere as THREE.Sphere;
        const center = bs.center.clone().applyMatrix4(mesh.matrixWorld);
        culled.push({ mesh, center, radius: bs.radius });
      }
    });
    return { track: t, collision };
  }

  /** Build Rapier trimesh colliders; one per surface sub-mesh. */
  buildColliders(R: R, world: RAPIER.World, meshes: CollisionMesh[], layout?: TrackData): void {
    for (const m of meshes) {
      // walls across this layout's own lap line (a road the map closes for another layout) are not there
      const idx = layout && m.surface === 'wall' ? cutWallsAcrossLine(m.positions, m.indices, layout) : m.indices;
      const desc = R.ColliderDesc.trimesh(m.positions, idx)
        .setCollisionGroups(m.surface === 'wall' ? WALL_GROUPS : TRACK_GROUPS)
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
  /** Smoothed driving surfaces over the pit lane and the layout's rough stretches (roadPatches.ts). */
  private patches: RoadPatches | null = null;

  buildSmoothSurfaces(world: RAPIER.World, td: TrackData): void {
    const ray = this.ray;
    if (!ray) return;
    this.patches = RoadPatches.build(td, (x, yTop, z, maxD) => {
      ray.origin.x = x;
      ray.origin.y = yTop;
      ray.origin.z = z;
      ray.dir.x = 0;
      ray.dir.y = -1;
      ray.dir.z = 0;
      const hit = world.castRay(ray, maxD, true, undefined, RAY_GROUPS);
      if (!hit || this.colliderSurface.get(hit.collider.handle) === 'wall') return null;
      return yTop - hit.timeOfImpact;
    });
  }

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
        if (out.surface !== 'wall') this.patches?.apply(ox, oy, oz, dx, dy, dz, maxDist, out);
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
          // grass, gravel and sand stay diffuse: as PBR materials the sky's reflection at grazing angles (and the
          // reflection environment on High/Ultra) washed the verges out to a pale mint seen from the cockpit
          const diffuse = (m: THREE.Material): THREE.Material => (GROUND_MAT_RE.test(m.name) || m.name === 'grass_fill' ? this.lambertOf(m) : m);
          mesh.material = Array.isArray(pbr) ? pbr.map(diffuse) : diffuse(pbr);
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
      // keep the world-space macro variation / detail on the cheap path (grass is most of the screen on Low/Medium)
      if (sm.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) {
        l.onBeforeCompile = sm.onBeforeCompile;
        l.customProgramCacheKey = sm.customProgramCacheKey;
      }
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
    for (const d of this.barriers) d.mesh.visible = d.center.distanceTo(camPos) - d.radius < q.barrierDistance;
    this.forest?.update(camPos, q);
  }

  /** Make every chunk visible (shader/texture warm-up). */
  showAll(): void {
    for (const c of this.chunks) c.object.visible = true;
    for (const d of this.details) d.mesh.visible = true;
    for (const d of this.barriers) d.mesh.visible = true;
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
