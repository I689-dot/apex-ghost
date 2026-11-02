import type { TrackData } from '@apex/shared';
import { h } from './dom';

/** A car on the map: where, its number to show (car number or position), and how it relates to you. */
export interface MapCar {
  x: number;
  z: number;
  label: string;
  me: boolean;
  /** iRacing's colours: a lap or more ahead red, behind blue, in the pits grey, your lap white. */
  lap: 'ahead' | 'behind' | 'same';
  inPit: boolean;
}

/**
 * The corners of a circuit, numbered along the lap: stretches of the lap line turning tighter than ~260 m radius,
 * split where the turn changes hand (chicanes are two), one number each at its tightest point. With the circuit's
 * official count, the gentlest extra ones are left out.
 */
export function findCorners(td: TrackData, expected?: number | null): { x: number; z: number; out: [number, number]; s: number }[] {
  const cl = td.centerline;
  const n = cl.length / 3;
  const heading = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    heading[i] = Math.atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]);
  }
  const step = td.length / n;
  const win = Math.max(1, Math.round(15 / step));
  const kappa = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let d = heading[(i + win) % n] - heading[(i - win + n) % n];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    kappa[i] = d / (2 * win * step);
  }
  const THRESH = 1 / 260;
  // regions of one hand, short gaps of the same hand bridged
  const regions: { from: number; to: number; sign: number; peak: number; turn: number }[] = [];
  let cur: (typeof regions)[number] | null = null;
  const gapMax = Math.round(25 / step);
  let gap = 0;
  for (let i = 0; i < n; i++) {
    const k = kappa[i];
    const sign = Math.sign(k);
    if (Math.abs(k) > THRESH) {
      if (cur && sign === cur.sign) {
        cur.to = i;
        gap = 0;
      } else {
        cur = { from: i, to: i, sign, peak: i, turn: 0 };
        regions.push(cur);
        gap = 0;
      }
      if (Math.abs(k) > Math.abs(kappa[cur.peak])) cur.peak = i;
      cur.turn += Math.abs(k) * step;
    } else if (cur && ++gap > gapMax) cur = null;
  }
  let corners = regions.filter((r) => (r.to - r.from) * step > 12 && r.turn > 0.25);
  if (expected && corners.length > expected) {
    const keep = new Set([...corners].sort((a, b) => b.turn - a.turn).slice(0, expected));
    corners = corners.filter((c) => keep.has(c));
  }
  return corners.map((c) => {
    const i = c.peak;
    const j = (i + 1) % n;
    const tx = cl[j * 3] - cl[i * 3];
    const tz = cl[j * 3 + 2] - cl[i * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    // outside of the corner: away from its centre (left normal is (tz, -tx); a left-hander turns that way)
    const s = c.sign > 0 ? -1 : 1;
    return { x: cl[i * 3], z: cl[i * 3 + 2], out: [(tz / tl) * s, (-tx / tl) * s] as [number, number], s: td.cumS[i] };
  });
}

/**
 * The circuit map as iRacing draws it: the whole layout (north-up, not turning with you), a dark track with white
 * edges, the start/finish line, the corners numbered, every car a numbered dot, yours on yellow. The track is drawn
 * once; the cars ~10 times a second.
 */
export class CircuitMap {
  readonly el = h('div.circuit-map');
  private canvas = h('canvas', { width: 520, height: 400 });
  private g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private k = 1;
  private ox = 0;
  private oz = 0;

  constructor() {
    this.el.append(this.canvas);
  }

  setTrack(td: TrackData, turns?: number | null): void {
    const W = 520;
    const H = 400;
    const pad = 30;
    const cl = td.centerline;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < cl.length; i += 3) {
      x0 = Math.min(x0, cl[i]);
      x1 = Math.max(x1, cl[i]);
      z0 = Math.min(z0, cl[i + 2]);
      z1 = Math.max(z1, cl[i + 2]);
    }
    this.k = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (z1 - z0 || 1));
    this.ox = (W - (x1 - x0) * this.k) / 2 - x0 * this.k;
    this.oz = (H - (z1 - z0) * this.k) / 2 - z0 * this.k;
    const base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    const g = base.getContext('2d') as CanvasRenderingContext2D;
    const path = new Path2D();
    for (let i = 0; i < cl.length; i += 3) {
      const [x, y] = this.px(cl[i], cl[i + 2]);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 15;
    g.stroke(path);
    g.strokeStyle = '#121418';
    g.lineWidth = 10;
    g.stroke(path);
    // the start/finish line, across the track
    const [sx, sy] = this.px(cl[0], cl[2]);
    const [nx, ny] = this.px(cl[3], cl[5]);
    const a = Math.atan2(ny - sy, nx - sx) + Math.PI / 2;
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(sx - Math.cos(a) * 13, sy - Math.sin(a) * 13);
    g.lineTo(sx + Math.cos(a) * 13, sy + Math.sin(a) * 13);
    g.stroke();
    // the corners' numbers outside each corner
    g.font = 'bold 19px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    findCorners(td, turns).forEach((c, i) => {
      const [x, y] = this.px(c.x, c.z);
      const lx = x + c.out[0] * 22;
      const ly = y + c.out[1] * 22;
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(String(i + 1), lx, ly);
      g.fillStyle = '#fff';
      g.fillText(String(i + 1), lx, ly);
    });
    this.base = base;
    this.draw([]);
  }

  private px(x: number, z: number): [number, number] {
    return [this.ox + x * this.k, this.oz + z * this.k];
  }

  draw(cars: MapCar[]): void {
    const g = this.g;
    g.clearRect(0, 0, 520, 400);
    if (this.base) g.drawImage(this.base, 0, 0);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // you last, on top
    for (const c of [...cars].sort((a, b) => Number(a.me) - Number(b.me))) {
      const [x, y] = this.px(c.x, c.z);
      const r = c.me ? 15 : 11;
      g.fillStyle = c.me ? '#ffd60a' : c.inPit ? '#8b9099' : c.lap === 'ahead' ? '#ff5a52' : c.lap === 'behind' ? '#4aa3ff' : '#f2f2f2';
      g.strokeStyle = '#111';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#111';
      g.font = `bold ${c.me ? 17 : 13}px "Barlow Condensed", sans-serif`;
      g.fillText(c.label, x, y + 1);
    }
  }
}
