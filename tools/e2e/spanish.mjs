#!/usr/bin/env node
/**
 * Spanish UI and live timing check: plays in Spanish with AI cars long enough for them to set laps, saves
 * screenshots of every screen to tools/e2e/out/es-*.png, prints any text without a Spanish entry ([i18n]) and
 * the standings board after every lap the AI completes.
 *
 *   node tools/e2e/spanish.mjs [--url http://127.0.0.1:5173] [--bots 3] [--minutes 4]
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
const BOTS = Number(opt('bots', '3'));
const MINUTES = Number(opt('minutes', '4'));
const WEATHER = opt('weather', '');

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const missing = new Set();
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('[i18n]')) missing.add(t.slice(23));
  else if (t.startsWith('[limits]')) console.log('  ' + t);
  else if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(t)) console.log('  [console.error]', t.slice(0, 200));
});
page.on('pageerror', (e) => console.log('  pageerror', String(e)));
await page.addInitScript(() => {
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Piloto', language: 'es', quality: 'low', qualityAuto: false, showPerf: false }));
});
const shot = (n) => page.screenshot({ path: path.join(out, `es-${n}.png`) });
await page.goto(URL);
await page.waitForSelector('.menu', { timeout: 30_000 });
await page.waitForTimeout(3000);
await shot('1-menu');
await page.click('button.primary:has-text("Crear sala")');
await page.waitForSelector('.car-card', { timeout: 30_000 });
await page.waitForTimeout(1500);
if (WEATHER) await page.selectOption('.prep .prep-row:nth-of-type(2) select', WEATHER);
await page.click('.car-card >> nth=0');
for (let i = 0; i < BOTS; i++) {
  await page.click('button.add-bot');
  await page.waitForTimeout(300);
}
await page.waitForTimeout(800);
await shot('2-lobby');
await page.click('button:has-text("Ajustes")');
await page.waitForTimeout(600);
await shot('3-settings');
await page.keyboard.press('Escape');
await page.click('.modal button.icon').catch(() => {});
await page.waitForTimeout(300);
await page.click('.lobby-actions button:has-text("Listo")');
await page.waitForTimeout(400);
await page.click('button:has-text("Iniciar carrera")');
// briefing: confirm the car setup
await page.click('button:has-text("Listo para salir")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.waitForTimeout(3000);
await shot('4-cinematic');
await page.keyboard.press('Enter');
await page.waitForTimeout(20000);
await shot('5-race');
// the AI laps; dump the board whenever it changes
const t0 = Date.now();
let lastBoard = '';
while (Date.now() - t0 < MINUTES * 60_000) {
  const board = await page.evaluate(() => document.querySelector('.hud-board')?.innerText ?? '');
  if (board !== lastBoard) {
    console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)} s] board: ${board.replace(/\n/g, ' | ')}`);
    lastBoard = board;
  }
  await page.waitForTimeout(2000);
}
await page.keyboard.down('Tab');
await page.waitForTimeout(600);
await shot('6-timing');
console.log('  timing screen:', (await page.evaluate(() => document.querySelector('.timing')?.innerText ?? '')).replace(/\n/g, ' | ').slice(0, 900));
await page.keyboard.up('Tab');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await shot('7-pause');
console.log(missing.size ? `  untranslated (${missing.size}):\n    ${[...missing].join('\n    ')}` : '  no untranslated text seen');
await browser.close();
