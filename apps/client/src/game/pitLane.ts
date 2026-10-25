import * as THREE from 'three';
import { MAX_PLAYERS, nearestCenterlineIndex, type PitLane, type TrackData } from '@apex/shared';
import { t } from '../i18n';

export type PitEvent = 'enter' | 'exit' | 'box' | null;

/** Length of a garage's box along the lane (m), and half its width across. */
const BOX_M = 12.5;
const HALF = 3;
/** A box's outer edge this far from the garage front (m). */
const GARAGE_GAP = 0.8;
/** Our pit lane surface over the model's road (m): above its painted lines, which it replaces with ours. */
const SURFACE_LIFT = 0.03;

/** Distance (m) to the nearest wall from (x, y, z) horizontally along (dx, dz), or null within `max`. */
export type WallProbe = (x: number, y: number, z: number, dx: number, dz: number, max: number) => number | null;

interface LaneGeometry {
  /** Unit vector (x, z) across the lane at each point, pointing away from the circuit (towards the garages). */
  away: [number, number][];
  /** How far each box sits from the traced line towards its garage (m): measured once per track. */
  boxShift: number[] | null;
}

const geometry = new WeakMap<PitLane, LaneGeometry>();

/** The lane's cross directions (and box shifts, once measured): shared by every monitor of a track (bots too). */
export function laneGeometry(track: TrackData): LaneGeometry {
  const lane = track.pitLane as PitLane;
  const hit = geometry.get(lane);
  if (hit) return hit;
  const pts = lane.points;
  const cl = track.centerline;
  const away: [number, number][] = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    let nx = (b[2] - a[2]) / l;
    let nz = -(b[0] - a[0]) / l;
    const c = nearestCenterlineIndex(track, p[0], p[1], p[2], -1);
    if (nx * (p[0] - cl[c * 3]) + nz * (p[2] - cl[c * 3 + 2]) < 0) {
      nx = -nx;
      nz = -nz;
    }
    return [nx, nz];
  });
  const g = { away, boxShift: null };
  geometry.set(lane, g);
  return g;
}

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

  private readonly geo: LaneGeometry;
  /** Markings above the road (m); above our own surface where there is one (buildSurface). */
  private paintLift = 0.025;

  constructor(track: TrackData) {
    if (!track.pitLane) throw new Error('track has no pit lane');
    this.lane = track.pitLane;
    this.geo = laneGeometry(track);
  }

  /**
   * Where the boxes really are. The traced lane runs nearer the pit wall than the garages (at the Nürburgring 6 m
   * from the wall, 11 m from the garages), so boxes drawn on it sat in the fast lane, some on the track side of the
   * lane. Each box goes in front of its garage: the wall found across the lane, a box width and a gap off it.
   */
  measureBoxes(probe: WallProbe): void {
    if (this.geo.boxShift) return;
    const pts = this.lane.points;
    const shift = this.boxes().map(([a, b]) => {
      const d: number[] = [];
      for (let i = a; i <= b; i++) {
        const [ax, az] = this.geo.away[i];
        const h = probe(pts[i][0], pts[i][1], pts[i][2], ax, az, 25);
        if (h !== null) d.push(h);
      }
      if (d.length < (b - a + 1) / 2) return null;
      d.sort((x, y) => x - y);
      return Math.min(15, Math.max(0, d[Math.floor(d.length / 2)] - GARAGE_GAP - HALF));
    });
    const found = shift.filter((x): x is number => x !== null).sort((x, y) => x - y);
    const typical = found.length ? found[Math.floor(found.length / 2)] : 0;
    this.geo.boxShift = shift.map((x) => x ?? typical);
  }

  /** The box shift (m towards the garages) at lane point i (0 outside the boxes or before measureBoxes). */
  shiftAt(i: number): number {
    const sh = this.geo.boxShift;
    if (!sh) return 0;
    const k = this.boxes().findIndex(([a, b]) => i >= a - 2 && i <= b + 2);
    return k < 0 ? 0 : sh[k];
  }

  /** Unit vector across the lane at point i, away from the circuit. */
  awayAt(i: number): [number, number] {
    return this.geo.away[Math.max(0, Math.min(this.geo.away.length - 1, i))];
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
    // the whole painted box counts (with a couple of points of grace at both ends and a little either side of it)
    const p = this.lane.points[this.index];
    const [ax, az] = this.awayAt(this.index);
    const across = (x - p[0]) * ax + (z - p[2]) * az;
    const inBox = this.index >= this.lane.boxFrom - 2 && this.index <= this.lane.boxTo + 2 && Math.abs(across - this.shiftAt(this.index)) < HALF + 1.5;
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
        // the strips are laid out towards the garages, which is left or right of the lane: either winding
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    const white = paint(0xf2f2f2, 0.8);
    const yellow = paint(0xffd60a, 0.9);
    const fill = paint(0xffd60a, 0.22);
    const half = HALF;
    // across the lane: away from the circuit, each box moved in front of its garage (measureBoxes)
    const strip = (from: number, to: number, offset: number, width: number, mat: THREE.Material) => {
      const pos: number[] = [];
      for (let i = from; i <= to; i++) {
        const [nx, nz] = this.awayAt(i);
        const o = offset + this.shiftAt(i);
        const p = pts[i];
        const x0 = p[0] + nx * (o - width / 2);
        const z0 = p[2] + nz * (o - width / 2);
        const x1 = p[0] + nx * (o + width / 2);
        const z1 = p[2] + nz * (o + width / 2);
        pos.push(x0, ground(x0, z0, p[1]) + this.paintLift, z0, x1, ground(x1, z1, p[1]) + this.paintLift, z1);
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
    // a line across the lane at point i (the box's front or back), `t` m thick along the lane
    const bar = (i: number, mat: THREE.Material, t = 0.15) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
      const fx = ((b[0] - a[0]) / l) * (t / 2);
      const fz = ((b[2] - a[2]) / l) * (t / 2);
      const [nx, nz] = this.awayAt(i);
      const sh = this.shiftAt(i);
      const pos: number[] = [];
      for (const [o, f] of [
        [sh - half, -1],
        [sh + half, -1],
        [sh - half, 1],
        [sh + half, 1],
      ]) {
        const x = pts[i][0] + nx * o + fx * f;
        const z = pts[i][2] + nz * o + fz * f;
        pos.push(x, ground(x, z, pts[i][1]) + this.paintLift, z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex([0, 2, 1, 1, 2, 3]);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2;
      g.add(m);
    };
    const boxes = this.boxes();
    const own = mine ? this.boxOf(mine.slot) : -1;
    boxes.forEach(([a, b], k) => {
      const mat = k === own ? yellow : white;
      // sides along the lane, thin lines across at the front and the back (a point's gap to the next box)
      strip(a, b - 1, half, 0.15, mat);
      strip(a, b - 1, -half, 0.15, mat);
      bar(a, mat);
      bar(b - 1, mat);
      if (k === own) strip(a, b - 1, 0, half * 2 - 0.3, fill);
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
      const [ax, az] = this.awayAt(at);
      const sh = this.shiftAt(at);
      const p = [pts[at][0] + ax * sh, pts[at][1], pts[at][2] + az * sh];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      const a = pts[Math.max(0, at - 2)];
      const b = pts[Math.min(pts.length - 1, at + 2)];
      m.position.set(p[0], ground(p[0], p[2], p[1]) + 5.2, p[2]);
      m.rotation.y = Math.atan2(b[0] - a[0], b[2] - a[2]) + Math.PI; // facing the cars coming down the lane
      g.add(m);
    };
    // the line between the fast lane and the working lane, along the boxes' outer edge
    if (boxes.length) strip(boxes[0][0], boxes[boxes.length - 1][1], -half - 0.35, 0.14, white);
    if (boxes.length) board(boxes[0][0], t('PIT SERVICE'), t('STOP IN ANY BOX · TYRES · REPAIRS'), '#ffd60a');
    if (own >= 0 && mine) board(Math.round((boxes[own][0] + boxes[own][1]) / 2), mine.name.toUpperCase(), t('YOUR BOX'), '#ffd60a');
    return g;
  }

  /**
   * A pit lane surface over the model's (Zandvoort's lane is drawn in a near-white, flat tint of the track's asphalt
   * that the racing surface shares, so it can't be recoloured): grey asphalt with a fine grain from the pit wall to
   * the garages, both edges found with the wall probe, laid 3 cm over the visible ground (over the model's own lane
   * paint, broken bits of which showed through at 1.5 cm). Call before buildMarkings: they go on top of it.
   */
  buildSurface(ground: (x: number, z: number, y: number) => number, probe: WallProbe): THREE.Object3D {
    const pts = this.lane.points;
    const n = pts.length;
    // edges each side (m along `away`): the walls found, a margin off them, smoothed; open ends a lane's width
    const raw = pts.map((p, i) => {
      const [ax, az] = this.awayAt(i);
      const out = probe(p[0], p[1], p[2], ax, az, 20);
      const inn = probe(p[0], p[1], p[2], -ax, -az, 20);
      return [out === null ? 5 : Math.min(14, out - 0.25), inn === null ? 3 : Math.min(12, inn - 0.25)];
    });
    const edge = raw.map((_, i) => {
      const w = raw.slice(Math.max(0, i - 3), Math.min(n, i + 4));
      const med = (k: 0 | 1) => w.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(w.length / 2)];
      return [med(0), -med(1)];
    });
    const COLS = 8;
    const pos: number[] = [];
    const uv: number[] = [];
    let along = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
      const [ax, az] = this.awayAt(i);
      const [o, inn] = edge[i];
      for (let c = 0; c <= COLS; c++) {
        const d = inn + ((o - inn) * c) / COLS;
        const x = pts[i][0] + ax * d;
        const z = pts[i][2] + az * d;
        pos.push(x, ground(x, z, pts[i][1]) + SURFACE_LIFT, z);
        uv.push(d / 4, along / 4);
      }
    }
    const idx: number[] = [];
    // not over the first and last metres, where the lane joins the circuit
    for (let i = 4; i < n - 5; i++)
      for (let c = 0; c < COLS; c++) {
        const k = i * (COLS + 1) + c;
        idx.push(k, k + COLS + 1, k + 1, k + 1, k + COLS + 1, k + COLS + 2);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x84868b,
      map: asphaltGrain(),
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    mat.name = 'pits_surface';
    this.paintLift = SURFACE_LIFT + 0.015;
    const m = new THREE.Mesh(geo, mat);
    m.name = 'pit-surface';
    m.receiveShadow = true;
    m.renderOrder = 1;
    return m;
  }
}

/** A fine asphalt grain (tiling, 4 m), drawn once. */
let grain: THREE.Texture | null = null;
function asphaltGrain(): THREE.Texture {
  if (grain) return grain;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(256, 256);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 256 * 256; i++) {
    const v = 150 + rnd() * 70 + (rnd() < 0.04 ? 35 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain = new THREE.CanvasTexture(c);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.anisotropy = 8;
  return grain;
}
