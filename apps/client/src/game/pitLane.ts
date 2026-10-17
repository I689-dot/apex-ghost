import * as THREE from 'three';
import type { PitLane, TrackData } from '@apex/shared';
import { t } from '../i18n';

export type PitEvent = 'enter' | 'exit' | 'box' | null;

/**
 * Where the car is relative to the pit lane (from track.json, traced from the map: entry on the inside of the
 * last corner, along the start/finish straight behind the pit wall, exit before Turn 1).
 *  - enter: the car left the circuit into the lane → limiter on, the lap is lost, the next lap is an out lap;
 *  - box: stopped in the service zone (the garages) → service menu;
 *  - exit: back on the circuit.
 */
export class PitLaneMonitor {
  readonly lane: PitLane;
  inLane = false;
  index = -1;
  dist = Infinity;
  private inBoxStop = false;

  constructor(track: TrackData) {
    if (!track.pitLane) throw new Error('track has no pit lane');
    this.lane = track.pitLane;
  }

  /** Nearest lane point (local search around the last one). */
  private locate(x: number, z: number): void {
    const pts = this.lane.points;
    const from = this.index < 0 ? 0 : Math.max(0, this.index - 20);
    const to = this.index < 0 ? pts.length : Math.min(pts.length, this.index + 21);
    let best = Infinity;
    let bi = this.index;
    for (let i = from; i < to; i++) {
      const dx = pts[i][0] - x;
      const dz = pts[i][2] - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    this.index = bi;
    this.dist = Math.sqrt(best);
  }

  /**
   * @param offMain how far outside the circuit's edge the car is (m; ≤ 0 on the track)
   * @param speed m/s
   */
  update(x: number, z: number, offMain: number, speed: number): PitEvent {
    this.locate(x, z);
    if (this.dist > 40) this.index = -1; // far away: full search next time
    const n = this.lane.points.length;
    if (!this.inLane) {
      // entering: on the lane, past its first metres, clear of the circuit
      if (this.dist < 5 && this.index > 3 && this.index < n * 0.4 && offMain > 1) {
        this.inLane = true;
        this.inBoxStop = false;
        return 'enter';
      }
      return null;
    }
    // leaving: at the exit end back on the circuit, or anywhere well away from the lane
    if ((this.index >= n - 5 && offMain <= 0.5) || this.dist > 14) {
      this.inLane = false;
      return 'exit';
    }
    const inBox = this.index >= this.lane.boxFrom && this.index <= this.lane.boxTo;
    if (inBox && speed < 0.8 && !this.inBoxStop) {
      this.inBoxStop = true;
      return 'box';
    }
    if (!inBox || speed > 3) this.inBoxStop = false;
    return null;
  }

  get limitMs(): number {
    return this.lane.speedLimitKmh / 3.6;
  }

  /** The service zone painted on the lane: a yellow box outline with a few lines, and a board above it. */
  buildMarkings(ground: (x: number, z: number, y: number) => number): THREE.Object3D {
    const g = new THREE.Group();
    g.name = 'pit-markings';
    const pts = this.lane.points;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd60a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const half = 3;
    const strip = (from: number, to: number, offset: number, width: number) => {
      const pos: number[] = [];
      for (let i = from; i <= to; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const tx = b[0] - a[0];
        const tz = b[2] - a[2];
        const l = Math.hypot(tx, tz) || 1;
        const nx = tz / l;
        const nz = -tx / l;
        const p = pts[i];
        const y = ground(p[0], p[2], p[1]) + 0.025;
        pos.push(p[0] + nx * (offset - width / 2), y, p[2] + nz * (offset - width / 2), p[0] + nx * (offset + width / 2), y, p[2] + nz * (offset + width / 2));
      }
      const idx: number[] = [];
      for (let i = 0; i < to - from; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2;
      g.add(m);
    };
    const { boxFrom: f, boxTo: to } = this.lane;
    strip(f, to, half, 0.25);
    strip(f, to, -half, 0.25);
    strip(f, f + 1, 0, half * 2);
    strip(to - 1, to, 0, half * 2);
    // chevrons every 20 m inside the box
    for (let i = f + 6; i < to - 4; i += 8) strip(i, i + 1, 0, half * 1.6);
    // board over the middle of the service zone
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const cx = c.getContext('2d') as CanvasRenderingContext2D;
    cx.fillStyle = '#111';
    cx.fillRect(0, 0, 512, 128);
    cx.fillStyle = '#ffd60a';
    cx.font = 'bold 64px sans-serif';
    cx.textAlign = 'center';
    cx.fillText(t('PIT SERVICE'), 256, 66);
    cx.font = 'bold 30px sans-serif';
    cx.fillStyle = '#fff';
    cx.fillText(t('STOP HERE · TYRES · REPAIRS'), 256, 108);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mid = pts[Math.round((f + to) / 2)];
    const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    const a = pts[Math.round((f + to) / 2) - 2];
    const b = pts[Math.round((f + to) / 2) + 2];
    board.position.set(mid[0], ground(mid[0], mid[2], mid[1]) + 5.2, mid[2]);
    board.rotation.y = Math.atan2(b[0] - a[0], b[2] - a[2]) + Math.PI; // facing the cars coming down the lane
    g.add(board);
    return g;
  }
}
