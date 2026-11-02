#!/usr/bin/env node
/**
 * A crash on purpose: the car is put on the track pointing at the barrier at speed (chase camera), frames of the
 * sparks and debris, then the damage report (held key) and what the race control and the car show afterwards.
 *
 *   node tools/e2e/crash.mjs [--track nurburgring_gp_2022] [--s 900] [--speed 32] [--angle 55] [--tag crash]
 *
 * Writes tools/e2e/out/crash/<tag>_<n>.png and prints the damage state.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'crash');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const TRACK = opt('track', '');
const S = Number(opt('s', '900'));
const SPEED = Number(opt('speed', '32'));
const ANGLE = Number(opt('angle', '55'));
const TAG = opt('tag', 'crash');

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.addInitScript(() => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({
      nickname: 'Crash',
      quality: 'medium',
      qualityAuto: false,
      language: 'en',
      camera: 'chase',
      showPerf: false,
      racingLine: 'off',
      ghost: false,
    }),
  );
});
await page.goto(URL);
await page.click('button:has-text("Play solo")');
await page.waitForSelector('.lb-steps', { timeout: 60_000 });
await page.waitForTimeout(800);
const cond = (k, v) => page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), [k, v]);
if (TRACK) await cond('trackId', TRACK);
await page.waitForTimeout(400);
await cond('weather', 'clear');
await cond('time', 'midday');
await page.waitForTimeout(300);
await page.click('.lb-step >> nth=4');
await page.click('.car-card >> nth=0');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.keyboard.press('Enter');
// after the start (the car is held until the lights go out)
await page.waitForFunction(() => window.__apex?.session?.vehicle && !window.__apex.session.vehicle.frozen, null, { timeout: 90_000 });
await page.waitForTimeout(800);
// pointed at the left barrier at speed
await page.evaluate(
  ([s, speed, angle]) => {
    const ses = window.__apex.session;
    const td = ses.trackData;
    const cl = td.centerline;
    let i = 0;
    while (i < cl.length / 3 - 1 && td.cumS[i] < s) i++;
    const j = i + 1;
    const yaw0 = Math.atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]);
    const yaw = yaw0 + (angle * Math.PI) / 180;
    const v = ses.vehicle;
    v.place(cl[i * 3], cl[i * 3 + 1] + 0.3, cl[i * 3 + 2], yaw);
    v.frozen = false;
    v.body.setLinvel({ x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed }, true);
  },
  [S, SPEED, ANGLE],
);
const frames = [150, 250, 400, 1200, 2500];
let last = 0;
for (const [n, at] of frames.entries()) {
  await page.waitForTimeout(at - last);
  last = at;
  await page.screenshot({ path: path.join(out, `${TAG}_${n}.png`) });
}
await page.keyboard.down('KeyF');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, `${TAG}_report.png`) });
await page.keyboard.up('KeyF');
const st = await page.evaluate(() => {
  const s = window.__apex.session;
  return {
    zones: Array.from(s.damage.zones, (z) => +z.toFixed(2)),
    corners: Array.from(s.damage.corners, (z) => +z.toFixed(2)),
    punctured: s.damage.punctured,
    flag: document.querySelector('.hud-flag')?.textContent,
    panel: !document.querySelector('.dmg-panel')?.hidden,
    debris: s.crashFx.debris.count,
  };
});
console.log(JSON.stringify(st));
await browser.close();
