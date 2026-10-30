#!/usr/bin/env node
/**
 * Z-fighting scan: where painted lines, kerbs, verges and the adverts on the barriers flicker against the surface
 * under them. Every --step m round the lap a camera at a driver's eye height looks ahead and to both sides; each view
 * is drawn twice with the same camera but a different near plane, which changes only how depth is quantised, not
 * where anything is on screen: every pixel that differs is two surfaces fighting over the same depth. Scored by the
 * share of such pixels; the worst views (marked in magenta) go to tools/e2e/out/zfight.png, every score to
 * zfight.json.
 *
 *   CHROME=/path/to/chrome node tools/e2e/zfight.mjs [--url http://127.0.0.1:5173] [--step 80] [--track <id>] [--top 12]
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
const STEP = Number(opt('step', '80'));
const TRACK = opt('track', '');
const TOP = Number(opt('top', '12'));
const W = 640;
const H = 360;

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('  pageerror', String(e)));
await page.addInitScript(() => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({ nickname: 'Scan', quality: 'medium', qualityAuto: false, language: 'en', dynamicResolution: false }),
  );
});
await page.goto(URL);
await page.waitForSelector('.menu');
await page.waitForTimeout(1200);
await page.click('button.solo');
await page.waitForSelector('.lb-steps', { timeout: 30_000 });
if (TRACK) await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['trackId', TRACK]);
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['weather', 'clear']);
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['time', 'midday']);
await page.click('.lb-step >> nth=4');
await page.click('.car-card >> nth=0');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(300);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '.race-ui, .perf, .cinematic { display: none !important; }' });

const total = await page.evaluate(() => window.__apex.session.trackData.length);
const views = [];
for (let s = 0; s < total; s += STEP) {
  const res = await page.evaluate(
    async ({ s, W, H }) => {
      const { session, gfx, THREE } = window.__apex;
      const tr = session.track;
      const pt = { x: 0, y: 0, z: 0, yaw: 0 };
      tr.pointAt(s, pt);
      const gl = gfx.renderer.getContext();
      const cam = new THREE.PerspectiveCamera(60, W / H, 0.1, 6000);
      const f = new THREE.Vector3(Math.sin(pt.yaw), 0, Math.cos(pt.yaw));
      const left = new THREE.Vector3(f.z, 0, -f.x);
      const shots = [];
      for (const [name, look, side] of [
        ['ahead', 0, 0],
        ['left', 0.75, 1],
        ['right', -0.75, -1],
      ]) {
        cam.position.set(pt.x, pt.y + 1.1, pt.z).addScaledVector(left, side * 3);
        const dir = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), look);
        cam.lookAt(
          cam.position
            .clone()
            .add(dir)
            .add(new THREE.Vector3(0, -0.12, 0)),
        );
        // the scenery's distance culling and the grass follow this camera
        tr.updateVisibility(cam.position, gfx.quality);
        session.shells?.update(cam.position, gfx.quality);
        gfx.setCamera(cam);
        const px = [];
        for (const near of [0.1, 0.137]) {
          cam.near = near;
          cam.updateProjectionMatrix();
          gfx.render();
          const b = new Uint8Array(W * H * 4);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
          px.push(b);
        }
        // pixels that change with the depth quantisation alone
        let bad = 0;
        const mark = new Uint8Array(px[0]);
        for (let i = 0; i < W * H; i++) {
          const d = Math.abs(px[0][i * 4] - px[1][i * 4]) + Math.abs(px[0][i * 4 + 1] - px[1][i * 4 + 1]) + Math.abs(px[0][i * 4 + 2] - px[1][i * 4 + 2]);
          if (d > 45) {
            bad++;
            mark[i * 4] = 255;
            mark[i * 4 + 1] = 0;
            mark[i * 4 + 2] = 255;
          }
        }
        // an image (rows bottom-up from readPixels) for the contact sheet
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const g = c.getContext('2d');
        const img = g.createImageData(W, H);
        for (let y = 0; y < H; y++) img.data.set(mark.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        g.putImageData(img, 0, 0);
        shots.push({ name, score: bad / (W * H), png: c.toDataURL('image/png') });
      }
      return shots;
    },
    { s, W, H },
  );
  for (const r of res) views.push({ s, ...r });
  const worst = Math.max(...res.map((r) => r.score));
  if (worst > 0.002) console.log(`  ${String(s).padStart(5)} m  ${res.map((r) => `${r.name} ${(r.score * 100).toFixed(2)} %`).join('  ')}`);
}
await browser.close();
views.sort((a, b) => b.score - a.score);
writeFileSync(
  path.join(out, 'zfight.json'),
  JSON.stringify(
    views.map(({ s, name, score }) => ({ s, name, score })),
    null,
    1,
  ),
);
const top = views.slice(0, TOP);
const tiles = await Promise.all(
  top.map(async (v) =>
    sharp(Buffer.from(v.png.split(',')[1], 'base64'))
      .resize(320, 180)
      .composite([
        {
          input: Buffer.from(
            `<svg width="320" height="180"><rect width="320" height="22" fill="black" opacity="0.6"/><text x="6" y="16" font-size="14" fill="white" font-family="sans-serif">${v.s} m ${v.name} · ${(v.score * 100).toFixed(2)} %</text></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer(),
  ),
);
const cols = 3;
await sharp({ create: { width: 320 * cols, height: 180 * Math.ceil(tiles.length / cols), channels: 3, background: '#000' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * 320, top: Math.floor(i / cols) * 180 })))
  .png()
  .toFile(path.join(out, 'zfight.png'));
const mean = views.reduce((a, v) => a + v.score, 0) / views.length;
console.log(
  `  ${views.length} views: mean ${(mean * 100).toFixed(3)} %, worst ${(views[0].score * 100).toFixed(2)} % at ${views[0].s} m ${views[0].name}; sheet tools/e2e/out/zfight.png`,
);
