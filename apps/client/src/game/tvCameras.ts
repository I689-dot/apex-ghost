import * as THREE from 'three';
import { indexAtDistance, pointAtDistance, type TrackData } from '@apex/shared';
import { findCorners } from '../ui/circuitMap';

/**
 * Is there a clear line from a to b? (the circuit's collision: walls, barriers, the ground; cars left out)
 * Returns the distance to the first hit, or null when nothing is in the way.
 */
export type SightProbe = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number | null;
/** Ground height under (x, z), from above (null: nothing there). */
export type GroundProbe = (x: number, z: number, fromY: number) => number | null;

interface Station {
  pos: THREE.Vector3;
  /** Lap distance this camera covers: from → to (wrapping). */
  from: number;
  to: number;
}

const _look = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Trackside TV cameras, as a race is broadcast (F1 has ~25 around a lap, "one camera per corner"; iRacing's TV
 * cameras each cover a stretch of the lap and the shot cuts as the car moves on): a camera on a tower on the
 * outside of every corner and along the long straights, fixed in place, panning to follow the car and zooming to
 * keep it the same size in the frame, a long lens from far away, a wider one as it passes. Each camera holds the
 * car as it comes towards it and a little after, then the next one takes it (a cut, never a move).
 * Placed once per track, every sightline checked against the circuit's walls, its ground and its trees.
 */
