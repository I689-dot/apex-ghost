#!/usr/bin/env node
/**
 * Look check, solo/offline: a session on the chosen preset (Ultra by default), the UI hidden, cameras placed on the
 * verge grass, over the pit boxes (the first of the row too: they used to sit inside the garages) and behind the
 * car; frames go to tools/e2e/out/looks/<preset>-<name>.png, with the frame time of each.
 *
 *   CHROME=/path/to/chrome node tools/e2e/looks.mjs [--url http://127.0.0.1:5173] [--quality ultra] [--track zandvoort]
 *     [--time morning]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'looks');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const QUALITY = opt('quality', 'ultra');
const TRACK = opt('track', '');
const TIME = opt('time', 'morning');

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e)));
page.on('console', (m) => m.type() === 'error' && console.log('  console', m.text()));
await page.addInitScript((q) => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({ nickname: 'Looks', quality: q, qualityAuto: false, language: 'en', dynamicResolution: false, racingLine: 'off', resolutionScale: 1 }),
  );
}, QUALITY);
await page.goto(URL);
await page.waitForSelector('.menu');
await page.waitForTimeout(1500);
await page.click('button.solo');
await page.waitForSelector('.car-card', { timeout: 30_000 });
if (TRACK) await page.selectOption('.prep .prep-row:nth-of-type(1) select', TRACK);
await page.selectOption('.prep .prep-row:nth-of-type(2) select', 'clear');
await page.selectOption('.prep .prep-row:nth-of-type(3) select', TIME);
await page.click('.car-card >> nth=0');
for (let i = 0; i < 3; i++) {
  await page.click('button.add-bot');
  await page.waitForTimeout(250);
}
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '.race-ui, .perf, .cinematic { display: none !important; }' });
// the grass and the scenery's distance culling follow the photo camera, not the car's
await page.evaluate(() => {
  const s = window.__apex.session;
  for (const o of [s.blades, s.shells, s.track]) {
    if (!o) continue;
    const k = o === s.track ? 'updateVisibility' : 'update';
    const f = o[k].bind(o);
    o[k] = (c, ...rest) => f(window.__lookCam?.position ?? c, ...rest);
  }
});

/** Render time of one frame (ms, median of 8, waited for the GPU), with and without the 3D grass. */
const frameMs = () =>
  page.evaluate(() => {
    const { gfx, session } = window.__apex;
    const gl = gfx.renderer.getContext();
    const px = new Uint8Array(4);
    const time = () => {
      const t = [];
      for (let i = 0; i < 8; i++) {
        const t0 = performance.now();
        gfx.render();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        t.push(performance.now() - t0);
      }
      return t.sort((a, b) => a - b)[4];
    };
    const all = time();
    const g = session.blades?.mesh;
    let without = all;
    if (g?.visible) {
      g.visible = false;
      without = time();
      g.visible = true;
    }
    const n = g ? g.children.filter((c) => c.visible).reduce((s, c) => s + c.geometry.instanceCount, 0) : 0;
    return `${all.toFixed(1)} ms (${without.toFixed(1)} without the grass; ${n} tufts drawn)`;
  });
/** A camera at `from` looking at `to` (world, [x, y, z]), or computed in the page by `place`. */
const shot = async (name, place) => {
  const ok = await page.evaluate((src) => {
    const { session, gfx, THREE } = window.__apex;
    const cam = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 9000);
    const r = new Function('session', 'THREE', 'cam', src)(session, THREE, cam);
    if (r === false) return false;
    gfx.setCamera(cam);
    window.__lookCam = cam;
    return true;
  }, place);
  if (!ok) return console.log(`  ${name}: no place`);
  await page.waitForTimeout(2500);
  const ms = await frameMs();
  await page.screenshot({ path: path.join(out, `${QUALITY}-${name}.png`) });
  console.log(`  ${QUALITY}-${name}.png  render ${ms}`);
};
// the verge beside the grid, low (a driver's eye over the grass)
await shot(
  'grass',
  `const t = session.trackData; const g = t.grid[0]; const f = [Math.sin(g.yaw), Math.cos(g.yaw)]; const l = [f[1], -f[0]];
   const w = t.widthL[0] + 1.2;
   cam.position.set(g.p[0] + l[0] * w - f[0] * 2, g.p[1] + 0.55, g.p[2] + l[1] * w - f[1] * 2);
   cam.lookAt(g.p[0] + l[0] * (w + 2) + f[0] * 14, g.p[1] + 0.1, g.p[2] + l[1] * (w + 2) + f[1] * 14);`,
);
// right down in the grass where it is thickest: the first verge beside the circuit's edge with 3D grass
await shot(
  'grass-close',
  `const g = session.blades; if (!g) return false; let best = null;
   for (const c of g.chunks) { const a = c.mesh.geometry.getAttribute('aInst'); if (a.count > 400) { best = a; break; } }
   if (!best) return false; const i = Math.floor(best.count / 2);
   const x = best.getX(i), y = best.getY(i), z = best.getZ(i);
   cam.position.set(x - 3, y + 0.45, z - 3); cam.lookAt(x + 2, y, z + 2);`,
);
// the verge from a little higher, towards the sun's side
await shot(
  'grass-wide',
  `const t = session.trackData; const g = t.grid[2]; const f = [Math.sin(g.yaw), Math.cos(g.yaw)]; const l = [-f[1], f[0]];
   const w = t.widthR[0] + 2;
   cam.position.set(g.p[0] + l[0] * w - f[0] * 6, g.p[1] + 1.6, g.p[2] + l[1] * w - f[1] * 6);
   cam.lookAt(g.p[0] + l[0] * (w + 3) + f[0] * 30, g.p[1], g.p[2] + l[1] * (w + 3) + f[1] * 30);`,
);
// the pit boxes: over the start of the row and the middle, looking at the garages
for (const [name, k] of [
  ['pits-first', 0],
  ['pits-mid', -1],
]) {
  await shot(
    name,
    `const pit = session.pit; if (!pit) return false; const boxes = pit.boxes(); const k = ${k} < 0 ? Math.floor(boxes.length / 2) : ${k};
     const [a, b] = boxes[k]; const i = Math.round((a + b) / 2); const p = pit.lane.points[i]; const [ax, az] = pit.awayAt(i); const sh = pit.shiftAt(i);
     const q = pit.lane.points[Math.min(pit.lane.points.length - 1, i + 6)];
     cam.position.set(p[0] - ax * 9 - (q[0] - p[0]) * 1.2, p[1] + 6.5, p[2] - az * 9 - (q[2] - p[2]) * 1.2);
     cam.lookAt(p[0] + ax * (sh + 2), p[1], p[2] + az * (sh + 2));`,
  );
}
// behind my car on the grid
await shot(
  'grid',
  `const o = session.myVisual.object; const f = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
   cam.position.copy(o.position).addScaledVector(f, -6).add(new THREE.Vector3(0, 1.8, 0)); cam.lookAt(o.position.clone().addScaledVector(f, 6));`,
);
await browser.close();
