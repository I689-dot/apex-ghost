#!/usr/bin/env node
/**
 * Race weekend check: a short qualifying (1 min) then the race (1 lap) with AI cars, solo/offline by default.
 * Prints the qualifying and race results and the HUD in the race; screenshots to tools/e2e/out/weekend-*.png.
 *
 *   node tools/e2e/weekend.mjs [--url http://127.0.0.1:5173] [--bots 3] [--laps 1] [--online]
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const BOTS = Number(opt('bots', '3'));
const LAPS = Number(opt('laps', '1'));
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e)));
await page.addInitScript(() =>
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Weekend', quality: 'low', qualityAuto: false, language: 'en' })),
);
await page.goto(URL);
await page.waitForSelector('.menu');
await page.waitForTimeout(2500);
await page.click(args.includes('--online') ? 'button:has-text("Create room")' : 'button.solo');
await page.waitForSelector('.car-card', { timeout: 30_000 });
await page.selectOption('.prep .prep-row:nth-of-type(2) select', 'clear');
await page.evaluate((laps) => {
  const c = window.__app.conn;
  c.sendJson({ t: 'setSession', minutes: 1 });
  c.sendJson({ t: 'setRaceLaps', laps });
}, LAPS);
await page.click('.car-card >> nth=0');
for (let i = 0; i < BOTS; i++) {
  await page.click('button.add-bot');
  await page.waitForTimeout(250);
}
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 180_000 });
await page.keyboard.press('Enter');
console.log('  qualifying running');
await page.waitForSelector('.results', { timeout: 12 * 60_000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tools/e2e/out/weekend-1-quali.png' });
console.log('  qualifying results:', (await page.textContent('.results table')).replace(/\s+/g, ' ').slice(0, 400));
console.log('  ', await page.textContent('.race-next').catch(() => 'no race-next line'));
await page.waitForSelector('.race-ui', { timeout: 120_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(30_000);
await page.screenshot({ path: 'tools/e2e/out/weekend-2-race.png' });
console.log('  race HUD:', (await page.textContent('.hud-board')).replace(/\s+/g, ' '), '|', await page.textContent('.hud-finish'));
await page.waitForSelector('.results', { timeout: 15 * 60_000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tools/e2e/out/weekend-3-race-results.png' });
console.log('  race results:', (await page.textContent('.results')).replace(/\s+/g, ' ').slice(0, 600));
await browser.close();
