#!/usr/bin/env node
/**
 * The race overlays and the wiper in a real session: a solo race with bots (default Spa, heavy rain), the player
 * driving from the grid with the keyboard, frames from the cockpit while following the field. Checks the relative
 * box, the delta bar, the inputs, the spotter and the standings tower are drawn, and that the wiper moves.
 *
 *   node tools/e2e/overlays.mjs [--track spa] [--weather heavy_rain] [--bots 7] [--tag ov]
 *
 * Writes tools/e2e/out/overlays/<tag>_<n>.png.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'overlays');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const TRACK = opt('track', 'spa');
const WEATHER = opt('weather', 'heavy_rain');
const BOTS = Number(opt('bots', '7'));
const TAG = opt('tag', 'ov');

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.addInitScript(() => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({
      nickname: 'Overlay',
      quality: 'medium',
      qualityAuto: false,
      language: 'en',
      dynamicResolution: false,
      racingLine: 'off',
      ghost: false,
      mirror: true,
    }),
  );
});
await page.goto(URL);
await page.click('button:has-text("Play solo")');
await page.waitForSelector('.lb-steps', { timeout: 60_000 });
await page.waitForTimeout(800);
const cond = (k, v) => page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), [k, v]);
await cond('trackId', TRACK);
await page.waitForTimeout(500);
await cond('weather', WEATHER);
await page.waitForTimeout(300);
await cond('time', 'midday');
await page.waitForTimeout(300);
await page.click('.lb-step >> nth=4');
await page.click('.car-card >> nth=0');
for (let i = 0; i < BOTS; i++) {
  await page.click('button.add-bot').catch(() => {});
  await page.waitForTimeout(150);
}
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.keyboard.press('Enter');
// wait for the start, then drive: full throttle with small corrections
await page.waitForTimeout(9000);
await page.keyboard.down('KeyW');
const info = [];
for (let n = 0; n < 6; n++) {
  await page.waitForTimeout(n === 0 ? 4000 : 2500);
  if (n === 3) {
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyS');
  }
  await page.screenshot({ path: path.join(out, `${TAG}_${n}.png`) });
  info.push(
    await page.evaluate(() => ({
      rel: document.querySelectorAll('.ov-rel-row').length,
      relHidden: document.querySelector('.ov-rel')?.hidden,
      tower: document.querySelectorAll('.hud-board .row').length,
      spot: [...document.querySelectorAll('.ov-spot.show')].map((e) => e.className),
      delta: !document.querySelector('.ov-delta')?.hidden,
      wiper: window.__apex?.session?.windshield?.wipe?.frac?.toFixed(2),
    })),
  );
}
await page.keyboard.up('KeyW');
console.log(JSON.stringify(info));
await browser.close();
