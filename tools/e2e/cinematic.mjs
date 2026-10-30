#!/usr/bin/env node
/**
 * Captures the pre-race cinematic at several moments (aerial flyover and grid pass) with the real GPU.
 *   node tools/e2e/cinematic.mjs [--url http://127.0.0.1:5173] [--quality medium]
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
const QUALITY = opt('quality', 'medium');
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.addInitScript((q) => {
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({ nickname: 'Cine', quality: q, qualityAuto: false, showPerf: false, dynamicResolution: false }),
  );
  localStorage.removeItem('apexghost.devWeatherSeed');
}, QUALITY);
await page.goto(URL);
await page.waitForSelector('.menu', { timeout: 30_000 });
await page.click('button:has-text("Create room")');
await page.waitForSelector('.lb-steps', { timeout: 30_000 });
await page.waitForTimeout(1500);
// clear midday weather so the shots are comparable
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['weather', 'clear']).catch(() => {});
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['time', 'midday']).catch(() => {});
await page.waitForTimeout(500);
for (let i = 0; i < 3; i++) {
  await page.click('button.add-bot');
  await page.waitForTimeout(300);
}
await page.click('.lb-step >> nth=4');
await page.click('.car-card >> nth=0');
await page.waitForTimeout(800);
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(500);
await page.click('button:has-text("Start race")');
// briefing: confirm the car setup
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
for (const [t, name] of [
  [500, 'cine-1'],
  [2500, 'cine-2'],
  [2500, 'cine-3'],
  [3500, 'cine-grid'],
]) {
  await page.waitForTimeout(t);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`  ${name}.png`);
}
await browser.close();
