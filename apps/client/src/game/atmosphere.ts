import * as THREE from 'three';

/**
 * Physically based sky: single scattering through a spherical atmosphere (Rayleigh, Mie and ozone), as in Nishita
 * '93 / Hillaire '20 without the multiple-scattering LUT. The same model runs in two places:
 *  - GLSL (ATMOSPHERE_GLSL) renders a small sky-view LUT whenever the sun moves (sky.ts samples it every frame);
 *  - TypeScript (skyRadiance, sunTransmittance) gives the sun's colour, the sky ambient and the horizon colours the
 *    fog fades into, so lighting, fog and sky always agree (blue noon, orange sunset, blue hour).
 *
 * Units: radiance for a sun of SUN_E, then × SKY_EXPOSURE so that the noon zenith is ~1 in the renderer's linear HDR
 * (the scene's sun light is ~3.4, its sky ambient ~1.4).
 */

const R_E = 6360e3;
const R_A = 6420e3;
const H_R = 8000;
const H_M = 1200;
const BETA_R: [number, number, number] = [5.802e-6, 13.558e-6, 33.1e-6];
const BETA_M = 3.996e-6;
const BETA_O: [number, number, number] = [0.65e-6, 1.881e-6, 0.085e-6];
const SUN_E = 20;
export const SKY_EXPOSURE = 1.25;
/** Viewer altitude (m): the Eifel sits ~600 m up. */
const VIEW_H = 600;

const glslVec = (v: number[]) => `vec3(${v.map((x) => x.toExponential(4)).join(', ')})`;

/** GLSL: `vec3 atmo(vec3 dir, vec3 sunDir, float haze)` (radiance × SKY_EXPOSURE) and `vec3 atmoTransmittance(vec3 dir, float haze)`. */
// in kilometres: squared planet radii in metres (~4e13) lose too much float precision on phone GPUs
export const ATMOSPHERE_GLSL = /* glsl */ `
const float A_RE = ${(R_E / 1000).toFixed(3)};
const float A_RA = ${(R_A / 1000).toFixed(3)};
const vec3 A_BR = ${glslVec(BETA_R.map((b) => b * 1000))};
const float A_BM = ${(BETA_M * 1000).toExponential(4)};
const vec3 A_BO = ${glslVec(BETA_O.map((b) => b * 1000))};
const float A_PI = 3.14159265;
vec2 atmoRaySphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d); float c = dot(o, o) - r * r; float h = b * b - c;
  if (h < 0.0) return vec2(-1.0, -1.0);
  h = sqrt(h); return vec2(-b - h, -b + h);
}
// optical depth densities at height h: rayleigh, mie, ozone
vec3 atmoDensity(float h) {
  return vec3(exp(-h / ${(H_R / 1000).toFixed(3)}), exp(-h / ${(H_M / 1000).toFixed(3)}), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}
vec3 atmoExtinction(vec3 od, float haze) {
  return A_BR * od.x + A_BM * 1.11 * haze * od.y + A_BO * od.z;
}
vec3 atmoTransmittance(vec3 dir, float haze) {
  vec3 o = vec3(0.0, A_RE + ${(VIEW_H / 1000).toFixed(3)}, 0.0);
  vec2 t = atmoRaySphere(o, dir, A_RA);
  vec3 od = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    // quadratic spacing: dense steps in the thick air near the ground
    float u = (float(i) + 0.5) / 12.0; float ds = 2.0 * u * t.y / 12.0;
    vec3 p = o + dir * (u * u * t.y); od += atmoDensity(length(p) - A_RE) * ds;
  }
  vec2 g = atmoRaySphere(o, dir, A_RE);
  return g.x > 0.0 ? vec3(0.0) : exp(-atmoExtinction(od, haze));
}
vec3 atmo(vec3 dir, vec3 sunDir, float haze) {
  vec3 o = vec3(0.0, A_RE + ${(VIEW_H / 1000).toFixed(3)}, 0.0);
  vec2 ta = atmoRaySphere(o, dir, A_RA);
  vec2 tg = atmoRaySphere(o, dir, A_RE);
  float len = tg.x > 0.0 ? tg.x : ta.y;
  float mu = dot(dir, sunDir);
  float pr = 3.0 / (16.0 * A_PI) * (1.0 + mu * mu);
  float g = 0.76; float g2 = g * g;
  float pm = 3.0 / (8.0 * A_PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5));
  vec3 odv = vec3(0.0); vec3 sr = vec3(0.0); vec3 sm = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float u = (float(i) + 0.5) / 16.0; float ds = 2.0 * u * len / 16.0;
    vec3 p = o + dir * (u * u * len);
    float h = length(p) - A_RE;
    vec3 d = atmoDensity(h) * ds;
    odv += d;
    vec3 up = p / length(p);
    // light ray to the sun: blocked by the planet, else integrate
    vec2 sg = atmoRaySphere(p, sunDir, A_RE);
    if (sg.x > 0.0) continue;
    vec2 sa = atmoRaySphere(p, sunDir, A_RA);
    float dl = sa.y / 4.0; vec3 odl = vec3(0.0);
    for (int j = 0; j < 4; j++) { vec3 q = p + sunDir * (float(j) + 0.5) * dl; odl += atmoDensity(length(q) - A_RE) * dl; }
    vec3 tau = atmoExtinction(odv + odl, haze);
    vec3 att = exp(-tau);
    sr += att * d.x; sm += att * d.y;
  }
  return ${SUN_E.toFixed(1)} * (sr * A_BR * pr + sm * A_BM * haze * pm) * ${SKY_EXPOSURE.toFixed(4)};
}
`;

