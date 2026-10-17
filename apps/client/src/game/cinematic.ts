import * as THREE from 'three';
import type { TrackData } from '@apex/shared';
import { h } from '../ui/dom';

export interface Entrant {
  slot: number;
  nick: string;
  carName: string;
  color: string;
  me: boolean;
  bot: boolean;
}

export interface CinematicInfo {
  trackName: string;
  facts: string[];
  format: string;
}

/** When the grid pass ends and the cockpit takes over (ms before the green light): the lights start at 3 s. */
const HANDOVER_MS = 4200;
const PER_CAR_MS = 1150;
const MIN_GRID_MS = 3500;
const MAX_GRID_MS = 9500;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const _look = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Pre-race cinematic, as in TV coverage and F1/GT games:
 *  1. aerial flyover of the circuit with a title card and the track map drawing itself (also while everyone loads);
 *  2. a pass down the grid, back to front, with a name card for every driver;
 *  3. hand-over to the cockpit before the start lights. Enter / Space skips it (only for you).
 * Timed against the server's start time, so it ends at the same moment for everyone.
 */
export class Cinematic {
  readonly camera: THREE.PerspectiveCamera;
  readonly el: HTMLElement;
  active = true;
  /** Ghost fading and HUD must stay off while this is true. */
  private card: HTMLElement;
  private cardKey = -2;
  private titleEl: HTMLElement;
  private phase: 'fly' | 'grid' | 'done' = 'fly';
  private t = 0;
  private readonly center = new THREE.Vector3();
  private readonly radius: number;
  private readonly gridFwd = new THREE.Vector3();
  private readonly gridMid = new THREE.Vector3();
  private readonly order: Entrant[];

  constructor(
    private readonly track: TrackData,
    private readonly entrants: Entrant[],
    info: CinematicInfo,
  ) {
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 16000);
    // circuit centre and size from the centreline
    const cl = track.centerline;
    const box = new THREE.Box3();
    for (let i = 0; i < cl.length; i += 3) box.expandByPoint(_p.set(cl[i], cl[i + 1], cl[i + 2]));
    box.getCenter(this.center);
    const size = box.getSize(_p);
    this.radius = Math.max(size.x, size.z) * 0.62;
    // grid frame: forward from the pole slot's yaw, the middle of the two columns
    const g0 = track.grid[0];
    this.gridFwd.set(Math.sin(g0.yaw), 0, Math.cos(g0.yaw));
    const used = entrants.map((e) => track.grid[e.slot] ?? g0);
    for (const g of used) this.gridMid.add(_p.set(g.p[0], g.p[1], g.p[2]));
    this.gridMid.divideScalar(Math.max(1, used.length));
    // back of the grid first, pole last
    this.order = [...entrants].sort((a, b) => b.slot - a.slot);

