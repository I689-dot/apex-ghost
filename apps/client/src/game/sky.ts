import * as THREE from 'three';
import { ATMOSPHERE_GLSL } from './atmosphere';

/**
 * The sky dome: atmosphere + sun disc + two cloud layers in one fragment shader.
 *
 * - Atmosphere: a 128×64 sky-view LUT (relative azimuth to the sun × √elevation, so the horizon gets most rows),
 *   re-rendered from atmosphere.ts only when the sun or the haze changes. Per pixel the dome does one lookup.
 * - Clouds: a cumulus layer 2 km up and a cirrus layer 9 km up, from a tiling noise texture (value fbm + Worley
 *   fbm) projected on planes. Cumulus are lit with a few samples towards the sun (self-shadowing, Beer + powder)
 *   and a two-lobe phase (bright silver edges against the sun), and fade into the sky with distance.
 *   `detail` (quality) 0: one cumulus sample, no light samples, no cirrus; 1: 1 light sample + cirrus; 2: 2 light samples.
 * - The dome is drawn after the opaque scene (renderOrder) at the far plane, so only the visible sky is shaded.
 */

const LUT_W = 128;
const LUT_H = 64;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** 256² tiling noise: R = value-noise fbm (cloud shapes), G = inverted Worley fbm (billows), B = fine value noise. */
function cloudNoise(): THREE.DataTexture {
  const N = 256;
  const r = rng(1337);
  const lattice = (f: number) => {
    const g = new Float32Array(f * f).map(() => r());
    return (x: number, y: number) => {
      const fx = (x / N) * f;
      const fy = (y / N) * f;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (a: number, b: number) => g[(((b % f) + f) % f) * f + (((a % f) + f) % f)];
      return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
    };
  };
  const worley = (f: number) => {
    const pts = new Float32Array(f * f * 2).map(() => r());
    return (x: number, y: number) => {
      const fx = (x / N) * f;
      const fy = (y / N) * f;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      let best = 9;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const cx = ix + i;
          const cy = iy + j;
          const k = ((((cy % f) + f) % f) * f + (((cx % f) + f) % f)) * 2;
          const dx = cx + pts[k] - fx;
          const dy = cy + pts[k + 1] - fy;
          best = Math.min(best, dx * dx + dy * dy);
        }
      return 1 - Math.min(1, Math.sqrt(best));
    };
  };
  const v = [lattice(4), lattice(8), lattice(16), lattice(32), lattice(64)];
  const w = [worley(6), worley(12), worley(24)];
  const fine = [lattice(32), lattice(64), lattice(128)];
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const a = v[0](x, y) * 0.42 + v[1](x, y) * 0.27 + v[2](x, y) * 0.16 + v[3](x, y) * 0.1 + v[4](x, y) * 0.05;
      const b = w[0](x, y) * 0.55 + w[1](x, y) * 0.3 + w[2](x, y) * 0.15;
      const c = fine[0](x, y) * 0.5 + fine[1](x, y) * 0.3 + fine[2](x, y) * 0.2;
      const k = (y * N + x) * 4;
      // stretch the fbm's narrow range (≈0.25–0.75) to the full byte
      d[k] = Math.max(0, Math.min(255, Math.round((a - 0.5) * 2.1 * 255 + 128)));
      d[k + 1] = Math.round(Math.max(0, Math.min(1, b)) * 255);
      d[k + 2] = Math.round(c * 255);
      d[k + 3] = 255;
    }
  const t = new THREE.DataTexture(d, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** LUT parametrisation shared by the LUT pass and the dome. */
const LUT_GLSL = /* glsl */ `
const float SKY_PI = 3.14159265;
vec2 skyLutUv(vec3 dir, vec3 sunDir) {
  float el = asin(clamp(dir.y, 0.0, 1.0));
  vec2 a = dir.xz; vec2 s = sunDir.xz;
  float la = length(a); float ls = length(s);
  float c = (la > 1e-4 && ls > 1e-4) ? dot(a / la, s / ls) : 1.0;
  float az = acos(clamp(c, -1.0, 1.0));
  return vec2(az / SKY_PI, sqrt(el / (0.5 * SKY_PI)));
}`;

export interface SkyParams {
  sunDir: THREE.Vector3;
  /** Sun disc colour (transmittance × intensity), linear HDR. */
  sunDisc: THREE.Color;
  /** Light on the clouds' sunlit side and their ambient (sky) light. */
  cloudSun: THREE.Color;
  cloudAmbient: THREE.Color;
  /** 0 clear … 1 overcast. */
  cover: number;
  /** Cirrus amount 0..1. */
  cirrus: number;
  /** Heavy fog: the dome fades to `fogColor`. */
  fogMix: number;
  fogColor: THREE.Color;
  /** Darkness floor added at night (linear). */
  night: number;
  time: number;
}

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private lut: THREE.WebGLRenderTarget;
  private lutScene = new THREE.Scene();
  private lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lutMat: THREE.ShaderMaterial;
  private lastSun = new THREE.Vector3(0, -2, 0);
  private lastHaze = -1;

  constructor(renderer: THREE.WebGLRenderer, detail: number) {
    const half = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    this.lut = new THREE.WebGLRenderTarget(LUT_W, LUT_H, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    // 8-bit fallback stores radiance / 8
    const lutScale = half ? 1 : 8;
    this.lutMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uHaze: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform float uHaze; varying vec2 vUv;
        ${ATMOSPHERE_GLSL}
        void main() {
          float az = vUv.x * 3.14159265;
          float el = vUv.y * vUv.y * 1.5707963;
          vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
          vec3 sun = vec3(sqrt(max(0.0, 1.0 - uSun.y * uSun.y)), uSun.y, 0.0);
          gl_FragColor = vec4(atmo(normalize(dir), normalize(sun), uHaze) / ${lutScale.toFixed(1)}, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat);
    quad.frustumCulled = false;
    this.lutScene.add(quad);

    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      defines: { CLOUD_DETAIL: detail },
      uniforms: {
        tLut: { value: this.lut.texture },
        tNoise: { value: cloudNoise() },
        uLutScale: { value: lutScale },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uSunDisc: { value: new THREE.Color() },
        uCloudSun: { value: new THREE.Color() },
        uCloudAmb: { value: new THREE.Color() },
        uCover: { value: 0.3 },
        uCirrus: { value: 0.5 },
        uTime: { value: 0 },
        uFogMix: { value: 0 },
        uFogColor: { value: new THREE.Color() },
        uNight: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // on the far plane
          gl_Position.z = gl_Position.w * 0.99999;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tLut; uniform sampler2D tNoise; uniform float uLutScale;
        uniform vec3 uSun; uniform vec3 uSunDisc; uniform vec3 uCloudSun; uniform vec3 uCloudAmb;
        uniform float uCover; uniform float uCirrus; uniform float uTime; uniform float uFogMix; uniform vec3 uFogColor; uniform float uNight;
        varying vec3 vDir;
        ${LUT_GLSL}
        vec3 skyAt(vec3 d) { return texture2D(tLut, skyLutUv(d, uSun)).rgb * uLutScale; }
        float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5) * 0.0795775; }
        float cloudDensity(vec2 p, float cover) {
          float base = texture2D(tNoise, p * (1.0 / 14000.0)).r;
          #if CLOUD_DETAIL > 0
          float bill = texture2D(tNoise, p * (1.0 / 4200.0) + 0.37).g;
          float n = base * 0.68 + bill * 0.42 - 0.08;
          #else
          float n = base;
          #endif
          return clamp((n - (1.0 - cover)) / max(0.12, cover * 0.55), 0.0, 1.0);
        }
        void main() {
          vec3 dir = normalize(vDir);
          vec3 d = vec3(dir.x, max(dir.y, 0.0), dir.z);
          vec3 sky = skyAt(normalize(d + vec3(0.0, 1e-4, 0.0)));
          // below the horizon: the haze colour, a little darker towards the ground
          sky *= mix(1.0, 0.82, smoothstep(0.0, -0.25, dir.y));
          // night: a deep blue floor (no multiple scattering in the LUT)
          sky += uNight * vec3(0.0035, 0.0055, 0.012);
          // sun disc with limb darkening (2.5× the real size, so it reads on a phone)
          float mu = dot(dir, uSun);
          float disc = smoothstep(0.99996, 0.999985, mu);
          vec3 col = sky + uSunDisc * disc * (0.6 + 0.4 * smoothstep(0.99996, 0.99999, mu));
          float cloudA = 0.0;
          if (dir.y > 0.0) {
            vec2 wind = vec2(9.0, 3.5) * uTime;
            // cumulus layer, 2 km up
            float t = 2000.0 / max(dir.y, 0.02);
            vec2 p = dir.xz * t + wind;
            float dens = cloudDensity(p, uCover);
            if (dens > 0.001) {
              vec2 sunStep = normalize(uSun.xz + vec2(1e-4)) * 380.0;
              #if CLOUD_DETAIL > 0
              float toSun = cloudDensity(p + sunStep, uCover);
              #if CLOUD_DETAIL > 1
              toSun = toSun * 0.6 + cloudDensity(p + sunStep * 2.4, uCover) * 0.4;
              #endif
              #else
              float toSun = dens * 0.8;
              #endif
              float od = toSun * (2.0 + 4.0 * uCover);
              float beer = exp(-od);
              float powder = 1.0 - exp(-dens * 3.5);
              float phase = mix(hg(mu, 0.55), hg(mu, -0.15), 0.35) * 6.0;
              vec3 lit = uCloudSun * beer * powder * (0.55 + phase);
              // thick decks are dark underneath
              vec3 amb = uCloudAmb * mix(1.05, 0.5, dens * uCover);
              vec3 c = amb + lit;
              // aerial perspective: far clouds melt into the horizon
              float far = 1.0 - exp(-t / 38000.0);
              c = mix(c, sky, far * 0.85);
              cloudA = smoothstep(0.0, 0.85, dens) * smoothstep(0.0, 0.07, dir.y);
              col = mix(col, c, cloudA);
            }
            #if CLOUD_DETAIL > 0
            // cirrus, 9 km up: thin streaks, lit by the sun
            float t2 = 9000.0 / max(dir.y, 0.03);
            vec2 q = dir.xz * t2 + wind * 2.6;
            float s = texture2D(tNoise, vec2(q.x / 52000.0, q.y / 11000.0)).r * 0.7 + texture2D(tNoise, q / 6000.0).b * 0.3;
            float ca = smoothstep(0.52, 0.85, s) * uCirrus * (1.0 - cloudA) * smoothstep(0.0, 0.12, dir.y) * 0.55;
            col = mix(col, sky * 0.55 + uCloudSun * (0.45 + hg(mu, 0.6) * 2.0), ca);
            #endif
          }
          col = mix(col, uFogColor, uFogMix);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.scale.setScalar(5000);
    this.mesh.frustumCulled = false;
    // after the opaque scene: early depth test skips every pixel covered by the track, trees and cars
    this.mesh.renderOrder = 1000;
    this.mesh.name = 'sky';
  }

  /** Re-render the LUT when the sun or the haze changed noticeably (a 128×64 pass). */
  updateLut(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3, haze: number, force = false): boolean {
    if (!force && Math.abs(sunDir.y - this.lastSun.y) < 0.0015 && Math.abs(haze - this.lastHaze) < 0.02) return false;
    this.lastSun.copy(sunDir);
    this.lastHaze = haze;
    this.lutMat.uniforms.uSun.value.copy(sunDir);
    this.lutMat.uniforms.uHaze.value = haze;
    const prev = renderer.getRenderTarget();
    const xr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.lut);
    renderer.render(this.lutScene, this.lutCam);
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = xr;
    return true;
  }

  update(p: SkyParams): void {
    const u = this.material.uniforms;
    u.uSun.value.copy(p.sunDir);
    (u.uSunDisc.value as THREE.Color).copy(p.sunDisc);
    (u.uCloudSun.value as THREE.Color).copy(p.cloudSun);
    (u.uCloudAmb.value as THREE.Color).copy(p.cloudAmbient);
    u.uCover.value = p.cover;
    u.uCirrus.value = p.cirrus;
    u.uTime.value = p.time;
    u.uFogMix.value = p.fogMix;
    (u.uFogColor.value as THREE.Color).copy(p.fogColor);
    u.uNight.value = p.night;
  }

  setDetail(detail: number): void {
    if (this.material.defines.CLOUD_DETAIL === detail) return;
    this.material.defines.CLOUD_DETAIL = detail;
    this.material.needsUpdate = true;
  }

  dispose(): void {
    this.lut.dispose();
    this.lutMat.dispose();
    this.material.dispose();
    (this.material.uniforms.tNoise.value as THREE.Texture).dispose();
  }
}
