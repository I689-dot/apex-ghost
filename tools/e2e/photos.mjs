#!/usr/bin/env node
/**
 * "Photo mode": in-engine shots of the real circuit and cars for the menus (instead of CSS decoration).
 * Starts a session with bots on the grid in clear light, hides the UI, places cameras and saves frames to
 * apps/client/public/assets/ui/photo_<name>.webp.
 *
 *   node tools/e2e/photos.mjs [--url http://127.0.0.1:5173] [--time afternoon] [--track zandvoort --map zandvoort]
 *
 * With --track the shots are taken on that layout; --map names the set (photo_<name>_<map>.webp), which the menus
 * show for that map's layouts.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const ui = path.resolve(here, '../../apps/client/public/assets/ui');
mkdirSync(ui, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const TIME = opt('time', 'morning');
const TRACK = opt('track', '');
const MAP = opt('map', '');
/** The car on pole (by name, as the car cards show it). */
const CAR = opt('car', 'Rennsport');

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.addInitScript(() => {
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({
      nickname: 'Photo',
      quality: 'ultra',
      qualityAuto: false,
      showPerf: false,
      dynamicResolution: false,
      racingLine: 'off',
      resolutionScale: 1,
    }),
  );
  localStorage.removeItem('apexghost.devWeatherSeed');
});
await page.goto(URL);
await page.waitForSelector('.menu', { timeout: 30_000 });
await page.click('button:has-text("Create room")');
await page.waitForSelector('.car-card', { timeout: 30_000 });
await page.waitForTimeout(1500);
if (TRACK) await page.selectOption('.prep .prep-row:nth-of-type(1) select', TRACK);
await page.selectOption('.prep .prep-row:nth-of-type(2) select', 'clear');
await page.selectOption('.prep .prep-row:nth-of-type(3) select', TIME);
await page.waitForTimeout(400);
{
  const names = await page.evaluate(() => [...document.querySelectorAll('.car-card')].map((c) => c.textContent ?? ''));
  const i = Math.max(
    0,
    names.findIndex((n) => n.toLowerCase().includes(CAR.toLowerCase())),
  );
  await page.click(`.car-card >> nth=${i}`);
}
await page.waitForTimeout(600);
for (let i = 0; i < 7; i++) {
  await page.click('button.add-bot');
  await page.waitForTimeout(250);
}
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
// briefing: confirm the car setup
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.addStyleTag({ content: '.perf { display: none !important; }' });
await page.waitForTimeout(1200);
// aerial shot straight from the cinematic
await page.evaluate(() => ((document.querySelector('.cinematic') ?? document.body).style.display = 'none'));
await page.waitForTimeout(400);
const save = async (name) => {
  const png = await page.screenshot();
  // the game grades its own frame on High/Ultra (graphics.ts GradeShader): only a touch more here, or the liveries
  // turn garish (Gulf blue went royal blue, its orange red)
  await sharp(png)
    .resize(1920, 1080)
    .modulate({ saturation: 1.02, brightness: 0.97 })
    .linear(1.04, -4)
    .webp({ quality: 82 })
    .toFile(path.join(ui, `photo_${name}${MAP ? `_${MAP}` : ''}.webp`));
  console.log(`  photo_${name}${MAP ? `_${MAP}` : ''}.webp`);
};
await save('aerial');
await page.keyboard.press('Enter'); // skip the cinematic
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const ui = document.querySelector('.race-ui');
  if (ui) ui.style.display = 'none';
});

/** Place a photo camera: from `a` (offset from grid slot `slot`) looking at `b` (offset from slot `look`). */
const shot = async (name, slot, a, look, b, fov = 40) => {
  await page.evaluate(
    ([slot, a, look, b, fov]) => {
      const { session, gfx, THREE } = window.__apex;
      const g = session.trackData.grid;
      const fw = (s) => new THREE.Vector3(Math.sin(g[s].yaw), 0, Math.cos(g[s].yaw));
      const at = (s, o) => {
        const f = fw(s);
        const left = new THREE.Vector3(f.z, 0, -f.x);
        return new THREE.Vector3(...g[s].p)
          .addScaledVector(f, o[0])
          .addScaledVector(left, o[1])
          .add(new THREE.Vector3(0, o[2], 0));
      };
      const cam = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 9000);
      cam.position.copy(at(slot, a));
      cam.lookAt(at(look, b));
      window.__photoCam = cam;
      gfx.setCamera(cam);
    },
    [slot, a, look, b, fov],
  );
  await page.waitForTimeout(1800);
  await save(name);
};
// the grid from the front, low, like a TV shot before the start
await shot('grid', 0, [16, -3, 0.9], 3, [0, 0, 0.6], 34);
// along the grid from the side of the straight with the grandstands
await shot('straight', 5, [4, -12, 2.2], 0, [0, 0, 0.8], 46);
// close three-quarter of the pole car
await shot('pole', 0, [5.5, 3.5, 1.1], 0, [0, 0, 0.55], 32);
// the main menu: the chosen car (CAR) on its grid slot, low from the front three-quarter, a long lens
const mine = await page.evaluate(() => window.__apex.session.race.slots[window.__apex.session.me] ?? 0);
await shot('hero', mine, [6.2, 3.1, 0.42], mine, [0, 0.3, 0.55], 26);
await browser.close();
