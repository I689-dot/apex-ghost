import type { CarEntry } from '@apex/shared';
import type { TopLines } from '../game/topView';

/** Damage 0 (none) … 1 (wrecked) → green, yellow, orange, red: as F1's damage page and the sims' car diagrams. */
export function damageColour(d: number): string {
  return d < 0.05 ? '#30d158' : d < 0.25 ? '#ffd60a' : d < 0.55 ? '#ff9f0a' : '#ff453a';
}

/** Which part a pixel of the drawing belongs to: the damage zones 0 front … 4 engine, CORNER + i the wheel i. */
const CORNER = 6;
const rgbOf = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/**
 * A car's own line drawing from above (topView.ts renderTopLines), each part in a colour of its own: the nose, the
 * tail, the sides, the engine bay and each corner at its real wheel (iRacing's damage diagram). Shared by the damage
 * report and the tyres-and-damage instrument.
 */
export class CarLineArt {
  readonly canvas = document.createElement('canvas');
  lines: TopLines | null = null;
  private zoneOf: Uint8Array | null = null;

  constructor() {
    this.canvas.width = this.canvas.height = 1;
  }

  /** The car (once at load): its drawing and where its wheels are. */
  setCar(entry: CarEntry, lines: TopLines | null): void {
    this.lines = lines;
    this.zoneOf = null;
    if (!lines) return;
    const { width: W, height: H, minX, maxX, minZ, maxZ } = lines;
    this.canvas.width = W;
    this.canvas.height = H;
    const wheels = (['FL', 'FR', 'RL', 'RR'] as const).map((k) => entry.wheels[k]);
    const zF = (wheels[0].position[2] + wheels[1].position[2]) / 2;
    const zR = (wheels[2].position[2] + wheels[3].position[2]) / 2;
    const w = maxX - minX;
    const zone = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        // the picture's right is the car's right (−x), its top the nose
        const cx = maxX - ((x + 0.5) / W) * w;
        const cz = maxZ - ((y + 0.5) / H) * (maxZ - minZ);
        let z: number;
        const wi = wheels.findIndex((wh) => Math.abs(cz - wh.position[2]) < wh.radius * 1.15 && Math.abs(cx - wh.position[0]) < 0.3);
        if (wi >= 0) z = CORNER + wi;
        else if (cz > zF + 0.15) z = 0;
        else if (cz < zR - 0.15) z = 1;
        else if (Math.abs(cx) < w * 0.16 && cz < (zF + zR) / 2) z = 4;
        else z = cx > 0 ? 2 : 3;
        zone[y * W + x] = z;
      }
    this.zoneOf = zone;
  }

  /** Draws it: `zones` the colours of front, rear, left, right, engine; `corners` of FL, FR, RL, RR. */
  draw(zones: string[], corners: string[]): boolean {
    const L = this.lines;
    const zone = this.zoneOf;
    if (!L || !zone) return false;
    const g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = g.createImageData(L.width, L.height);
    const zc = zones.map(rgbOf);
    const cc = corners.map(rgbOf);
    for (let i = 0; i < L.lines.length; i++) {
      const a = L.lines[i];
      if (!a) continue;
      const zi = zone[i];
      const c = zi >= CORNER ? cc[zi - CORNER] : (zc[zi] ?? zc[0]);
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = a;
    }
    g.putImageData(img, 0, 0);
    return true;
  }
}
