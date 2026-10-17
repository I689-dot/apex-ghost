import * as THREE from 'three';
import type { TrackData } from '@apex/shared';
import type { Keyboard } from '../physics/input';
import type { CollisionMesh } from './assets';

const SURFACE_COLOR: Record<string, number> = { asphalt: 0x8e8e93, curb: 0xff375f, grass: 0x30d158, gravel: 0xffd60a, sand: 0xff9f0a, wall: 0x0a84ff };
import { h } from '../ui/dom';

/**
 * Dev-only track data overlay (toggle with F2): centreline, gates (sector gates in magenta,
 * start/finish in red), grid slots and road widths. Select a gate or grid slot with [ / ],
 * nudge it with I/J/K/L (0.5 m, Shift = 5 m), rotate grid slots with U/O, and export track.json.
 */
export class TrackEditor {
  private group = new THREE.Group();
  private panel: HTMLElement;
  private info: HTMLElement;
  private visible = false;
  private sel = 0;
  private gateLines: THREE.Line[] = [];
  private gridMarkers: THREE.Mesh[] = [];
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly data: TrackData,
    collision: CollisionMesh[] = [],
  ) {
    this.group.visible = false;
    scene.add(this.group);
    // surface types: the collision meshes tinted per surface
    for (const c of collision) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(c.indices, 1));
      const mat = new THREE.MeshBasicMaterial({
        color: SURFACE_COLOR[c.surface] ?? 0xffffff,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    const cl = data.centerline;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < cl.length; i += 3) pts.push(new THREE.Vector3(cl[i], cl[i + 1] + 0.3, cl[i + 2]));
    pts.push(pts[0].clone());
    this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x00e5ff, depthTest: false })));
    // road edges
    for (const side of [1, -1]) {
      const e: THREE.Vector3[] = [];
      const n = cl.length / 3;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const tx = cl[j * 3] - cl[i * 3];
        const tz = cl[j * 3 + 2] - cl[i * 3 + 2];
        const l = Math.hypot(tx, tz) || 1;
        const w = side > 0 ? data.widthL[i] : data.widthR[i];
        e.push(new THREE.Vector3(cl[i * 3] + (tz / l) * w * side, cl[i * 3 + 1] + 0.3, cl[i * 3 + 2] - (tx / l) * w * side));
      }
      this.group.add(
        new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(e),
          new THREE.LineBasicMaterial({ color: 0x5ac8fa, depthTest: false, transparent: true, opacity: 0.5 }),
        ),
      );
    }
    data.gates.forEach((_, i) => {
      const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: this.gateColor(i), depthTest: false }));
      this.gateLines.push(line);
      this.group.add(line);
    });
    data.grid.forEach(() => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 4.6), new THREE.MeshBasicMaterial({ color: 0xffd60a, wireframe: true, depthTest: false }));
      this.gridMarkers.push(m);
      this.group.add(m);
    });
    this.refresh();
    this.info = h('pre');
    this.panel = h(
      'div.editor',
      {},
      h('b', { text: 'Track data editor (F2)' }),
      this.info,
      h('button', { text: 'Export track.json', onclick: () => this.export() }),
    );
    this.panel.style.display = 'none';
    document.body.append(this.panel);
    window.addEventListener('keydown', this.keyHandler);
  }

  private gateColor(i: number): number {
    return i === 0 ? 0xff3b30 : this.data.sectorGates.includes(i) ? 0xff2dfc : 0x30d158;
  }

  private get items(): number {
    return this.data.gates.length + this.data.grid.length;
  }

  private refresh(): void {
    this.data.gates.forEach((g, i) => {
      const sx = g.d[2];
      const sz = -g.d[0];
      const a = new THREE.Vector3(g.p[0] + sx * g.hw, g.p[1] + 0.5, g.p[2] + sz * g.hw);
      const b = new THREE.Vector3(g.p[0] - sx * g.hw, g.p[1] + 0.5, g.p[2] - sz * g.hw);
      this.gateLines[i].geometry.setFromPoints([a, new THREE.Vector3(g.p[0], g.p[1] + 3, g.p[2]), b]);
      (this.gateLines[i].material as THREE.LineBasicMaterial).color.setHex(i === this.sel ? 0xffffff : this.gateColor(i));
    });
    this.data.grid.forEach((s, i) => {
      const m = this.gridMarkers[i];
      m.position.set(s.p[0], s.p[1] + 0.3, s.p[2]);
      m.rotation.set(0, s.yaw, 0);
      (m.material as THREE.MeshBasicMaterial).color.setHex(this.data.gates.length + i === this.sel ? 0xffffff : 0xffd60a);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'F2') {
      this.visible = !this.visible;
      this.group.visible = this.visible;
      this.panel.style.display = this.visible ? 'block' : 'none';
      e.preventDefault();
      return;
    }
    if (!this.visible) return;
    const step = e.shiftKey ? 5 : 0.5;
    let target: { p: [number, number, number] } | null = null;
    const ng = this.data.gates.length;
    if (this.sel < ng) target = this.data.gates[this.sel];
    else target = this.data.grid[this.sel - ng];
    switch (e.code) {
      case 'BracketRight':
        this.sel = (this.sel + 1) % this.items;
        break;
      case 'BracketLeft':
        this.sel = (this.sel - 1 + this.items) % this.items;
        break;
      case 'KeyI':
        target.p[2] -= step;
        break;
      case 'KeyK':
        target.p[2] += step;
        break;
      case 'KeyJ':
        target.p[0] -= step;
        break;
      case 'KeyL':
        target.p[0] += step;
        break;
      case 'KeyU':
        if (this.sel >= ng) this.data.grid[this.sel - ng].yaw += 0.02;
        break;
      case 'KeyO':
        if (this.sel >= ng) this.data.grid[this.sel - ng].yaw -= 0.02;
        break;
      default:
        return;
    }
    this.refresh();
  }

  update(_kb: Keyboard): void {
    if (!this.visible) return;
    const ng = this.data.gates.length;
    const label =
      this.sel < ng
        ? `gate ${this.sel}${this.sel === 0 ? ' (start/finish)' : this.data.sectorGates.includes(this.sel) ? ' (sector)' : ''}`
        : `grid slot ${this.sel - ng + 1}`;
    const p = this.sel < ng ? this.data.gates[this.sel].p : this.data.grid[this.sel - ng].p;
    this.info.textContent = `${label}\n${p.map((v) => v.toFixed(2)).join(', ')}\n[ ] select · IJKL move · U/O rotate\nlength ${this.data.length.toFixed(0)} m · ${ng} gates`;
  }

  private export(): void {
    const blob = new Blob([JSON.stringify(this.data)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'track.json' });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyHandler);
    this.panel.remove();
    this.scene.remove(this.group);
  }
}
