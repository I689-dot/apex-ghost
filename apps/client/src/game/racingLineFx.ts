import * as THREE from 'three';
import type { CarSpecs, TrackData } from '@apex/shared';
import type { GroundHit, GroundQuery } from '../physics/vehicle';
import { carLimits, racingLineFor, speedProfile } from './ai';

export type RacingLineMode = 'off' | 'corners' | 'full';

const WIDTH = 1.1;
const LIFT = 0.03;
/** Chevron spacing along the line (m). */
const CHEVRON_M = 2.4;
/** The dynamic colours are judged from the car's speed this far ahead (m); beyond it the static colours show. */
const LOOKAHEAD_M = 320;

/**
 * Racing-line assist after the F1 games' dynamic line: a ribbon of soft chevrons pointing the way, coloured from
 * what *your* car needs now. Ahead of the car the colour comes from the deceleration needed to get from your current
 * speed down to the line's target speed there (green: keep going, amber: lift / light braking, red: brake hard now),
 * so a braking zone turns red only when you arrive too fast, and stays green when you are already slow enough.
 * Further away it shows the line's own plan (from the speed profile of your car). It fades out under the nose and in
 * the distance. "corners" shows only braking zones and corners; "full" the whole lap.
 */
export class RacingLineFx {
  readonly object = new THREE.Group();
  private meshes: Record<'corners' | 'full', THREE.Mesh>;
  private readonly mat: THREE.ShaderMaterial;
  private readonly cumS: Float32Array;
  private readonly length: number;

