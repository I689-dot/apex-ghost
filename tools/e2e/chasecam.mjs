#!/usr/bin/env node
/**
 * Outside driving cameras: solo session, drive off, V cycles cockpit → chase → far chase → cockpit; a screenshot of
 * each (tools/e2e/out/cam-<mode>.png) and of look-back in the chase view. Needs the dev server (window.__apex).
 *
 *   node tools/e2e/chasecam.mjs [--url http://127.0.0.1:5173]
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:5173';
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.addInitScript(() =>
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Cam', quality: 'medium', qualityAuto: false, language: 'en', camera: 'cockpit' })),
);
let fails = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails++;
};
await page.goto(URL);
await page.waitForSelector('.menu');
await page.waitForTimeout(1500);
await page.click('button:has-text("Play solo")');
await page.waitForSelector('.lb-steps', { timeout: 30_000 });
await page.click('.lb-step >> nth=4');
await page.click('.car-card >> nth=0');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(300);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 180_000 });
await page.waitForTimeout(800);
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__apex?.session?.vehicle?.frozen === false, null, { timeout: 90_000 });
await page.keyboard.down('KeyW');
await page.waitForTimeout(3500);
const cam = () => page.evaluate(() => (window.__apex.gfx.camera === window.__apex.session.cockpit.camera ? 'cockpit' : 'outside'));
const camDist = () =>
  page.evaluate(() => {
    const s = window.__apex.session;
    return window.__apex.gfx.camera.position.distanceTo(s.myVisual.object.position);
  });
await page.screenshot({ path: 'tools/e2e/out/cam-cockpit.png' });
check((await cam()) === 'cockpit', 'starts in the cockpit');
for (const mode of ['chase', 'far']) {
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(900);
  const d = await camDist();
  check((await cam()) === 'outside' && d > 4 && d < 12, `${mode}: outside camera ${d.toFixed(1)} m from the car`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('apexghost.settings.v1')).camera);
  check(saved === mode, `${mode}: saved in settings`);
  await page.screenshot({ path: `tools/e2e/out/cam-${mode}.png` });
  if (mode === 'chase') {
    await page.keyboard.down('KeyX');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'tools/e2e/out/cam-chase-back.png' });
    await page.keyboard.up('KeyX');
  }
}
await page.keyboard.press('KeyV');
await page.waitForTimeout(500);
check((await cam()) === 'cockpit', 'V again: back in the cockpit');
await page.keyboard.up('KeyW');
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all camera checks passed');
process.exit(fails ? 1 : 0);
