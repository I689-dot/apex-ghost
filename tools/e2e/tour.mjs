#!/usr/bin/env node
/**
 * Visual check of a whole layout: starts a session on it, hides the UI and takes driver's-eye frames along the lap
 * line every --step metres (plus a few high shots looking down), to spot holes, missing textures or wrong scale.
 * Frames go to tools/e2e/out/tour-<track>-<s>.png.
 *
 *   node tools/e2e/tour.mjs --track zandvoort [--url http://127.0.0.1:5173] [--step 300 | --at 1500,2700] [--aerial]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const TRACK = opt('track', '');
const STEP = Number(opt('step', '300'));
const AERIAL = args.includes('--aerial');
const AT = opt('at', '');

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.addInitScript(() => {
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({ nickname: 'Tour', quality: 'medium', qualityAuto: false, showPerf: false, dynamicResolution: false, racingLine: 'off' }),
  );
});
await page.goto(URL);
await page.waitForSelector('.menu-card', { timeout: 30_000 });
await page.click('button.primary:has-text("Create room")');
await page.waitForSelector('.car-card', { timeout: 30_000 });
await page.waitForTimeout(1500);
if (TRACK) await page.selectOption('.prep .prep-row:nth-of-type(1) select', TRACK);
await page.selectOption('.prep .prep-row:nth-of-type(2) select', 'clear');
await page.selectOption('.prep .prep-row:nth-of-type(3) select', 'afternoon');
await page.waitForTimeout(400);
await page.click('.car-card >> nth=0');
await page.waitForTimeout(600);
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.waitForTimeout(1500);
await page.keyboard.press('Enter'); // skip the cinematic
await page.waitForTimeout(1500);
await page.addStyleTag({ content: '.race-ui, .perf, .cinematic { display: none !important; }' });
const L = await page.evaluate(() => window.__apex.session.trackData.length);
const id = await page.evaluate(() => window.__apex.session.trackData.id);
/** Camera at lap distance s: `h` metres up, `back` metres behind, looking `ahead` metres along the line. */
const place = (s, h, back, ahead, fov) =>
  page.evaluate(
    ([s, h, back, ahead, fov]) => {
      const { session, gfx, THREE } = window.__apex;
      const t = session.track;
      const a = { x: 0, y: 0, z: 0, yaw: 0 };
      const b = { x: 0, y: 0, z: 0, yaw: 0 };
      t.pointAt(s - back, a);
      t.pointAt(s + ahead, b);
      const cam = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 9000);
      cam.position.set(a.x, a.y + h, a.z);
      cam.lookAt(b.x, b.y + (h > 50 ? 0 : 1), b.z);
      gfx.setCamera(cam);
      t.updateVisibility(cam.position, session.gfx.quality);
    },
    [s, h, back, ahead, fov],
  );
const spots = AT ? AT.split(',').map(Number) : Array.from({ length: Math.ceil(L / STEP) }, (_, k) => k * STEP);
for (const s of spots) {
  await place(s, 1.4, 0, 60, 70);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, `tour-${id}-${String(Math.round(s)).padStart(4, '0')}.png`) });
  if (AERIAL) {
    await place(s, 120, 60, 40, 60);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `tour-${id}-${String(Math.round(s)).padStart(4, '0')}-air.png`) });
  }
}
console.log(`  ${spots.length} positions on ${id} (${Math.round(L)} m) → ${out}/tour-${id}-*.png`);
await browser.close();
