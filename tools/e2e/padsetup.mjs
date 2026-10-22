#!/usr/bin/env node
/**
 * Settings → Controller button setup with a simulated unknown pad (no standard layout, triggers on axes that rest
 * at −1, D-pad on a hat): the live view must say "Unknown", the setup must learn every control, and afterwards the
 * live view must read the throttle from the learned axis.
 *
 *   node tools/e2e/padsetup.mjs [--url http://127.0.0.1:5173]
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.addInitScript(() => {
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Pad', language: 'en' }));
  // axes: LX LY RX RY LT(rest −1) RT(rest −1) hatX hatY
  const pad = {
    id: 'dead-beef-Generic USB Pad',
    index: 0,
    connected: true,
    mapping: '',
    timestamp: 0,
    axes: [0, 0, 0, 0, -1, -1, 0, 0],
    buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  window.__pad = pad;
  window.navigator.getGamepads = () => [pad, null, null, null];
});
let fails = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails++;
};
const set = (fn, arg) => page.evaluate(fn, arg);
const step = async (on, off, arg) => {
  await set(on, arg);
  await page.waitForTimeout(250);
  await set(off, arg);
  await page.waitForTimeout(250);
  if (process.env.DEBUG) console.log('  prompt:', await page.textContent('.pad-prompt'));
};
await page.goto(URL);
await page.waitForSelector('.menu-card');
await page.click('.menu-foot button');
await page.waitForSelector('.pad-setup');
await page.waitForTimeout(300);
check(/Unknown/.test(await page.textContent('.pad-status')), `live view: ${await page.textContent('.pad-status')}`);
await page.click('button:has-text("Set up buttons")');
await page.waitForTimeout(400);
const b = (i) => [
  (i) => Object.assign(window.__pad.buttons[i], { pressed: true, value: 1 }),
  (i) => Object.assign(window.__pad.buttons[i], { pressed: false, value: 0 }),
  i,
];
// throttle = axis 5, brake = axis 4, steer = axis 0, then buttons, then the hat
await step(
  () => (window.__pad.axes[5] = 1),
  () => (window.__pad.axes[5] = -1),
);
await step(
  () => (window.__pad.axes[4] = 1),
  () => (window.__pad.axes[4] = -1),
);
await step(
  () => (window.__pad.axes[0] = 1),
  () => (window.__pad.axes[0] = 0),
);
for (const i of [2, 1, 5, 4, 3, 9, 8]) await step(...b(i));
await step(
  () => (window.__pad.axes[7] = -1),
  () => (window.__pad.axes[7] = 0),
);
await step(
  () => (window.__pad.axes[7] = 1),
  () => (window.__pad.axes[7] = 0),
);
await step(
  () => (window.__pad.axes[6] = -1),
  () => (window.__pad.axes[6] = 0),
);
await step(
  () => (window.__pad.axes[6] = 1),
  () => (window.__pad.axes[6] = 0),
);
await page.waitForTimeout(300);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('apexghost.settings.v1')).pad?.layouts?.['dead-beef-generic usb pad']);
check(!!saved, 'layout saved for this pad');
check(JSON.stringify(saved?.buttons[7]) === JSON.stringify({ a: 5, dir: 1, rest: -1 }), `throttle learned from axis 5 (${JSON.stringify(saved?.buttons[7])})`);
check(JSON.stringify(saved?.buttons[0]) === JSON.stringify({ b: 2 }), `handbrake/select learned from button 2 (${JSON.stringify(saved?.buttons[0])})`);
check(
  JSON.stringify(saved?.buttons[15]) === JSON.stringify({ a: 6, dir: 1, rest: 0 }),
  `D-pad right learned from the hat (${JSON.stringify(saved?.buttons[15])})`,
);
check(/Your setup/.test(await page.textContent('.pad-status')), 'live view now uses your setup');
await set(() => (window.__pad.axes[5] = 0)); // half throttle
await page.waitForTimeout(200);
const live = await page.textContent('.pad-live');
check(/Throttle 0\.50/.test(live) && /Brake 0\.00/.test(live), `live view reads it: ${live}`);
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all setup checks passed');
process.exit(fails ? 1 : 0);
