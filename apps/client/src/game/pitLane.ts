import * as THREE from 'three';
import { MAX_PLAYERS, type PitLane, type TrackData } from '@apex/shared';
import { t } from '../i18n';

export type PitEvent = 'enter' | 'exit' | 'box' | null;

/** Length of a garage's box along the lane (m). */
const BOX_M = 12.5;

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
    // the whole painted box counts (with a couple of points of grace at both ends), anywhere across the lane
    const inBox = this.index >= this.lane.boxFrom - 2 && this.index <= this.lane.boxTo + 2 && this.dist < 7;
    if (inBox && speed < 0.8 && !this.inBoxStop) {
      this.inBoxStop = true;
      return 'box';
    }
    // moving again (even slowly, to find a better spot) re-arms it: the next stop opens the menu again
    if (!inBox || speed > 1.2) this.inBoxStop = false;
    return null;
  }

  get limitMs(): number {
    return this.lane.speedLimitKmh / 3.6;
  }

  /** Boxes along the garage row (one per garage, ~12.5 m) as [first, last] lane points. */
  boxes(): [number, number][] {
    const { boxFrom: f, boxTo: to, points } = this.lane;
    const step = Math.hypot(points[f + 1][0] - points[f][0], points[f + 1][2] - points[f][2]) || 2.5;
    const per = Math.max(3, Math.round(BOX_M / step));
    const out: [number, number][] = [];
    for (let i = f; i + per - 1 <= to; i += per) out.push([i, i + per - 1]);
    return out;
  }

  /** The box of a grid slot: drivers spread evenly along the row, as teams have garages along a real pit lane. */
  boxOf(slot: number): number {
    const n = this.boxes().length;
    return Math.min(n - 1, Math.max(0, Math.floor(((slot + 0.5) * n) / MAX_PLAYERS)));
  }

  /**
   * The pit boxes painted along the whole garage row: a white outline in front of every garage, the driver's own
   * box in yellow with their name on a board above it, and a PIT SERVICE board where the row starts. Service works
   * in any box (the whole row counts); the own box is where the crew waits.
   */
  buildMarkings(ground: (x: number, z: number, y: number) => number, mine: { slot: number; name: string } | null): THREE.Object3D {
    const g = new THREE.Group();
    g.name = 'pit-markings';
    const pts = this.lane.points;
    const paint = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    const white = paint(0xf2f2f2, 0.8);
    const yellow = paint(0xffd60a, 0.9);
    const fill = paint(0xffd60a, 0.22);
    const half = 3;
    const strip = (from: number, to: number, offset: number, width: number, mat: THREE.Material) => {
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
    const boxes = this.boxes();
    const own = mine ? this.boxOf(mine.slot) : -1;
    boxes.forEach(([a, b], k) => {
      const mat = k === own ? yellow : white;
      // a gap of a point between neighbouring boxes; front and back lines across, sides along the lane
      strip(a, b - 1, half, 0.18, mat);
      strip(a, b - 1, -half, 0.18, mat);
      strip(a, a + 1, 0, half * 2, mat);
      strip(b - 2, b - 1, 0, half * 2, mat);
      if (k === own) strip(a + 1, b - 2, 0, half * 2 - 0.4, fill);
    });
    // where the row starts: what it is; over the own box: whose it is
    const board = (at: number, title: string, sub: string, colour: string) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const cx = c.getContext('2d') as CanvasRenderingContext2D;
      cx.fillStyle = '#111';
      cx.fillRect(0, 0, 512, 128);
      cx.fillStyle = colour;
      cx.font = 'bold 60px sans-serif';
      cx.textAlign = 'center';
      cx.fillText(title, 256, 64, 490);
      cx.font = 'bold 28px sans-serif';
      cx.fillStyle = '#fff';
      cx.fillText(sub, 256, 108, 490);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const p = pts[at];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      const a = pts[Math.max(0, at - 2)];
      const b = pts[Math.min(pts.length - 1, at + 2)];
      m.position.set(p[0], ground(p[0], p[2], p[1]) + 5.2, p[2]);
      m.rotation.y = Math.atan2(b[0] - a[0], b[2] - a[2]) + Math.PI; // facing the cars coming down the lane
      g.add(m);
    };
    if (boxes.length) board(boxes[0][0], t('PIT SERVICE'), t('STOP IN ANY BOX · TYRES · REPAIRS'), '#ffd60a');
    if (own >= 0 && mine) board(Math.round((boxes[own][0] + boxes[own][1]) / 2), mine.name.toUpperCase(), t('YOUR BOX'), '#ffd60a');
    return g;
  }
}
