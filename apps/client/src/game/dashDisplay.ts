import * as THREE from 'three';

/** What the screens show, refreshed ~15 times a second. */
export interface DashData {
  gear: number;
  kmh: number;
  rpm: number;
  redline: number;
  limiter: number;
  /** Lap in progress, last and best (ms; null: none). */
  lapMs: number;
  lastMs: number | null;
  bestMs: number | null;
  /** Live delta to the best lap (ms), null without one. */
  deltaMs: number | null;
  position: number;
  total: number;
  /** TC level (0 off, 1, 2), ABS on, front brake share (0.55 = 55 %). */
  tc: number;
  abs: boolean;
  bias: number;
  fuelL: number | null;
  /** FL, FR, RL, RR: tyre pressure (psi) and temperature (°C). */
  psi: number[];
  temps: number[];
  pitLimiter: boolean;
}

/** Display materials in the cars' cockpits (Assetto Corsa's naming: DISPLAY the dash, DISPLAY_SAS the wheel's). */
const DASH_RE = /^(display(_\d+)?|lexgt3_display|int_display(_\d+)?|screen|mi_.*cockpit_screen)$/i;
const WHEEL_RE = /^display_sas(_\d+)?$/i;
/** The models' own digit overlays in front of a screen (Assetto Corsa's "digital instruments"): hidden under ours. */
const OVERLAY_RE = /^(phisics_dash(_\d+)?|display_trans)$/i;

interface Screen {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  kind: 'dash' | 'wheel';
}