/* ------------------------------------------------------------------ TypeScript twin of the GLSL above --- */

type V3 = [number, number, number];

function raySphere(o: V3, d: V3, r: number): [number, number] {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  let h = b * b - c;
  if (h < 0) return [-1, -1];
  h = Math.sqrt(h);
  return [-b - h, -b + h];
}

function density(h: number): V3 {
  return [Math.exp(-h / H_R), Math.exp(-h / H_M), Math.max(0, 1 - Math.abs(h - 25000) / 15000)];
}

function extinction(od: V3, haze: number): V3 {
  return [0, 1, 2].map((k) => BETA_R[k] * od[0] + BETA_M * 1.11 * haze * od[1] + BETA_O[k] * od[2]) as V3;
}

/** Colour of the sunlight reaching the viewer (0..1 per channel) for a sun in direction `dir`. */
export function sunTransmittance(dir: THREE.Vector3, haze: number, out: THREE.Color): THREE.Color {
  const o: V3 = [0, R_E + VIEW_H, 0];
  const d: V3 = [dir.x, Math.max(dir.y, -0.02), dir.z];
  const n = Math.hypot(...d);
  d[0] /= n;
  d[1] /= n;
  d[2] /= n;
  const [, ta] = raySphere(o, d, R_A);
  const steps = 24;
  const od: V3 = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps;
    const ds = (2 * u * ta) / steps;
    const p: V3 = [o[0] + d[0] * u * u * ta, o[1] + d[1] * u * u * ta, o[2] + d[2] * u * u * ta];
    const dd = density(Math.hypot(...p) - R_E);
    od[0] += dd[0] * ds;
    od[1] += dd[1] * ds;
    od[2] += dd[2] * ds;
  }
  const [g0] = raySphere(o, d, R_E);
  if (g0 > 0) return out.setRGB(0, 0, 0);
  const tau = extinction(od, haze);
  return out.setRGB(Math.exp(-tau[0]), Math.exp(-tau[1]), Math.exp(-tau[2]));
}

/** Sky radiance (× SKY_EXPOSURE) seen in direction `dir` with the sun in `sun`. */
export function skyRadiance(dir: THREE.Vector3, sun: THREE.Vector3, haze: number, out: THREE.Color): THREE.Color {
  const o: V3 = [0, R_E + VIEW_H, 0];
  const d: V3 = [dir.x, dir.y, dir.z];
  const s: V3 = [sun.x, sun.y, sun.z];
  const [, ta] = raySphere(o, d, R_A);
  const [tg] = raySphere(o, d, R_E);
  const len = tg > 0 ? tg : ta;
  const N = 16;
  const mu = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
  const pr = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g = 0.76;
  const g2 = g * g;
  const pm = ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * mu), 1.5));
  const odv: V3 = [0, 0, 0];
  const sr: V3 = [0, 0, 0];
  const sm: V3 = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    const ds = (2 * u * len) / N;
    const p: V3 = [o[0] + d[0] * u * u * len, o[1] + d[1] * u * u * len, o[2] + d[2] * u * u * len];
    const r = Math.hypot(...p);
    const dd = density(r - R_E);
    odv[0] += dd[0] * ds;
    odv[1] += dd[1] * ds;
    odv[2] += dd[2] * ds;
    const [sg] = raySphere(p, s, R_E);
    if (sg > 0) continue;
    const [, sa] = raySphere(p, s, R_A);
    const dl = sa / 4;
    const odl: V3 = [0, 0, 0];
    for (let j = 0; j < 4; j++) {
      const q: V3 = [p[0] + s[0] * (j + 0.5) * dl, p[1] + s[1] * (j + 0.5) * dl, p[2] + s[2] * (j + 0.5) * dl];
      const dq = density(Math.hypot(...q) - R_E);
      odl[0] += dq[0] * dl;
      odl[1] += dq[1] * dl;
      odl[2] += dq[2] * dl;
    }
    const tau = extinction([odv[0] + odl[0], odv[1] + odl[1], odv[2] + odl[2]], haze);
    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-tau[k]);
      sr[k] += att * dd[0] * ds;
      sm[k] += att * dd[1] * ds;
    }
  }
  const k = SUN_E * SKY_EXPOSURE;
  return out.setRGB(
    k * (sr[0] * BETA_R[0] * pr + sm[0] * BETA_M * haze * pm),
    k * (sr[1] * BETA_R[1] * pr + sm[1] * BETA_M * haze * pm),
    k * (sr[2] * BETA_R[2] * pr + sm[2] * BETA_M * haze * pm),
  );
}