  constructor(track: TrackData, specs: CarSpecs, ground: GroundQuery, airDensity?: number) {
    const line = racingLineFor(track);
    // a realistic target, not the absolute limit: what a good driver brakes for
    const limits = carLimits(specs, 0.94, airDensity);
    const v = speedProfile(line, limits, 1, true);
    const n = v.length;
    const kind = new Float32Array(n); // 0 go, 1 lift, 2 brake
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const acc = (v[j] * v[j] - v[i] * v[i]) / (2 * line.ds[i]);
      if (acc < -2.5) kind[i] = 2;
      else if (acc < 1.5 && Math.abs(line.curvature[i]) > 1 / 350) kind[i] = 1;
    }
    // a soft blend between the colours instead of hard steps
    const smooth = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += kind[(i + k + n) % n];
      smooth[i] = Math.max(kind[i], s / 5);
    }
    this.cumS = new Float32Array(n);
    for (let i = 1; i < n; i++) this.cumS[i] = this.cumS[i - 1] + line.ds[i - 1];
    this.length = this.cumS[n - 1] + line.ds[n - 1];
    // ground heights under the line
    const y = new Float32Array(n);
    const hit: GroundHit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
    for (let i = 0; i < n; i++) {
      const cy = track.centerline[i * 3 + 1];
      // start just above the road: a ray from higher up could land on a bridge over the track
      y[i] = ground.cast(line.x[i], cy + 2.5, line.z[i], 0, -1, 0, 6, hit) ? hit.py : cy;
    }
    // two vertices per point; the seam at the line wraps with one extra pair (s continues past the lap length)
    const m = n + 1;
    const pos = new Float32Array(m * 2 * 3);
    const uv = new Float32Array(m * 2 * 2);
    const target = new Float32Array(m * 2);
    const plan = new Float32Array(m * 2);
    for (let k = 0; k < m; k++) {
      const i = k % n;
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const tx = line.x[b] - line.x[a];
      const tz = line.z[b] - line.z[a];
      const l = Math.hypot(tx, tz) || 1;
      const sx = (tz / l) * (WIDTH / 2);
      const sz = (-tx / l) * (WIDTH / 2);
      pos.set([line.x[i] + sx, y[i] + LIFT, line.z[i] + sz, line.x[i] - sx, y[i] + LIFT, line.z[i] - sz], k * 6);
      const s = k === n ? this.length : this.cumS[i];
      uv.set([0, s, 1, s], k * 4);
      target[k * 2] = target[k * 2 + 1] = v[i];
      plan[k * 2] = plan[k * 2 + 1] = smooth[i];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aTarget', new THREE.BufferAttribute(target, 1));
    geo.setAttribute('aPlan', new THREE.BufferAttribute(plan, 1));
    geo.computeBoundingSphere();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uCarS: { value: -1e6 },
        uSpeed: { value: 0 },
        uLength: { value: this.length },
        // the car's mechanical braking (m/s²); aero adds more at speed, so the colours stay on the safe side
        uBrake: { value: limits.muBrake * 9.81 },
        uOpacity: { value: 0.82 },
      },
      vertexShader: /* glsl */ `
        attribute float aTarget;
        attribute float aPlan;
        varying vec2 vUv;
        varying float vTarget;
        varying float vPlan;
        varying float vDepth;
        void main() {
          vUv = uv;
          vTarget = aTarget;
          vPlan = aPlan;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uCarS;
        uniform float uSpeed;
        uniform float uLength;
        uniform float uBrake;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vTarget;
        varying float vPlan;
        varying float vDepth;
        const vec3 GO = vec3(0.10, 0.85, 0.30);
        const vec3 LIFT = vec3(1.0, 0.72, 0.05);
        const vec3 BRAKE = vec3(1.0, 0.10, 0.12);
        void main() {
          // distance ahead of the car along the line (wraps at the line)
          float ahead = mod(vUv.y - uCarS + uLength, uLength);
          // the plan: 0 go … 1 lift … 2 brake
          float k = vPlan;
          if (ahead < ${LOOKAHEAD_M.toFixed(1)}) {
            // deceleration needed to be at this point's target speed (share of the car's braking)
            float need = max(0.0, uSpeed * uSpeed - vTarget * vTarget) / (2.0 * max(ahead, 4.0)) / uBrake;
            float dyn = need > 0.62 ? 2.0 : need > 0.25 ? mix(1.0, 2.0, (need - 0.25) / 0.37) : need > 0.06 ? 1.0 : 0.0;
            // blend into the plan at the end of the look-ahead
            k = mix(dyn, vPlan, smoothstep(${(LOOKAHEAD_M * 0.7).toFixed(1)}, ${LOOKAHEAD_M.toFixed(1)}, ahead));
          }
          vec3 col = k < 1.0 ? mix(GO, LIFT, k) : mix(LIFT, BRAKE, k - 1.0);
          // chevrons pointing along the line: a V across the ribbon, repeated every ${CHEVRON_M} m
          float x = abs(vUv.x - 0.5) * 2.0;
          float p = fract((vUv.y + x * 0.9) / ${CHEVRON_M.toFixed(1)});
          float w = fwidth(p) * 1.5 + 0.02;
          float band = smoothstep(0.0, w, p) * (1.0 - smoothstep(0.34 - w, 0.34, p));
          // soft edges across the ribbon
          float edge = 1.0 - smoothstep(0.78, 1.0, x);
          // a faint body between the chevrons keeps the line readable far away, where the chevrons blur
          float far = smoothstep(60.0, 160.0, vDepth);
          float a = mix(band * 0.95 + 0.12, 0.55, far) * edge;
          // not under the car's nose, and fading into the distance
          a *= smoothstep(2.5, 9.0, ahead < uLength - 30.0 ? ahead : 99.0) * (1.0 - smoothstep(260.0, 420.0, vDepth));
          gl_FragColor = vec4(col * 1.15, a * uOpacity);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    const build = (onlyCorners: boolean) => {
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const j = i + 1;
        // corners mode: braking zones and corners, plus a short green lead-in so the brake point is readable
        if (onlyCorners && kind[i] === 0 && kind[(i + 1) % n] === 0 && kind[(i + 2) % n] === 0 && kind[(i + 3) % n] === 0 && kind[(i + 4) % n] === 0) continue;
        idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
      }
      const g = geo.clone();
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, this.mat);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      return mesh;
    };
    this.meshes = { corners: build(true), full: build(false) };
    this.object.add(this.meshes.corners, this.meshes.full);
    this.object.name = 'racing-line';
  }

  setMode(mode: RacingLineMode): void {
    this.meshes.corners.visible = mode === 'corners';
    this.meshes.full.visible = mode === 'full';
  }

  /** Every frame: the car's centreline index and speed (m/s), for the dynamic colours. */
  update(index: number, speedMs: number): void {
    if (!this.object.visible) return;
    const u = this.mat.uniforms;
    u.uCarS.value = this.cumS[Math.max(0, Math.min(this.cumS.length - 1, index))];
    u.uSpeed.value = speedMs;
  }
}
