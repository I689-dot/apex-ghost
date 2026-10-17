import * as THREE from 'three';
import type { CarSpecs, TrackData } from '@apex/shared';
import type { GroundHit, GroundQuery } from '../physics/vehicle';
import { carLimits, racingLineFor, speedProfile } from './ai';

export type RacingLineMode = 'off' | 'corners' | 'full';

const WIDTH = 0.7;
const LIFT = 0.03;
const BRAKE = new THREE.Color('#ff2d3d');
const LIFT_COL = new THREE.Color('#ffd60a');
const GO = new THREE.Color('#30d158');

/**
 * Racing-line assist (as in F1 and Gran Turismo): the optimal line painted on the road, coloured from the
 * speed profile of *your* car: red = brake, yellow = lift/coast through the corner, green = full throttle.
 * "corners" shows only the braking zones and corners; "full" the whole lap.
 */
export class RacingLineFx {
  readonly object = new THREE.Group();
  private meshes: Record<'corners' | 'full', THREE.Mesh>;

  constructor(track: TrackData, specs: CarSpecs, ground: GroundQuery) {
    const line = racingLineFor(track);
    // a realistic target, not the absolute limit: what a good driver brakes for
    const v = speedProfile(line, carLimits(specs, 0.94), 1, true);
    const n = v.length;
    const kind = new Uint8Array(n); // 0 go, 1 lift, 2 brake
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const acc = (v[j] * v[j] - v[i] * v[i]) / (2 * line.ds[i]);
      if (acc < -2.5) kind[i] = 2;
      else if (acc < 1.5 && Math.abs(line.curvature[i]) > 1 / 350) kind[i] = 1;
    }
    // ground heights under the line
    const y = new Float32Array(n);
    const hit: GroundHit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
    for (let i = 0; i < n; i++) {
      const cy = track.centerline[i * 3 + 1];
      // start just above the road: a ray from higher up could land on a bridge over the track
      y[i] = ground.cast(line.x[i], cy + 2.5, line.z[i], 0, -1, 0, 6, hit) ? hit.py : cy;
    }
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const tx = line.x[b] - line.x[a];
      const tz = line.z[b] - line.z[a];
      const l = Math.hypot(tx, tz) || 1;
      const sx = (tz / l) * (WIDTH / 2);
      const sz = (-tx / l) * (WIDTH / 2);
      pos.set([line.x[i] + sx, y[i] + LIFT, line.z[i] + sz, line.x[i] - sx, y[i] + LIFT, line.z[i] - sz], i * 6);
      const c = kind[i] === 2 ? BRAKE : kind[i] === 1 ? LIFT_COL : GO;
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    const build = (onlyCorners: boolean) => {
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // corners mode: braking zones and corners, plus a short green lead-in so the brake point is readable
        if (onlyCorners && kind[i] === 0 && kind[j] === 0 && kind[(i + 2) % n] === 0 && kind[(i + 3) % n] === 0) continue;
        idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
      }
      const g = geo.clone();
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 2;
      m.frustumCulled = false;
      return m;
    };
    this.meshes = { corners: build(true), full: build(false) };
    this.object.add(this.meshes.corners, this.meshes.full);
    this.object.name = 'racing-line';
  }

  setMode(mode: RacingLineMode): void {
    this.meshes.corners.visible = mode === 'corners';
    this.meshes.full.visible = mode === 'full';
  }
}