    this.titleEl = h(
      'div.cine-title',
      {},
      h('div.cine-kicker', { text: 'LIVE · QUALIFYING SESSION' }),
      h('h1', { text: info.trackName }),
      h('div.cine-facts', {}, ...info.facts.map((f) => h('span', { text: f }))),
      h('div.cine-format', { text: info.format }),
    );
    const list = h(
      'ol.cine-entry',
      {},
      ...[...entrants]
        .sort((a, b) => a.slot - b.slot)
        .map((e) =>
          h(
            `li${e.me ? '.me' : ''}`,
            {},
            h('b', { text: `P${e.slot + 1}` }),
            h('i', { style: `background:${e.color}` }),
            h('span', { text: e.nick }),
            h('em', { text: e.carName }),
          ),
        ),
    );
    this.card = h('div.cine-card');
    this.el = h(
      'div.cinematic',
      {},
      h('div.cine-bar.top'),
      h('div.cine-bar.bottom'),
      this.titleEl,
      h('div.cine-side', {}, this.trackMap(), list),
      this.card,
      h('div.cine-skip', { text: 'Enter: skip' }),
    );
  }

  /** The circuit as an SVG path that draws itself (stroke-dashoffset animation). */
  private trackMap(): SVGSVGElement {
    const cl = this.track.centerline;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < cl.length; i += 3) {
      minX = Math.min(minX, cl[i]);
      maxX = Math.max(maxX, cl[i]);
      minZ = Math.min(minZ, cl[i + 2]);
      maxZ = Math.max(maxZ, cl[i + 2]);
    }
    const pad = 40;
    let d = '';
    for (let i = 0; i < cl.length; i += 6) d += `${i ? 'L' : 'M'}${(cl[i] - minX + pad).toFixed(0)} ${(cl[i + 2] - minZ + pad).toFixed(0)}`;
    d += 'Z';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${(maxX - minX + 2 * pad).toFixed(0)} ${(maxZ - minZ + 2 * pad).toFixed(0)}`);
    svg.classList.add('cine-map');
    const back = document.createElementNS(ns, 'path');
    back.setAttribute('d', d);
    back.classList.add('under');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('pathLength', '1000');
    path.classList.add('draw');
    const start = document.createElementNS(ns, 'circle');
    start.setAttribute('cx', (cl[0] - minX + pad).toFixed(0));
    start.setAttribute('cy', (cl[2] - minZ + pad).toFixed(0));
    start.setAttribute('r', '28');
    start.classList.add('start');
    svg.append(back, path, start);
    return svg;
  }

  /** True during the aerial flyover (high camera). */
  get aerial(): boolean {
    return this.active && this.phase === 'fly';
  }

  skip(): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.finish();
  }

  private finish(): void {
    this.active = false;
    this.el.classList.add('out');
    setTimeout(() => this.el.remove(), 900);
  }

  /** How long the grid pass lasts for this field. */
  private gridMs(): number {
    return Math.min(MAX_GRID_MS, Math.max(MIN_GRID_MS, this.order.length * PER_CAR_MS));
  }

  /**
   * @param msToStart milliseconds until the green light, or null while drivers are still loading
   * @returns true while the cinematic owns the camera
   */
  update(dt: number, msToStart: number | null): boolean {
    if (!this.active) return false;
    this.t += dt;
    const gridMs = this.gridMs();
    if (msToStart !== null && msToStart <= HANDOVER_MS) {
      this.phase = 'done';
      this.finish();
      return false;
    }
    const inGrid = msToStart !== null && msToStart <= HANDOVER_MS + gridMs;
    if (inGrid && this.phase === 'fly') {
      this.phase = 'grid';
      this.el.classList.add('grid');
    }
    if (this.phase === 'fly') this.flyover();
    else this.gridPass(1 - ((msToStart as number) - HANDOVER_MS) / gridMs);
    return true;
  }

  private flyover(): void {
    // a tight, high orbit looking steeply down: the circuit fills the frame and the map's edge stays hidden
    const a = this.t * 0.07 + 0.6;
    const r = this.radius * (0.42 - 0.06 * Math.sin(this.t * 0.11));
    const cam = this.camera;
    cam.position.set(this.center.x + Math.sin(a) * r, this.center.y + this.radius * 0.62, this.center.z + Math.cos(a) * r);
    _look.copy(this.center);
    _look.y -= this.radius * 0.1;
    cam.lookAt(_look);
    this.setCard(-1);
  }

  /** u: 0 → 1 over the grid pass. The camera tracks down the middle of the grid, looking at each car in turn. */
  private gridPass(u: number): void {
    const n = this.order.length;
    if (n === 0) return;
    const x = Math.min(n - 1e-6, Math.max(0, u * n));
    const i = Math.floor(x);
    const f = smooth(x - i);
    const a = this.order[i];
    const b = this.order[Math.min(n - 1, i + 1)];
    const ga = this.track.grid[a.slot] ?? this.track.grid[0];
    const gb = this.track.grid[b.slot] ?? this.track.grid[0];
    const target = _look.set(ga.p[0], ga.p[1] + 0.7, ga.p[2]).lerp(_p.set(gb.p[0], gb.p[1] + 0.7, gb.p[2]), i + 1 < n ? f * 0.35 : 0);
    // camera on the grid's centre line, a few metres ahead of the car it looks at, low like a TV dolly
    const along = (target.x - this.gridMid.x) * this.gridFwd.x + (target.z - this.gridMid.z) * this.gridFwd.z;
    const cam = this.camera;
    cam.position.set(
      this.gridMid.x + this.gridFwd.x * (along + 6.5),
      target.y + 0.9 + 0.4 * Math.sin(this.t * 0.8),
      this.gridMid.z + this.gridFwd.z * (along + 6.5),
    );
    cam.lookAt(target);
    this.setCard(x - i < 0.85 || i + 1 >= n ? i : i + 1);
  }

  private setCard(i: number): void {
    if (i === this.cardKey) return;
    this.cardKey = i;
    if (i < 0) {
      this.card.classList.remove('show');
      return;
    }
    const e = this.order[i];
    this.card.replaceChildren(
      h('div.pos', { text: `P${e.slot + 1}` }),
      h('div.stripe', { style: `background:${e.color}` }),
      h('div.who', {}, h('div.nick', { text: `${e.nick}${e.me ? '  ·  YOU' : ''}${e.bot ? '  ·  AI' : ''}` }), h('div.car', { text: e.carName })),
    );
    this.card.classList.remove('show');
    // restart the slide-in animation
    void this.card.offsetWidth;
    this.card.classList.add('show');
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
