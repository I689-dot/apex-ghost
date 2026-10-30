#!/usr/bin/env node
/* global screen, DeviceMotionEvent */
/**
 * Mobile checks with Playwright (software WebGL): the desktop menu's "Get the mobile app" link, the website on a
 * phone (desktop-only page with the install button), and the app UI (`?app=1` in dev, or the built app bundle)
 * on a landscape phone with touch: menu, solo lobby, race HUD with the touch controls, touch pedals and steering,
 * tilt steering from synthetic device-motion events. Screenshots go to tools/e2e/out/mobile-*.png.
 *
 *   node tools/e2e/mobile.mjs [--url http://127.0.0.1:5173] [--app-url <url of the app bundle>] [--skip-race] [--gpu]
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const APP_URL = opt('app-url', `${URL}/?app=1`);
const failures = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? '✔' : '✘'} ${msg}`);
  if (!ok) failures.push(msg);
};

const GPU = args.includes('--gpu');
const browser = await chromium.launch({
  args: GPU
    ? ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const settingsInit = () => {
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Phone', qualityAuto: false, quality: 'low', dynamicResolution: false }));
  localStorage.setItem('apexghost.noAudio', '1');
};

/* ---------------------------------------------------------------- desktop menu --- */
{
  console.log('▶ desktop menu');
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(settingsInit);
  await page.goto(URL);
  await page.waitForSelector('.menu', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  check(await page.isVisible('.menu-foot .get-app'), 'desktop menu shows "Get the mobile app"');
  await page.screenshot({ path: path.join(out, 'mobile-01-desktop-menu.png') });
  await page.click('.menu-foot .get-app');
  await page.waitForSelector('.get-app-card .qr svg', { timeout: 10_000 }).catch(() => {});
  check(await page.isVisible('.get-app-card .qr svg'), 'get-the-app dialog with a QR code');
  check((await page.getAttribute('.get-app-card a.install-btn', 'href'))?.endsWith('downloads/apex-ghost.apk'), 'dialog links the APK');
  await page.screenshot({ path: path.join(out, 'mobile-02-desktop-getapp.png') });
  check(!(await page.isVisible('.touch-controls.on')), 'no touch controls on the desktop site');
  await page.close();
}

/* ------------------------------------------------------- website on a phone --- */
{
  console.log('▶ website on a phone');
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForSelector('.install-page', { timeout: 30_000 });
  await page.waitForTimeout(800);
  check(await page.isVisible('.install-page a.install-btn'), 'phone browser: desktop-only page with "Install the app"');
  check(!(await page.isVisible('.menu-card')), 'phone browser: the game menu is not shown');
  await page.screenshot({ path: path.join(out, 'mobile-03-phone-install.png') });
  await ctx.close();
  const ictx = await browser.newContext({ ...devices['iPhone 13'] });
  const ipage = await ictx.newPage();
  await ipage.goto(URL);
  await ipage.waitForSelector('.install-page', { timeout: 30_000 });
  await ipage.waitForTimeout(500);
  await ipage.screenshot({ path: path.join(out, 'mobile-03b-iphone-install.png') });
  await ictx.close();
}

/* ------------------------------------------------------------------ the app --- */
{
  console.log('▶ app (landscape phone, touch)');
  const pixel = devices['Pixel 7 landscape'];
  const ctx = await browser.newContext({ ...pixel, viewport: pixel.screen }); // the app is full screen
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(settingsInit);
  await page.goto(APP_URL);
  await page.waitForSelector('.menu', { timeout: 60_000 });
  await page.waitForTimeout(2500);
  check(await page.evaluate(() => document.documentElement.classList.contains('mobile-app')), 'app mode (html.mobile-app)');
  check(!(await page.isVisible('.menu-foot .get-app')), 'no "Get the mobile app" link inside the app');
  await page.screenshot({ path: path.join(out, 'mobile-04-app-menu.png') });
  // settings: touch controls section
  await page.click('.menu-foot button.ghost');
  await page.waitForSelector('.modal-card.settings');
  await page.waitForTimeout(400);
  check(await page.isVisible('text=Touch controls'), 'settings show the touch controls section');
  await page.locator('.modal-card.settings section').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'mobile-05-app-settings.png') });
  await page.click('.modal-card.settings header button.icon');

  if (!args.includes('--skip-race')) {
    await page.tap('button.solo');
    await page.waitForSelector('.car-card', { timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(out, 'mobile-06-app-lobby.png') });
    await page.tap('.car-card >> nth=0');
    await page.waitForTimeout(800);
    await page.locator('.lobby-actions button:has-text("Ready")').tap();
    await page.waitForTimeout(600);
    await page.locator('button:has-text("Start race")').tap();
    await page.waitForSelector('.briefing', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, 'mobile-07-app-briefing.png') });
    await page
      .locator('button:has-text("Ready to go")')
      .tap({ timeout: 20_000 })
      .catch(() => {});
    console.log('  loading race…');
    await page.waitForSelector('.race-ui', { timeout: 300_000 });
    await page.waitForSelector('.touch-controls.on', { timeout: 10_000 });
    await page.waitForTimeout(2500);
    check(await page.isVisible('.touch-controls .tc-skip'), 'intro: "Skip intro" button');
    await page.screenshot({ path: path.join(out, 'mobile-08-app-intro.png') });
    if (await page.isVisible('.touch-controls .tc-skip')) await page.tap('.touch-controls .tc-skip', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    check(!(await page.isVisible('.touch-controls .tc-skip')), 'intro skipped by touch');
    // wait for the green light
    await page.waitForFunction(() => window.__apex?.session && !window.__apex.session.vehicle.frozen, null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const cdp = await ctx.newCDPSession(page);
    const box = async (sel) => {
      const b = await page.locator(sel).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width };
    };
    const thr = await box('.tc-throttle');
    const steerPad = await box('.tc-steer');
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    // throttle with the right thumb, and steer left with the left thumb half-way through
    await touch('touchStart', [{ x: thr.x, y: thr.y, id: 1 }]);
    await page.waitForTimeout(3500);
    const kmh1 = Number(await page.textContent('.hud-speed'));
    check(kmh1 > 20, `throttle pedal accelerates the car (${kmh1} km/h)`);
    const left = { x: steerPad.x - steerPad.w / 4, y: steerPad.y, id: 2 };
    await touch('touchMove', [{ x: thr.x, y: thr.y, id: 1 }, left]);
    await touch('touchStart', [{ x: thr.x, y: thr.y, id: 1 }, left]);
    await page.waitForTimeout(500);
    const steer = await page.evaluate(() => window.__apex.session.vehicle.steerAngle);
    check(steer > 0.01, `left arrow steers left (${steer.toFixed(3)} rad)`);
    await page.screenshot({ path: path.join(out, 'mobile-09-app-hud-driving.png') });
    await touch('touchEnd', []);
    await page.waitForTimeout(300);
    // gearbox, look back, timing, pause by touch
    await page.tap('.tc-gearbox');
    await page.waitForTimeout(300);
    check((await page.textContent('.tc-gearbox')) === 'MAN', 'gearbox button switches to manual');
    const gear0 = await page.textContent('.hud-gear');
    await page.tap('.tc-up');
    await page.waitForTimeout(300);
    console.log(`    gear ${gear0} → ${await page.textContent('.hud-gear')}`);
    const tim = await box('.tc-timing');
    await touch('touchStart', [{ x: tim.x, y: tim.y, id: 3 }]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, 'mobile-10-app-timing.png') });
    check(await page.evaluate(() => window.__apex.session.timing.visible), 'TIMES button holds the timing screen');
    await touch('touchEnd', []);
    // tilt steering from synthetic sensor events (landscape: the phone's y axis is the screen's horizontal)
    await page.evaluate(() => {
      localStorage.setItem('apexghost.touch.v1', JSON.stringify({ steer: 'tilt' }));
    });
    await page.tap('.tc-pause');
    await page.waitForSelector('.modal.pause', { timeout: 5000 });
    await page.screenshot({ path: path.join(out, 'mobile-11-app-pause.png') });
    await page.locator('.pause-card button:has-text("Settings")').tap();
    await page.waitForSelector('.modal-card.settings');
    await page.selectOption('.modal-card.settings section:last-child select', 'tilt');
    await page.click('.modal-card.settings header button.icon');
    await page.locator('.pause-card button.primary').tap();
    await page.waitForTimeout(300);
    const tilt = async (deg) =>
      page.evaluate((d) => {
        const a = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
        const r = (d * Math.PI) / 180;
        // gravity reaction in screen axes: lean d° to the left = +x on screen
        const sx = 9.81 * Math.sin(r);
        const sy = 9.81 * Math.cos(r) * 0.7;
        const sz = 9.81 * Math.cos(r) * 0.7;
        // back to device axes (inverse of the rotation in touchControls.ts)
        const gx = sx * Math.cos(a) + sy * Math.sin(a);
        const gy = -sx * Math.sin(a) + sy * Math.cos(a);
        for (let i = 0; i < 20; i++) window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: gx, y: gy, z: sz } }));
      }, deg);
    const thr2 = await box('.tc-throttle');
    await touch('touchStart', [{ x: thr2.x, y: thr2.y, id: 1 }]);
    await tilt(20);
    await page.waitForTimeout(600);
    await tilt(20);
    const st2 = await page.evaluate(() => window.__apex.session.vehicle.steerAngle);
    check(st2 > 0.005, `tilting left steers left (${st2.toFixed(3)} rad)`);
    await page.screenshot({ path: path.join(out, 'mobile-12-app-hud-tilt.png') });
    await tilt(-20);
    await page.waitForTimeout(700);
    const st3 = await page.evaluate(() => window.__apex.session.vehicle.steerAngle);
    check(st3 < -0.005, `tilting right steers right (${st3.toFixed(3)} rad)`);
    await touch('touchEnd', []);
  }
  const real = errors.filter((e) => !/favicon|fonts\.g|ERR_INTERNET|net::/.test(e));
  check(real.length === 0, `no page errors${real.length ? `: ${real.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `✘ ${failures.length} failed` : '✔ all mobile checks passed');
process.exit(failures.length ? 1 : 0);
