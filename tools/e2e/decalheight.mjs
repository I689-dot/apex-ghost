#!/usr/bin/env node
/**
 * Decal height check: painted lines, kerbs and markings must lie on top of the surface they are painted on. For a
 * sample of each decal material's vertices, the surface under it (the road and verge meshes) is found with a ray,
 * and the height of the paint over it is listed (negative: the paint is under the road, hidden, so lines break into
 * dashes; near zero: they fight over depth and flicker in the distance).
 *
 *   CHROME=/path/to/chrome node tools/e2e/decalheight.mjs [--url http://127.0.0.1:5173] [--track <id>]
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const TRACK = opt('track', '');
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript(() => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Scan', quality: 'low', qualityAuto: false, language: 'en' }));
});
await page.goto(URL);
await page.waitForSelector('.menu-card');
await page.waitForTimeout(1200);
await page.click('button.solo');
await page.waitForSelector('.car-card', { timeout: 30_000 });
if (TRACK) await page.selectOption('.prep .prep-row:nth-of-type(1) select', TRACK);
await page.click('.car-card >> nth=0');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(300);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
const res = await page.evaluate(() => {
  const { session, THREE } = window.__apex;
  const root = session.track.root;
  root.updateMatrixWorld(true);
  const decal = /^(lines|redline|box_decal|nurb_decal|curb)/i;
  const under = /^(asph|pits|conc_|pavement|tiles|travert|grass|astroturf|gravel|sand)/i;
  const targets = [];
  const decals = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = [o.material].flat()[0]?.name ?? '';
    if (decal.test(name)) decals.push(o);
    else if (under.test(name)) targets.push(o);
  });
  const rc = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const v = new THREE.Vector3();
  const by = {};
  for (const m of decals) {
    const name = [m.material].flat()[0].name.replace(/_\d+$/, '');
    const pos = m.geometry.getAttribute('position');
    const n = pos.count;
    const step = Math.max(1, Math.floor(n / 400));
    const d = (by[name] ??= []);
    for (let i = 0; i < n; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      rc.set(new THREE.Vector3(v.x, v.y + 0.5, v.z), down);
      rc.far = 1.5;
      const h = rc.intersectObjects(targets, false)[0];
      if (h) d.push(v.y - h.point.y);
    }
  }
  const out = {};
  for (const [k, d] of Object.entries(by)) {
    if (!d.length) continue;
    d.sort((a, b) => a - b);
    const q = (f) => d[Math.min(d.length - 1, Math.floor(d.length * f))];
    out[k] = {
      n: d.length,
      below: d.filter((x) => x < -0.002).length / d.length,
      under1cm: d.filter((x) => x < 0.01).length / d.length,
      p5: q(0.05),
      p50: q(0.5),
      p95: q(0.95),
      min: d[0],
    };
  }
  return out;
});
for (const [k, r] of Object.entries(res))
  console.log(
    `  ${k.padEnd(22)} n ${String(r.n).padStart(5)}  below the surface ${(r.below * 100).toFixed(1).padStart(5)} %  under 1 cm over it ${(r.under1cm * 100).toFixed(1).padStart(5)} %  height p5 ${(r.p5 * 100).toFixed(1)} cm, median ${(r.p50 * 100).toFixed(1)} cm, min ${(r.min * 100).toFixed(1)} cm`,
  );
await browser.close();