const fmt = (ms: number | null) => {
  if (ms === null || ms <= 0) return '-:--.---';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

/**
 * Live data on the cockpit's own screens, as a GT3 dash shows it (the Porsche 911 GT3 R's Cosworth display as
 * iRacing's manual describes its pages: the big gear, shift lights, last lap and the predicted one, the TC map and
 * ABS, brake bias as an offset from 50 %, fuel, the four tyre pressures). The car's display meshes keep their
 * shape; their picture is a canvas drawn here, projected onto them.
 */
export class DashDisplays {
  private screens: Screen[] = [];
  private t = 0;

  constructor(root: THREE.Object3D) {
    const seen = new Map<THREE.Material, Screen>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m, k) => {
        const kind = WHEEL_RE.test(m.name) ? 'wheel' : DASH_RE.test(m.name) ? 'dash' : null;
        if (!kind) return;
        let sc = seen.get(m);
        if (!sc) {
          const canvas = document.createElement('canvas');
          canvas.width = kind === 'dash' ? 640 : 384;
          canvas.height = kind === 'dash' ? 320 : 192;
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = false;
          tex.anisotropy = 4;
          sc = { canvas, g: canvas.getContext('2d') as CanvasRenderingContext2D, tex, kind };
          seen.set(m, sc);
          this.screens.push(sc);
        }
        // new UVs: the mesh projected on its own plane, right and up as the driver sees them (the car's −X is
        // its right, +Y up; the model's own UVs often point at a glyph atlas, a dozen quads per screen), the canvas
        // fitted inside with its aspect kept
        const geo = this.projectUv(mesh, root, sc.canvas.width / sc.canvas.height);
        if (!geo) return;
        mesh.geometry = geo;
        // a lit screen: unaffected by the cabin's shading
        const lit = new THREE.MeshBasicMaterial({ map: sc.tex, toneMapped: false });
        lit.name = m.name;
        if (Array.isArray(mesh.material)) mesh.material[k] = lit;
        else mesh.material = lit;
      });
    });
    if (this.screens.some((sc) => sc.kind === 'dash'))
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (mats.some((m) => OVERLAY_RE.test(m.name))) mesh.visible = false;
      });
  }

  private projectUv(mesh: THREE.Mesh, root: THREE.Object3D, aspect: number): THREE.BufferGeometry | null {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos || pos.count < 3) return null;
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toRoot));
    // the plane's normal: the area-weighted sum of the triangles' (sign-free: right and up are taken from the car)
    const n = new THREE.Vector3();
    const idx = mesh.geometry.getIndex();
    const tri = (a: number, b: number, c: number) => {
      const e1 = pts[b].clone().sub(pts[a]);
      const e2 = pts[c].clone().sub(pts[a]);
      const cr = e1.cross(e2);
      if (n.dot(cr) < 0) cr.negate();
      n.add(cr);
    };
    if (idx) for (let i = 0; i + 2 < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    else for (let i = 0; i + 2 < pos.count; i += 3) tri(i, i + 1, i + 2);
    if (n.lengthSq() < 1e-12) return null;
    n.normalize();
    const right = new THREE.Vector3(-1, 0, 0);
    right.addScaledVector(n, -right.dot(n)).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    up.addScaledVector(n, -up.dot(n)).addScaledVector(right, -up.dot(right)).normalize();
    if (!Number.isFinite(right.x) || !Number.isFinite(up.x)) return null;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    const uv = pts.map((p) => {
      const u = p.dot(right);
      const v = p.dot(up);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
      return [u, v];
    });
    // the canvas (width 1, height 1/aspect) as large as fits, centred; v = 0 is the canvas's top row (flipY off)
    const k = 1 / Math.max(u1 - u0, (v1 - v0) * aspect);
    const um = (u0 + u1) / 2;
    const vm = (v0 + v1) / 2;
    const arr = new Float32Array(pos.count * 2);
    uv.forEach(([u, v], i) => {
      arr[i * 2] = 0.5 + (u - um) * k;
      arr[i * 2 + 1] = 0.5 + (vm - v) * k * aspect;
    });
    const geo = mesh.geometry.clone();
    geo.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
    return geo;
  }

  get count(): number {
    return this.screens.length;
  }

  update(dt: number, d: DashData): void {
    if (!this.screens.length) return;
    this.t += dt;
    if (this.t < 1 / 15) return;
    this.t = 0;
    for (const sc of this.screens) {
      if (sc.kind === 'dash') this.drawDash(sc, d);
      else this.drawWheel(sc, d);
      sc.tex.needsUpdate = true;
    }
  }

  /** Shift lights across the top: green, red, blue at the limit, flashing over it. */
  private lights(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, d: DashData): void {
    const n = 10;
    const lit = Math.max(0, Math.min(n, Math.round(((d.rpm / d.redline - 0.75) / 0.25) * n)));
    const flash = d.rpm >= d.limiter * 0.985 && Math.floor(performance.now() / 90) % 2 === 0;
    for (let i = 0; i < n; i++) {
      g.fillStyle = flash ? '#3aa0ff' : i < lit ? (i < 4 ? '#2fd35a' : i < 8 ? '#ff3b30' : '#3aa0ff') : '#1a1d22';
      g.fillRect(x + (i * w) / n + 2, y, w / n - 4, h);
    }
  }

  private drawDash(sc: Screen, d: DashData): void {
    const { g, canvas } = sc;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, W, H);
    this.lights(g, 10, 8, W - 20, 18, d);
    g.textBaseline = 'middle';
    // the big gear in the middle, the pit limiter over it
    g.textAlign = 'center';
    g.fillStyle = d.pitLimiter ? '#ffd60a' : '#ffffff';
    g.font = 'bold 150px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText(d.gear < 0 ? 'R' : d.gear === 0 ? 'N' : String(d.gear), W / 2, H * 0.52);
    g.font = 'bold 34px "Barlow Condensed", sans-serif';
    g.fillText(d.pitLimiter ? 'PIT LIMITER' : `${Math.round(d.kmh)} km/h`, W / 2, H * 0.88);
    // left column: lap times and the delta
    g.textAlign = 'left';
    g.font = '22px "Barlow Condensed", sans-serif';
    g.fillStyle = '#8b9099';
    g.fillText('LAST', 14, 52);
    g.fillText('BEST', 14, 112);
    g.fillText('DELTA', 14, 172);
    g.font = 'bold 34px "Barlow Condensed", sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText(fmt(d.lastMs), 14, 80);
    g.fillStyle = '#c77dff';
    g.fillText(fmt(d.bestMs), 14, 140);
    if (d.deltaMs !== null) {
      g.fillStyle = d.deltaMs <= 0 ? '#2fd35a' : '#ff453a';
      g.fillText(`${d.deltaMs <= 0 ? '−' : '+'}${(Math.abs(d.deltaMs) / 1000).toFixed(2)}`, 14, 200);
    } else {
      g.fillStyle = '#8b9099';
      g.fillText('-.--', 14, 200);
    }
    g.fillStyle = '#ffffff';
    g.font = 'bold 30px "Barlow Condensed", sans-serif';
    g.fillText(`P${d.position || '-'}/${d.total}`, 14, 262);
    // right column: TC, ABS, brake bias as an offset from 50 %, fuel
    g.textAlign = 'right';
    const row = (label: string, value: string, y: number, colour = '#ffffff') => {
      g.font = '22px "Barlow Condensed", sans-serif';
      g.fillStyle = '#8b9099';
      g.fillText(label, W - 110, y);
      g.font = 'bold 30px "Barlow Condensed", sans-serif';
      g.fillStyle = colour;
      g.fillText(value, W - 14, y);
    };
    row('TC', d.tc ? String(d.tc) : 'OFF', 56, d.tc ? '#ffd60a' : '#ff453a');
    row('ABS', d.abs ? 'ON' : 'OFF', 96, d.abs ? '#ffd60a' : '#ff453a');
    row('BB', (d.bias * 100 - 50).toFixed(1), 136);
    row('FUEL', d.fuelL === null ? '--' : `${d.fuelL.toFixed(1)} L`, 176);
    // tyres: pressure (psi) over temperature, coloured cold / working / hot
    g.textAlign = 'center';
    const tyre = (i: number, x: number, y: number) => {
      const c = d.temps[i];
      g.fillStyle = c < 70 ? '#3aa0ff' : c > 105 ? '#ff453a' : '#2fd35a';
      g.fillRect(x - 34, y - 20, 68, 44);
      g.fillStyle = '#05070a';
      g.font = 'bold 22px "Barlow Condensed", sans-serif';
      g.fillText(d.psi[i].toFixed(1), x, y - 6);
      g.font = '18px "Barlow Condensed", sans-serif';
      g.fillText(`${Math.round(c)}°`, x, y + 14);
    };
    tyre(0, W - 120, 232);
    tyre(1, W - 44, 232);
    tyre(2, W - 120, 284);
    tyre(3, W - 44, 284);
  }

  /** The wheel's small screen: gear, delta, position. */
  private drawWheel(sc: Screen, d: DashData): void {
    const { g, canvas } = sc;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, W, H);
    this.lights(g, 6, 6, W - 12, 14, d);
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = d.pitLimiter ? '#ffd60a' : '#ffffff';
    g.font = 'bold 110px "Barlow Condensed", sans-serif';
    g.fillText(d.gear < 0 ? 'R' : d.gear === 0 ? 'N' : String(d.gear), W / 2, H * 0.58);
    g.font = 'bold 30px "Barlow Condensed", sans-serif';
    g.textAlign = 'left';
    g.fillStyle = d.deltaMs === null ? '#8b9099' : d.deltaMs <= 0 ? '#2fd35a' : '#ff453a';
    g.fillText(d.deltaMs === null ? '-.--' : `${d.deltaMs <= 0 ? '−' : '+'}${(Math.abs(d.deltaMs) / 1000).toFixed(2)}`, 10, H * 0.58);
    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.fillText(`P${d.position || '-'}`, W - 10, H * 0.58);
    g.font = '22px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText(`${Math.round(d.kmh)}`, W / 2, H * 0.92);
  }

  dispose(): void {
    for (const sc of this.screens) {
      sc.tex.dispose();
    }
  }
}
