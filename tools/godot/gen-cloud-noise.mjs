// Writes the cloud noise texture of apps/client/src/game/sky.ts (256x256 RGBA, R = value fbm, G = inverted Worley fbm,
// B = fine value noise) as PNG for the Godot sky shader: godot/assets_static/sky/cloud_noise.png
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const N = 256;
const r = rng(1337);
const lattice = (f) => {
  const g = new Float32Array(f * f).map(() => r());
  return (x, y) => {
    const fx = (x / N) * f;
    const fy = (y / N) * f;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (a, b) => g[(((b % f) + f) % f) * f + (((a % f) + f) % f)];
    return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
  };
};
const worley = (f) => {
  const pts = new Float32Array(f * f * 2).map(() => r());
  return (x, y) => {
    const fx = (x / N) * f;
    const fy = (y / N) * f;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    let best = 9;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const k = ((((cy % f) + f) % f) * f + (((cx % f) + f) % f)) * 2;
        const dx = cx + pts[k] - fx;
        const dy = cy + pts[k + 1] - fy;
        best = Math.min(best, dx * dx + dy * dy);
      }
    return 1 - Math.min(1, Math.sqrt(best));
  };
};
const v = [lattice(4), lattice(8), lattice(16), lattice(32), lattice(64)];
const w = [worley(6), worley(12), worley(24)];
const fine = [lattice(32), lattice(64), lattice(128)];
const d = new Uint8Array(N * N * 4);
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const a = v[0](x, y) * 0.42 + v[1](x, y) * 0.27 + v[2](x, y) * 0.16 + v[3](x, y) * 0.1 + v[4](x, y) * 0.05;
    const b = w[0](x, y) * 0.55 + w[1](x, y) * 0.3 + w[2](x, y) * 0.15;
    const c = fine[0](x, y) * 0.5 + fine[1](x, y) * 0.3 + fine[2](x, y) * 0.2;
    const k = (y * N + x) * 4;
    d[k] = Math.max(0, Math.min(255, Math.round((a - 0.5) * 2.1 * 255 + 128)));
    d[k + 1] = Math.round(Math.max(0, Math.min(1, b)) * 255);
    d[k + 2] = Math.round(c * 255);
    d[k + 3] = 255;
  }
mkdirSync('godot/assets_static/sky', { recursive: true });
await sharp(Buffer.from(d), { raw: { width: N, height: N, channels: 4 } }).png().toFile('godot/assets_static/sky/cloud_noise.png');
console.log('cloud_noise.png written');
