#!/usr/bin/env node
/**
 * Menu screens at laptop and desktop sizes: home, garage, profile, online, friends (signed out), the car step before
 * a solo session and the lobby's rules and car steps. Output: OUT dir (default tools/e2e/out/ui).
 *
 *   OUT=dir SIZES=1366x768,1280x720 node tools/e2e/uishots.mjs [url]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.OUT ?? 'tools/e2e/out/ui';
mkdirSync(OUT, { recursive: true });
const URL = process.argv[2] ?? 'http://127.0.0.1:5199';
const sizes = (process.env.SIZES ?? '1366x768').split(',').map((s) => s.split('x').map(Number));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, hgt] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: hgt } });
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.addInitScript(() => {
    localStorage.setItem('apexghost.noAudio', '1');
    if (!localStorage.getItem('apexghost.settings.v1')) localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Checker', language: 'en' }));
  });
  await page.goto(URL);
  await page.waitForSelector('.menu', { timeout: 60000 });
  await page.waitForTimeout(2500);
  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}-${w}x${hgt}.png` });
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (over) console.log(`${name} ${w}x${hgt}: horizontal overflow`);
  };
  await shot('home');
  for (const tab of ['Garage', 'Profile', 'Online', 'Friends']) {
    await page.click(`.mm-tabs button:has-text("${tab}")`);
    await page.waitForTimeout(900);
    await shot(tab.toLowerCase());
  }
  await page.click('.mm-tabs button:has-text("Play")');
  await page.click('.mm-tile.solo');
  await page.waitForSelector('.garage-modal', { timeout: 10000 });
  await page.waitForTimeout(800);
  await shot('pick');
  await page.click('.garage-modal .gr-cta');
  await page.waitForSelector('.lobby', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.click('.lb-step >> nth=3');
  await page.waitForTimeout(600);
  await shot('rules');
  await page.click('.lb-step >> nth=4');
  await page.waitForTimeout(900);
  await shot('car');
  await page.close();
}
await browser.close();
