import * as THREE from 'three';
import type { CarSpecs, TrackData } from '@apex/shared';
import type { GroundHit, GroundQuery } from '../physics/vehicle';
import { carLimits, racingLineFor, speedProfile } from './ai';

const ACROSS = [-1, -0.5, 0, 0.5, 1]; // vertices across the road (edge → edge): follows the crown and camber
const LIFT = 0.025;

/**
 * Lived-in asphalt, as on a real circuit after a season of racing, drawn as one multiplicative decal over the
 * whole road width (one draw call, ~10k triangles):
 *  - the rubbered racing line: a dark band with two darker wheel tracks, where the cars really drive (the AI's
 *    racing line);
 *  - braking zones: heavier rubber and long skid streaks before the corners (from the speed profile);
 *  - repair patches: rectangles of newer/older asphalt across part of the width, every few hundred metres;
 *  - marbles: faint dust just off the line in fast corners.
 * It fades out with distance (multiplying fog would darken the haze) and is tone-mapping neutral.
 */
export class RoadWear {
  readonly object: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(track: TrackData, specs: CarSpecs, ground: GroundQuery, airDensity?: number) {
    const line = racingLineFor(track);
    const v = speedProfile(line, carLimits(specs, 0.94, airDensity), 1, true);
    const cl = track.centerline;
    const n = cl.length / 3;
    // per point: braking (decel) and cornering load, smoothed over ~25 m so the wear fades in and out
    const brake = new Float32Array(n);
    const corner = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const acc = (v[j] * v[j] - v[i] * v[i]) / (2 * Math.max(0.5, line.ds[i]));
      brake[i] = THREE.MathUtils.smoothstep(-acc, 3, 12);
      corner[i] = THREE.MathUtils.smoothstep(Math.abs(line.curvature[i]) * v[i] * v[i], 6, 18);
    }
    const smooth = (a: Float32Array, rad: number) => {
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -rad; k <= rad; k++) s += a[(i + k + n) % n];
        o[i] = s / (2 * rad + 1);
      }
      return o;
    };
    const brakeS = smooth(brake, 4);
    const cornerS = smooth(corner, 3);

    const m = ACROSS.length;
    const pos = new Float32Array(n * m * 3);
    const lat = new Float32Array(n * m); // metres from the centreline, + = left
    const lineLat = new Float32Array(n * m);
    const along = new Float32Array(n * m); // lap distance
    const wear = new Float32Array(n * m * 2); // brake, corner
    const hit: GroundHit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const tx = cl[b * 3] - cl[a * 3];
      const tz = cl[b * 3 + 2] - cl[a * 3 + 2];
      const l = Math.hypot(tx, tz) || 1;
      const lx = tz / l; // left
      const lz = -tx / l;
      for (let k = 0; k < m; k++) {
        const f = ACROSS[k];
        const w = f < 0 ? -track.widthR[i] * -f : track.widthL[i] * f;
        const x = cl[i * 3] + lx * w;
        const z = cl[i * 3 + 2] + lz * w;
        const cy = cl[i * 3 + 1];
        const y = ground.cast(x, cy + 2.5, z, 0, -1, 0, 6, hit) ? hit.py : cy;
        const o = i * m + k;
        pos.set([x, y + LIFT, z], o * 3);
        lat[o] = w;
        lineLat[o] = line.offset[i];
        along[o] = track.cumS[i];
        wear[o * 2] = brakeS[i];
        wear[o * 2 + 1] = cornerS[i];
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (j === 0 && Math.hypot(cl[0] - cl[i * 3], cl[2] - cl[i * 3 + 2]) > 20) continue; // open layouts
      for (let k = 0; k < m - 1; k++) {
        const a = i * m + k;
        const b = j * m + k;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLat', new THREE.BufferAttribute(lat, 1));
    geo.setAttribute('aLine', new THREE.BufferAttribute(lineLat, 1));
    geo.setAttribute('aS', new THREE.BufferAttribute(along, 1));
    geo.setAttribute('aWear', new THREE.BufferAttribute(wear, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    // the lap wraps: the last segment has along = L … 0; fix by unwrapping in the shader is not needed because
    // noise only uses fract-free hashes of floor(s), and the seam sits on the start/finish straight.

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: 1 }, uFade: { value: 260 }, uWet: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aLat; attribute float aLine; attribute float aS; attribute vec2 aWear;
        varying float vLat; varying float vLine; varying float vS; varying vec2 vWear; varying float vDist;
        void main() {
          vLat = aLat; vLine = aLine; vS = aS; vWear = aWear;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uStrength; uniform float uFade; uniform float uWet;
        varying float vLat; varying float vLine; varying float vS; varying vec2 vWear; varying float vDist;
        float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        float n1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
        void main() {
          float d = vLat - vLine;                       // metres from the racing line
          float brakeW = vWear.x; float cornerW = vWear.y;
          // the line wanders a little lap after lap
          d += (n1(vS / 23.0) - 0.5) * 0.6;
          float band = 1.0 - smoothstep(0.6, 1.9 + brakeW * 0.6, abs(d));
          // two wheel tracks ~1.6 m apart
          float tracks = exp(-pow((abs(d) - 0.8) / 0.32, 2.0));
          float dark = band * (0.12 + 0.1 * cornerW) + tracks * band * (0.08 + 0.18 * brakeW);
          // skid streaks in braking zones: thin lines along the lap, broken up
          float lane = floor((d + 3.0) / 0.22);
          float streak = step(0.72, h1(lane * 7.13 + floor(vS / 9.0))) * smoothstep(0.25, 0.0, abs(fract((d + 3.0) / 0.22) - 0.5) - 0.18);
          streak *= n1(vS / 3.1 + lane) * brakeW * (1.0 - smoothstep(1.2, 2.6, abs(d)));
          dark += streak * 0.32;
          // marbles and dust just off the line in fast corners: a faint, smooth darkening
          float off = smoothstep(1.6, 2.6, abs(d)) * (1.0 - smoothstep(3.0, 5.0, abs(d)));
          dark += off * cornerW * n1(vS / 1.7 + floor(vLat)) * 0.06;
          // repair patches: newer (darker) or older (lighter) asphalt rectangles every so often
          float cell = floor(vS / 37.0);
          float hasPatch = step(0.91, h1(cell * 3.7));
          float p0 = h1(cell * 9.1) * 30.0 + 3.0;                       // start within the cell
          float pl = 3.0 + h1(cell * 5.3) * 9.0;                         // length
          float pc = (h1(cell * 2.9) - 0.5) * 8.0; float pw = 1.5 + h1(cell * 4.1) * 3.5;
          float sIn = mod(vS, 37.0);
          float inPatch = hasPatch * smoothstep(p0, p0 + 0.15, sIn) * (1.0 - smoothstep(p0 + pl - 0.15, p0 + pl, sIn))
            * (1.0 - smoothstep(pw - 0.1, pw, abs(vLat - pc)));
          float patchTone = h1(cell * 6.6) < 0.6 ? 0.07 : -0.04;
          dark += inPatch * patchTone;
          // edges: dust and less rubber towards the white lines
          float fade = 1.0 - smoothstep(uFade * 0.55, uFade, vDist);
          float k = clamp(dark * uStrength * fade * (1.0 - 0.35 * uWet), -0.2, 0.6);
          gl_FragColor = vec4(vec3(1.0 - k), 1.0);
        }`,
      // result = framebuffer × shader colour (darken), or brighten slightly for older patches (k < 0)
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      depthWrite: false,
      transparent: true,
      fog: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5,
    });
    this.object = new THREE.Mesh(geo, this.mat);
    this.object.name = 'road-wear';
    this.object.renderOrder = 1; // after the road, before the racing-line assist (2)
    this.object.frustumCulled = false;
  }

  /** Rain washes the contrast out (the whole road darkens instead). */
  setWetness(w: number): void {
    this.mat.uniforms.uWet.value = w;
  }

  setQuality(fadeDistance: number): void {
    this.mat.uniforms.uFade.value = fadeDistance;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.mat.dispose();
  }
}