export class TvCameras {
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.5, 12000);
  private stations: Station[] = [];
  private current = -1;
  private readonly lookAt = new THREE.Vector3();
  private fov = 30;
  private t = 0;
  private readonly L: number;

  constructor(
    private readonly td: TrackData,
    sight: SightProbe,
    ground: GroundProbe,
  ) {
    this.L = td.length;
    this.place(sight, ground);
  }

  get count(): number {
    return this.stations.length;
  }

  private place(sight: SightProbe, ground: GroundProbe): void {
    const td = this.td;
    const L = td.length;
    const pt = { x: 0, y: 0, z: 0, yaw: 0 };
    const at = (s: number) => {
      pointAtS(td, s, pt);
      return pt;
    };
    // where the cameras look from: every corner (outside of it), the long straights filled in every ~380 m
    const spots: { s: number; side: number }[] = findCorners(td, td.turns).map((c) => {
      const p = at(c.s);
      // which side is outside: the corner's "out" direction against the track's left normal (cos yaw, -sin yaw)
      const left = Math.cos(p.yaw) * c.out[0] - Math.sin(p.yaw) * c.out[1];
      return { s: c.s, side: left > 0 ? 1 : -1 };
    });
    spots.sort((a, b) => a.s - b.s);
    if (spots.length === 0) spots.push({ s: 0, side: 1 });
    const filled: { s: number; side: number }[] = [];
    for (let i = 0; i < spots.length; i++) {
      const a = spots[i];
      const b = spots[(i + 1) % spots.length];
      filled.push(a);
      const gap = (b.s - a.s + L) % L || L;
      const extra = Math.floor(gap / 380);
      for (let k = 1; k <= extra; k++) filled.push({ s: (a.s + (gap * k) / (extra + 1)) % L, side: k % 2 ? -a.side : a.side });
    }
    filled.sort((a, b) => a.s - b.s);
    // each camera covers from 45 % of the way after the previous one to 45 % of the way to the next:
    // the car is shown coming towards it (the long-lens head-on shot) and going away for a short while
    const n = filled.length;
    for (let i = 0; i < n; i++) {
      const prev = filled[(i - 1 + n) % n];
      const cur = filled[i];
      const next = filled[(i + 1) % n];
      const gapIn = (cur.s - prev.s + L) % L || L;
      const gapOut = (next.s - cur.s + L) % L || L;
      const from = (prev.s + gapIn * 0.45) % L;
      const to = (cur.s + gapOut * 0.45) % L;
      const pos = this.bestSpot(cur, from, to, sight, ground);
      this.stations.push({ pos, from, to });
    }
  }

  /** A tower beside the track at `spot`: tries the outside, further back and higher, then the inside; the clearest wins. */
  private bestSpot(spot: { s: number; side: number }, from: number, to: number, sight: SightProbe, ground: GroundProbe): THREE.Vector3 {
    const td = this.td;
    const pt = { x: 0, y: 0, z: 0, yaw: 0 };
    pointAtS(td, spot.s, pt);
    const i = indexAtS(td, spot.s);
    const half = spot.side > 0 ? td.widthL[i] : td.widthR[i];
    const span = (to - from + this.L) % this.L;
    // the stretch the camera has to see: 9 points along it, 1 m above the road
    const targets: [number, number, number][] = [];
    const q = { x: 0, y: 0, z: 0, yaw: 0 };
    for (let k = 0; k <= 8; k++) {
      pointAtS(td, from + (span * k) / 8, q);
      targets.push([q.x, q.y + 1, q.z]);
    }
    let best: THREE.Vector3 | null = null;
    let bestSeen = -1;
    for (const side of [spot.side, -spot.side])
      for (const [off, up] of [
        [14, 6],
        [24, 9],
        [38, 14],
        [8, 4],
        // a crane over the trees, the last resort
        [16, 24],
      ]) {
        const lx = Math.cos(pt.yaw) * side;
        const lz = -Math.sin(pt.yaw) * side;
        const half2 = side === spot.side ? half : spot.side > 0 ? td.widthR[i] : td.widthL[i];
        const x = pt.x + lx * (half2 + off);
        const z = pt.z + lz * (half2 + off);
        const g = ground(x, z, pt.y + 200);
        const y = Math.max(pt.y, g ?? pt.y) + up;
        let seen = 0;
        for (const [tx, ty, tz] of targets) if (sight(x, y, z, tx, ty, tz) === null) seen++;
        // prefer the outside of the corner and the nearer towers when they see as much
        const score = seen + (side === spot.side ? 0.3 : 0) - off * 0.004;
        if (score > bestSeen) {
          bestSeen = score;
          best = new THREE.Vector3(x, y, z);
        }
        if (seen === targets.length && side === spot.side) return best as THREE.Vector3;
      }
    return best as THREE.Vector3;
  }

  /** The camera covering lap distance s. */
  private stationAt(s: number): number {
    const L = this.L;
    s = ((s % L) + L) % L;
    for (let i = 0; i < this.stations.length; i++) {
      const st = this.stations[i];
      const span = (st.to - st.from + L) % L;
      if ((s - st.from + L) % L <= span) return i;
    }
    return 0;
  }

  /** Starts the next shot as a cut (the first frame jumps straight onto the car). */
  reset(): void {
    this.current = -1;
  }

  /**
   * Follows a car: `pos` where it is, `vel` its velocity, `s` its lap distance.
   * @returns false when no camera could be placed (the caller keeps its own camera)
   */
  update(dt: number, pos: THREE.Vector3, vel: THREE.Vector3, s: number): boolean {
    if (!this.stations.length) return false;
    this.t += dt;
    const i = this.stationAt(s);
    const cut = i !== this.current;
    this.current = i;
    const st = this.stations[i];
    const cam = this.camera;
    // a tripod on a tower: the faintest sway of a long lens in the wind
    cam.position.set(st.pos.x + Math.sin(this.t * 0.9) * 0.03, st.pos.y + Math.sin(this.t * 1.3) * 0.02, st.pos.z);
    // the operator leads the car a little in the direction it is going
    _look.set(pos.x + vel.x * 0.12, pos.y + 0.6, pos.z + vel.z * 0.12);
    if (cut) this.lookAt.copy(_look);
    else this.lookAt.lerp(_look, 1 - Math.exp(-dt * 9));
    cam.lookAt(this.lookAt);
    // zoom: the car about a third of the frame's width (~14 m of scene across), wider as it passes close
    const d = _p.copy(this.lookAt).sub(cam.position).length();
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const frameH = 14 / aspect;
    const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(frameH / 2 / Math.max(1, d))), 2.5, 50);
    this.fov = cut ? fov : this.fov + (fov - this.fov) * (1 - Math.exp(-dt * 4));
    if (Math.abs(cam.fov - this.fov) > 0.01 || cam.aspect !== aspect) {
      cam.fov = this.fov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    return true;
  }
}

/** The centreline point index at lap distance s (shared/track.ts). */
const indexAtS = (td: TrackData, s: number): number => indexAtDistance(td, s);
/** Position and heading on the centreline at lap distance s (shared/track.ts). */
const pointAtS = (td: TrackData, s: number, out: { x: number; y: number; z: number; yaw: number }): void => pointAtDistance(td, s, out);
