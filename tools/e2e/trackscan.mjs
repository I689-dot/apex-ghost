#!/usr/bin/env node
/**
 * Visual track scan: drives a camera round the whole lap and looks for holes in the world. The sky and fog are
 * switched off and the background is magenta, so anything you could see through shows as magenta. Every 50 m it
 * looks ahead, left and right from about car-roof height; each view is scored by the share of magenta pixels in
 * the lower part of the frame (where ground should be). The worst views go to a contact sheet
 * (tools/e2e/out/trackscan.png, with the lap distance and direction), and all scores to trackscan.json.
 *
 *   node tools/e2e/trackscan.mjs [--url http://127.0.0.1:5173] [--step 50] [--track <id>]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const STEP = Number(opt('step', '50'));
const TRACK = opt('track', '');
const W = 640;
const H = 360;

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript(() =>
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Scan', quality: 'medium', qualityAuto: false, language: 'en', showPerf: false })),
);
await page.goto(URL);
await page.waitForSelector('.menu');
await page.waitForTimeout(3000);
await page.click('button:has-text("Create room")');
await page.waitForSelector('.lb-steps');
if (TRACK) await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['trackId', TRACK]);
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['weather', 'clear']);
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['time', 'midday']);
await page.click('.lb-step >> nth=4');
await page.click('.car-card >> nth=0');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
// briefing: confirm the car setup
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 180_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const { session, scene, THREE } = window.__apex;
  session.env.sky.material.visible = false; // (the environment sets sky.visible every frame)
  scene.fog = null;
  scene.background = new THREE.Color(1, 0, 1);
  session.track.showAll?.();
  const ui = document.querySelector('.race-ui');
  if (ui) ui.style.display = 'none';
  session.myVisual.object.visible = false;
});
const n = await page.evaluate(() => window.__apex.session.trackData.length);
const results = [];
for (let s = 0; s < n; s += STEP) {
  for (const [dir, yawOff] of [
    ['ahead', 0],
    ['left', Math.PI / 2],
    ['right', -Math.PI / 2],
  ]) {
    await page.evaluate(
      ([s, yawOff]) => {
        const { session, gfx, THREE } = window.__apex;
        const td = session.trackData;
        const cl = td.centerline;
        const m = cl.length / 3;
        let i = 0;
        while (i < m - 1 && td.cumS[i] < s) i++;
        const j = (i + 1) % m;
        const yaw = Math.atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]) + yawOff;
        const cam = (window.__scanCam ??= new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.2, 4000));
        cam.position.set(cl[i * 3], cl[i * 3 + 1] + 3.5, cl[i * 3 + 2]);
        cam.lookAt(cl[i * 3] + Math.sin(yaw) * 40, cl[i * 3 + 1] - 2, cl[i * 3 + 2] + Math.cos(yaw) * 40);
        cam.aspect = window.innerWidth / window.innerHeight;
        cam.updateProjectionMatrix();
        gfx.setCamera(cam);
        session.track.updateVisibility(cam.position, gfx.quality);
      },
      [s, yawOff],
    );
    await page.waitForTimeout(350);
    const png = await page.screenshot();
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    let mag = 0;
    let cnt = 0;
    // lower 55 % of the frame: where the ground is
    for (let y = Math.floor(info.height * 0.45); y < info.height; y += 2) {
      for (let x = 0; x < info.width; x += 2) {
        const k = (y * info.width + x) * info.channels;
        const r = data[k];
        const g = data[k + 1];
        const b = data[k + 2];
        if (r > 200 && b > 200 && g < 60) mag++;
        cnt++;
      }
    }
    results.push({ s, dir, hole: mag / cnt, png });
  }
  process.stdout.write(`\r  ${Math.round(s)} / ${Math.round(n)} m`);
}
console.log();
results.sort((a, b) => b.hole - a.hole);
const bad = results.filter((r) => r.hole > 0.002);
console.log(`views with holes (>0.2 % of the ground area): ${bad.length} of ${results.length}`);
for (const r of bad.slice(0, 30)) console.log(`  ${String(Math.round(r.s)).padStart(5)} m ${r.dir.padEnd(5)} ${(r.hole * 100).toFixed(1)} %`);
writeFileSync(path.join(out, 'trackscan.json'), JSON.stringify(results.map(({ s, dir, hole }) => ({ s, dir, hole }))));
const top = (bad.length ? bad : results).slice(0, 16);
const tiles = await Promise.all(
  top.map(async (r) =>
    sharp(r.png)
      .resize(480, 270)
      .composite([
        {
          input: Buffer.from(
            `<svg width="480" height="270"><rect width="210" height="26" fill="#000a"/><text x="6" y="19" font-size="17" fill="#fff" font-family="sans-serif">${Math.round(r.s)} m ${r.dir} ${(r.hole * 100).toFixed(1)}%</text></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .toBuffer(),
  ),
);
await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#000' } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % 4) * 480, top: Math.floor(i / 4) * 270 })))
  .png()
  .toFile(path.join(out, 'trackscan.png'));
await browser.close();
