#!/usr/bin/env node
/**
 * Game controller check with a simulated pad (navigator.getGamepads is replaced; window.__pad holds its state):
 * menu focus moves with the D-pad and A presses, the triggers and stick drive the car, Menu opens the pause menu
 * and B closes it. Needs the dev server (window.__apex).
 *
 * --raw simulates a Switch Pro clone as Linux browsers report it (no standard layout: 14 buttons in kernel order,
 * D-pad on a hat = axes 4/5), next to a keyboard's "joystick" interface that must be ignored.
 *
 *   node tools/e2e/gamepad.mjs [--url http://127.0.0.1:5173] [--raw]
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:5173';
const RAW = args.includes('--raw');
// standard button → raw button (raw mode); the D-pad is an axis there
const RAWB = { 0: 0, 1: 1, 6: 7, 7: 8, 9: 10 };
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.addInitScript((raw) => {
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Pad', quality: 'low', qualityAuto: false, language: 'en' }));
  const mk = (id, mapping, nb, na, index) => ({
    id,
    index,
    connected: true,
    mapping,
    timestamp: 0,
    axes: Array(na).fill(0),
    buttons: Array.from({ length: nb }, () => ({ pressed: false, touched: false, value: 0 })),
  });
  const pad = raw ? mk('057e-2009-THUNDEROBOT G30', '', 14, 6, 1) : mk('Test Pad (STANDARD GAMEPAD)', 'standard', 17, 4, 0);
  const decoy = mk('342d-e453-Hangsheng RK-R65 System Control', '', 3, 0, 0);
  window.__pad = pad;
  window.navigator.getGamepads = () => (raw ? [decoy, pad, null, null] : [pad, null, null, null]);
}, RAW);
let fails = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails++;
};
const rawIndex = (i) => (RAW ? RAWB[i] : i);
const btn = (i, down) =>
  page.evaluate(
    ([i, down, raw]) => {
      if (raw && i === 13)
        window.__pad.axes[5] = down ? 1 : 0; // D-pad down on the hat
      else Object.assign(window.__pad.buttons[i], { pressed: down, value: down ? 1 : 0 });
      window.__pad.timestamp = performance.now();
    },
    [RAW && i === 13 ? 13 : rawIndex(i), down, RAW],
  );
const press = async (i) => {
  await btn(i, true);
  await page.waitForTimeout(80);
  await btn(i, false);
  await page.waitForTimeout(80);
};
const focused = () => page.evaluate(() => (document.activeElement?.textContent || document.activeElement?.tagName || '').trim());

await page.goto(URL);
await page.waitForSelector('.menu-card');
await page.waitForTimeout(1500);
// menu: D-pad down until "Play solo", then A
let reached = false;
for (let i = 0; i < 6 && !reached; i++) {
  await press(13);
  reached = /Play solo/.test(await focused());
}
check(reached, `D-pad moves the menu focus (now on "${await focused()}")`);
await press(0);
await page.waitForSelector('.car-card', { timeout: 30_000 });
check(true, 'A pressed "Play solo" → lobby');
await page.click('.car-card >> nth=0');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(300);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 180_000 });
await page.waitForTimeout(800);
await press(0); // A: skip the intro
await page.waitForFunction(() => window.__apex?.session, null, { timeout: 30_000 });
// wait for the start (countdown) then throttle
const speed = () => page.evaluate(() => Math.abs(window.__apex.session.vehicle.telemetry?.speed ?? window.__apex.session.vehicle.speedMs ?? 0));
// the car is held until the start countdown ends
await page.waitForFunction(() => window.__apex.session.vehicle.frozen === false, null, { timeout: 90_000 }).catch(() => {});
const v0 = await speed();
await page.evaluate((i) => Object.assign(window.__pad.buttons[i], { pressed: true, value: 1 }), rawIndex(7));
await page.waitForTimeout(4000);
const v1 = await speed();
check(v1 > v0 + 5, `RT accelerates (${v0.toFixed(1)} → ${v1.toFixed(1)} m/s)`);
await page.evaluate(() => (window.__pad.axes[0] = -1)); // stick left
await page.waitForTimeout(500);
const steerL = await page.evaluate(() => window.__apex.session.vehicle.steerAngle);
await page.evaluate(() => (window.__pad.axes[0] = 0.4));
await page.waitForTimeout(500);
const steerR = await page.evaluate(() => window.__apex.session.vehicle.steerAngle);
check(
  steerL > 0.02 && steerR < 0 && Math.abs(steerR) < steerL,
  `stick steers proportionally (full left ${steerL.toFixed(3)} rad, 40 % right ${steerR.toFixed(3)} rad)`,
);
await page.evaluate(
  ([thr, brk]) => {
    window.__pad.axes[0] = 0;
    Object.assign(window.__pad.buttons[thr], { pressed: false, value: 0 });
    Object.assign(window.__pad.buttons[brk], { pressed: true, value: 1 });
  },
  [rawIndex(7), rawIndex(6)],
);
await page.waitForTimeout(1500);
const v2 = await speed();
check(v2 < v1, `LT brakes (${v1.toFixed(1)} → ${v2.toFixed(1)} m/s)`);
await page.evaluate((i) => Object.assign(window.__pad.buttons[i], { pressed: false, value: 0 }), rawIndex(6));
await press(9);
await page.waitForTimeout(300);
check(!!(await page.$('.modal.pause')), 'Menu opens the pause menu');
await press(1);
await page.waitForTimeout(300);
check(!(await page.$('.modal.pause')), 'B closes it');
await page.screenshot({ path: 'tools/e2e/out/gamepad.png' });
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all controller checks passed');
process.exit(fails ? 1 : 0);
