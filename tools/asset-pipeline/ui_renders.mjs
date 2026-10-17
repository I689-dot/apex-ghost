#!/usr/bin/env node
/**
 * Real renders for the UI (Blender Cycles), instead of CSS drawings:
 *  - a studio hero shot of every car (car selection, lobby, results)  → public/assets/ui/cars/<id>.webp
 *  - the four tyre compounds on a real wheel (lobby, pit box)         → public/assets/ui/tyre_<compound>.webp
 *
 *   node tools/asset-pipeline/ui_renders.mjs [--car <id>] [--only tyres|cars]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const BLENDER = process.env.BLENDER ?? path.join(homedir(), '.local/opt/blender-4.2.3-linux-x64/blender');
const carsOut = path.join(here, 'out/cars');
const ui = path.join(root, 'apps/client/public/assets/ui');
const tmp = path.join(here, 'out/ui');
mkdirSync(path.join(ui, 'cars'), { recursive: true });
mkdirSync(tmp, { recursive: true });
const args = process.argv.slice(2);
const opt = (k) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null);
const only = opt('only');
const carFilter = opt('car');
const script = path.join(here, 'blender/render_ui.py');
const blender = (...a) => execFileSync(BLENDER, ['-b', '--factory-startup', '-P', script, '--', ...a], { stdio: ['ignore', 'ignore', 'inherit'] });

if (!only || only === 'tyres') {
  const ref = '2024_porsche_992_gt3_r';
  blender('tyres', path.join(carsOut, `${ref}.glb`), path.join(carsOut, `${ref}.json`), tmp);
  for (const c of ['soft', 'medium', 'hard', 'wet']) {
    await sharp(path.join(tmp, `tyre_${c}.png`))
      .resize(192, 192)
      .webp({ quality: 88, alphaQuality: 95 })
      .toFile(path.join(ui, `tyre_${c}.webp`));
  }
  console.log('[ui] tyres rendered');
}
if (!only || only === 'cars') {
  const cars = JSON.parse(readFileSync(path.join(root, 'apps/client/public/assets/cars.json'), 'utf8')).cars;
  for (const car of cars) {
    if (carFilter && car.id !== carFilter) continue;
    const glb = path.join(carsOut, `${car.id}.glb`);
    if (!existsSync(glb)) continue;
    const png = path.join(tmp, `${car.id}.png`);
    const t0 = Date.now();
    blender('hero', glb, png);
    // trim the transparent margin, keep a little air around the car
    await sharp(png)
      .trim({ threshold: 2 })
      .extend({ top: 24, bottom: 24, left: 40, right: 40, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 86, alphaQuality: 92 })
      .toFile(path.join(ui, 'cars', `${car.id}.webp`));
    rmSync(png, { force: true });
    console.log(`[ui] ${car.id} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
}
