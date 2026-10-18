#!/usr/bin/env node
/**
 * Render audit: views of the whole lap as the game draws it (clear midday, chosen quality), for looking at by eye.
 *  - driver: every --step m along the centreline, 1.05 m above the road, looking ahead (a driver's eye line);
 *  - air: every --air-step m, 45 m up and 60 m back, looking down at the track;
 *  - flicker: each driver view is rendered twice with the camera moved 2 mm; the share of pixels that change a lot
 *    marks z-fighting (coplanar surfaces swapping order) and shimmering. The worst are listed.
 * Contact sheets go to tools/e2e/out/lapviews/{driver,air}-NN.png (12 views each, with the lap distance).
 *
 *   node tools/e2e/lapviews.mjs [--url http://127.0.0.1:5173] [--step 100] [--air-step 400] [--quality medium]
 *       [--from 0] [--to 5202] [--height 1.05]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'lapviews');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const STEP = Number(opt('step', '100'));
const AIR = Number(opt('air-step', '400'));
const QUALITY = opt('quality', 'medium');
const FROM = Number(opt('from', '0'));
const TO = Number(opt('to', '1e9'));
const EYE = Number(opt('height', '1.05'));
const W = 960;
const H = 540;

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript((q) => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({ nickname: 'Audit', quality: q, qualityAuto: false, language: 'en', showPerf: false, dynamicResolution: false }),
  );
}, QUALITY);
await page.goto(URL);
await page.click('button.primary:has-text("Create room")');
await page.waitForSelector('.car-card');
await page.selectOption('.prep .prep-row:nth-of-type(2) select', 'clear');
await page.selectOption('.prep .prep-row:nth-of-type(3) select', 'midday');
await page.click('.car-card >> nth=0');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.waitForSelector('.race-ui', { timeout: 180_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '.race-ui{display:none!important}' });
await page.evaluate(() => {
  window.__apex.session.myVisual.object.visible = false;
});
const n = await page.evaluate(() => window.__apex.session.trackData.length);

/** Camera at lap distance s: mode 'driver' or 'air'; dz = extra offset along the view (flicker test). */
const place = (s, mode, jitter) =>
  page.evaluate(
    ([s, mode, jitter, eye]) => {
      const { session, gfx, THREE } = window.__apex;
      const td = session.trackData;
      const cl = td.centerline;
      const m = cl.length / 3;
      let i = 0;
      while (i < m - 1 && td.cumS[i] < s) i++;
      const j = (i + 3) % m;
      const yaw = Math.atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]);
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const cam = (window.__auditCam ??= new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 9000));
      // ground under the line (the centreline height is a trace, not the surface)
      const ray = new THREE.Raycaster(new THREE.Vector3(cl[i * 3], cl[i * 3 + 1] + 3, cl[i * 3 + 2]), new THREE.Vector3(0, -1, 0), 0, 8);
      const hit = ray.intersectObject(session.track.root, true)[0];
      const gy = hit ? hit.point.y : cl[i * 3 + 1];
      if (mode === 'driver') {
        cam.position.set(cl[i * 3] + fx * jitter, gy + eye, cl[i * 3 + 2] + fz * jitter);
        cam.lookAt(cl[i * 3] + fx * 60, gy + eye - 2.2, cl[i * 3 + 2] + fz * 60);
      } else {
        cam.position.set(cl[i * 3] - fx * 60, gy + 45, cl[i * 3 + 2] - fz * 60);
        cam.lookAt(cl[i * 3] + fx * 30, gy, cl[i * 3 + 2] + fz * 30);
      }
      cam.aspect = window.innerWidth / window.innerHeight;
      cam.updateProjectionMatrix();
      gfx.setCamera(cam);
      session.track.updateVisibility(cam.position, gfx.quality);
      return Math.round(td.cumS[i]);
    },
    [s, mode, jitter, EYE],
  );

const views = { driver: [], air: [] };
const flicker = [];
for (let s = Math.max(0, FROM); s < Math.min(n, TO); s += STEP) {
  const at = await place(s, 'driver', 0);
  await page.waitForTimeout(400);
  const a = await page.screenshot();
  await place(s, 'driver', 0.002);
  await page.waitForTimeout(250);
  const b = await page.screenshot();
  const [ra, rb] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()]);
  let changed = 0;
  let cnt = 0;
  for (let k = 0; k < ra.length; k += 4 * 3) {
    const d = Math.abs(ra[k] - rb[k]) + Math.abs(ra[k + 1] - rb[k + 1]) + Math.abs(ra[k + 2] - rb[k + 2]);
    if (d > 90) changed++;
    cnt++;
  }
  flicker.push({ s: at, share: changed / cnt });
  views.driver.push({ s: at, png: a, note: `${at} m  flicker ${((100 * changed) / cnt).toFixed(2)}%` });
  process.stdout.write(`\r  driver ${at} / ${Math.round(n)} m`);
}
console.log();
for (let s = Math.max(0, FROM); s < Math.min(n, TO); s += AIR) {
  const at = await place(s, 'air', 0);
  await page.waitForTimeout(600);
  views.air.push({ s: at, png: await page.screenshot(), note: `${at} m from the air` });
}
const sheet = async (list, name) => {
  for (let k = 0; k < list.length; k += 12) {
    const part = list.slice(k, k + 12);
    const tiles = await Promise.all(
      part.map((v) =>
        sharp(v.png)
          .resize(480, 270)
          .composite([
            {
              input: Buffer.from(
                `<svg width="480" height="270"><rect width="250" height="24" fill="#000a"/><text x="6" y="17" font-size="15" fill="#ff0" font-family="sans-serif">${v.note}</text></svg>`,
              ),
              top: 0,
              left: 0,
            },
          ])
          .toBuffer(),
      ),
    );
    const rows = Math.ceil(tiles.length / 3);
    await sharp({ create: { width: 1440, height: 270 * rows, channels: 3, background: '#000' } })
      .composite(tiles.map((t, i) => ({ input: t, left: (i % 3) * 480, top: Math.floor(i / 3) * 270 })))
      .png()
      .toFile(path.join(out, `${name}-${String(k / 12).padStart(2, '0')}.png`));
  }
};
await sheet(views.driver, 'driver');
await sheet(views.air, 'air');
flicker.sort((a, b) => b.share - a.share);
console.log('most flicker between two renders 2 mm apart (z-fighting / shimmer):');
for (const f of flicker.slice(0, 10)) console.log(`  ${String(f.s).padStart(5)} m  ${(f.share * 100).toFixed(2)} %`);
writeFileSync(path.join(out, 'flicker.json'), JSON.stringify(flicker));
await browser.close();
