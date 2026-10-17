#!/usr/bin/env node
/**
 * Captures the in-game cockpit view of every car (solo race, forced clear midday weather, real GPU)
 * into tools/e2e/out/cockpits/<index>-<id>.png. Needs `pnpm dev` running.
 *
 *   node tools/e2e/cockpits.mjs [--from 0] [--to 17] [--seed 1]
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'cockpits');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const cars = JSON.parse(readFileSync(path.join(here, '../../apps/client/public/assets/cars.json'), 'utf8')).cars;
const from = Number(opt('from', '0'));
const to = Number(opt('to', String(cars.length - 1)));
const seed = opt('seed', '1');

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (let i = from; i <= to; i++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript((s) => {
    localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Cockpit', quality: 'medium', qualityAuto: false, dynamicResolution: false }));
    localStorage.setItem('apexghost.devWeatherSeed', s);
  }, seed);
  try {
    await page.goto(URL);
    await page.click('button.primary:has-text("Create room")');
    await page.waitForSelector('.car-card');
    await page.click(`.car-card >> nth=${i}`);
    await page.waitForTimeout(600);
    await page.click('.lobby-actions button:has-text("Ready")');
    await page.waitForTimeout(400);
    await page.click('button:has-text("Start race")');
    await page.waitForSelector('.race-ui', { timeout: 180_000 });
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter'); // skip the intro cinematic
    await page.waitForTimeout(7000); // past the countdown text
    const file = path.join(out, `${String(i).padStart(2, '0')}-${cars[i].id}.png`);
    await page.screenshot({ path: file, timeout: 60_000 });
    console.log(`  ${i} ${cars[i].id}`);
  } catch (e) {
    console.log(`  ${i} ${cars[i].id} FAILED: ${String(e).split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();