/* ------------------------------------------------------------------ fog & grade shader chunks --- */

/**
 * Values shared by every built-in material's fog (aerial perspective). They are plain objects, not Vector3/Color:
 * three.js clones Vector3/Color uniform values per material, but keeps other objects by reference, so writing
 * these fields updates every material at once.
 *  - fogSunDir: the sun direction; fogSunColor: horizon colour towards the sun minus `scene.fog.color` (which is
 *    the colour away from it), so the fog matches the sky in every direction (orange towards a low sun);
 *  - fogParams.x: haze density at the camera (1/m), .y: 1 / its scale height (m): an exponential height fog on top
 *    of the weather's FogExp2, which blues distant hills and fades less when looking up a slope.
 * Zero values give three.js' own fog, so materials compiled before installation look as before.
 */
export const FOG_SHARED = {
  sunDir: { x: 0, y: 0, z: 0 },
  sunColor: { r: 0, g: 0, b: 0 },
  params: { x: 0, y: 0, z: 0 },
};

let installed = false;

/** Patch three.js' fog and ACES chunks (once, before materials compile). */
export function installAtmosphereChunks(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogDir;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogDir = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  uniform vec3 fogParams;
  varying float vFogDepth;
  varying vec3 vFogDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogDist = length( vFogDir );
  vec3 fogV = vFogDir / max( fogDist, 1e-3 );
  float fogDy = fogV.y * fogDist * fogParams.y;
  float fogOD = fogParams.x * fogDist * ( abs( fogDy ) > 1e-3 ? ( 1.0 - exp( - fogDy ) ) / fogDy : 1.0 );
  fogFactor = 1.0 - ( 1.0 - fogFactor ) * exp( - fogOD );
  float fogToSun = pow( clamp( dot( fogV, fogSunDir ) * 0.5 + 0.5, 0.0, 1.0 ), 3.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + fogSunColor * fogToSun, fogFactor );
#endif`;
  const extra = { fogSunDir: { value: FOG_SHARED.sunDir }, fogSunColor: { value: FOG_SHARED.sunColor }, fogParams: { value: FOG_SHARED.params } };
  THREE.UniformsLib.fog = { ...THREE.UniformsLib.fog, ...extra } as typeof THREE.UniformsLib.fog;
  for (const lib of Object.values(THREE.ShaderLib) as { uniforms: Record<string, unknown>; fragmentShader: string }[])
    if (lib.fragmentShader.includes('fog_fragment') || lib.fragmentShader.includes('fog_pars_fragment')) Object.assign(lib.uniforms, extra);

  // Colour grade inside ACES (both the direct path and OutputPass include this chunk): a touch more saturation
  // (ACES desaturates mid-tones), a gentle S-curve, and cool shadows / warm highlights.
  C.tonemapping_pars_fragment = C.tonemapping_pars_fragment.replace(
    /(vec3 ACESFilmicToneMapping\( vec3 color \) \{[\s\S]*?color = ACESOutputMat \* color;)\s*\/\/ Clamp to \[0, 1\]\s*return saturate\( color \);/,
    `$1
	color = max( color, 0.0 );
	float apxL = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = mix( vec3( apxL ), color, 1.14 );
	color = max( color, 0.0 );
	vec3 apxP = pow( color, vec3( 1.0 / 2.2 ) );
	apxP = mix( apxP, apxP * apxP * ( 3.0 - 2.0 * apxP ), 0.16 );
	color = pow( max( apxP, 0.0 ), vec3( 2.2 ) );
	color *= mix( vec3( 0.975, 0.99, 1.04 ), vec3( 1.03, 1.0, 0.96 ), smoothstep( 0.05, 0.6, apxL ) );
	return saturate( color );`,
  );
}
