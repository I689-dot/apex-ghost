#!/usr/bin/env node
/**
 * Cockpit camera lab: for each car, one solo race (clear midday, real GPU), then the cockpit view from several
 * eye positions side by side, so a default can be chosen by eye. HUD hidden. Prints where the steering wheel is
 * (from the model's `steering_wheel` node) and the headroom above each eye.
 *
 *   node tools/e2e/cockpitlab.mjs [--url http://127.0.0.1:5173] [--cars 0,3,16] [--plan plan.json] [--fov 72]
 *
 * plan.json: { "<car id>": [["label", x, y, z], …] } in car space (m: +X left, +Y up, +Z forward, origin at
 * mid-wheelbase on the ground). Without a plan: the current default plus positions measured from the wheel.
 * Output: tools/e2e/out/cockpitlab/<index>-<id>.png (a sheet of the views) and lab.json (measurements).
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'cockpitlab');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const cars = JSON.parse(readFileSync(path.join(here, '../../apps/client/public/assets/cars.json'), 'utf8')).cars;
const list = opt('cars', cars.map((_, i) => i).join(','))
  .split(',')
  .map(Number);
const planFile = opt('plan', '');
const plan = planFile && existsSync(planFile) ? JSON.parse(readFileSync(planFile, 'utf8')) : {};
const FOV = Number(opt('fov', '72'));
const W = 960;
const H = 540;
const labPath = path.join(out, 'lab.json');
const lab = existsSync(labPath) ? JSON.parse(readFileSync(labPath, 'utf8')) : {};

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const i of list) {
  const car = cars[i];
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.addInitScript((fov) => {
    localStorage.setItem('apexghost.noAudio', '1');
    localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Lab', quality: 'medium', qualityAuto: false, dynamicResolution: false, fov }));
    localStorage.setItem('apexghost.devWeatherSeed', '1');
  }, FOV);
  try {
    await page.goto(URL);
    await page.click('button:has-text("Create room")');
    await page.waitForSelector('.car-card');
    await page.click(`.car-card >> nth=${i}`);
    await page.waitForTimeout(600);
    await page.click('.lobby-actions button:has-text("Ready")');
    await page.waitForTimeout(400);
    await page.click('button:has-text("Start race")');
    await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {}); // briefing
    await page.waitForSelector('.race-ui', { timeout: 180_000 });
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(6000);
    // measurements in car space
    const m = await page.evaluate(() => {
      const { session: s, THREE } = window.__apex;
      const car = s.myVisual.object;
      car.updateMatrixWorld(true);
      const inv = car.matrixWorld.clone().invert();
      const cp = s.cockpit;
      const sw = car.getObjectByName('steering_wheel') ?? car.getObjectByName('steering_pivot');
      let wheel = null;
      if (sw) {
        const b = new THREE.Box3().setFromObject(sw);
        const c = b.getCenter(new THREE.Vector3()).applyMatrix4(inv);
        const sz = b.getSize(new THREE.Vector3());
        wheel = { c: [c.x, c.y, c.z].map((v) => +v.toFixed(3)), size: [sz.x, sz.y, sz.z].map((v) => +v.toFixed(3)) };
      }
      return {
        eye: [cp.eye.x, cp.eye.y, cp.eye.z].map((v) => +v.toFixed(3)),
        autoRaise: +cp.autoRaise.toFixed(3),
        wheel,
        dims: s.myVisual.entry?.dims ?? null,
      };
    });
    // headroom (ray up) and the clearance to the sides and behind, for an eye
    const probe = (e) =>
      page.evaluate((e) => {
        const { session: s, THREE } = window.__apex;
        const car = s.myVisual.object;
        const meshes = [];
        car.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          if (mats.every((x) => x.transparent)) return;
          meshes.push(o);
        });
        const ray = new THREE.Raycaster();
        const org = new THREE.Vector3(...e).applyMatrix4(car.matrixWorld);
        const cast = (d, far) => {
          ray.set(org, new THREE.Vector3(...d).transformDirection(car.matrixWorld));
          ray.far = far;
          const h = ray.intersectObjects(meshes, false)[0];
          return h ? +h.distance.toFixed(3) : null;
        };
        return { up: cast([0, 1, 0], 1), left: cast([1, 0, 0], 1.5), right: cast([-1, 0, 0], 2), back: cast([0, 0, -1], 1.5) };
      }, e);
    const views = [['current', m.eye[0], m.eye[1] + m.autoRaise, m.eye[2]]];
    if (plan[car.id]) views.push(...plan[car.id]);
    else if (m.wheel) {
      const [wx, wy, wz] = m.wheel.c;
      views.push(['wheel -0.62 +0.30', wx, wy + 0.3, wz - 0.62]);
      views.push(['wheel -0.62 +0.35', wx, wy + 0.35, wz - 0.62]);
      views.push(['wheel -0.70 +0.32', wx, wy + 0.32, wz - 0.7]);
      views.push(['wheel -0.55 +0.30', wx, wy + 0.3, wz - 0.55]);
      views.push(['wheel -0.62 +0.25', wx, wy + 0.25, wz - 0.62]);
    }
    await page.addStyleTag({ content: '.race-ui{display:none!important}' });
    const tiles = [];
    const probes = [];
    for (const [label, x, y, z] of views) {
      await page.evaluate(
        ([x, y, z]) => {
          const cp = window.__apex.session.cockpit;
          cp.eye.set(x, y, z);
          cp.autoRaise = 0;
          cp.applySeat();
        },
        [x, y, z],
      );
      await page.waitForTimeout(500);
      const buf = await page.screenshot({ timeout: 60_000 });
      const p = await probe([x, y, z]);
      probes.push({ label, eye: [x, y, z].map((v) => +v.toFixed(3)), ...p });
      const svg = Buffer.from(
        `<svg width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="34" fill="black" opacity="0.65"/><text x="10" y="24" font-size="20" font-family="sans-serif" fill="yellow">${label}: ${[x, y, z].map((v) => v.toFixed(2)).join(', ')}  head ${p.up ?? '-'}</text></svg>`,
      );
      tiles.push(
        await sharp(buf)
          .composite([{ input: svg }])
          .png()
          .toBuffer(),
      );
    }
    const cols = 2;
    const rows = Math.ceil(tiles.length / cols);
    const sheet = sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: '#000' } }).composite(
      tiles.map((t, k) => ({ input: t, left: (k % cols) * W, top: Math.floor(k / cols) * H })),
    );
    const file = path.join(out, `${String(i).padStart(2, '0')}-${car.id}.png`);
    await sheet.png().toFile(file);
    lab[car.id] = { index: i, ...m, probes };
    writeFileSync(labPath, JSON.stringify(lab, null, 1));
    console.log(`  ${i} ${car.id}: wheel ${JSON.stringify(m.wheel)} eye ${JSON.stringify(m.eye)} autoRaise ${m.autoRaise}`);
  } catch (e) {
    console.log(`  ${i} ${car.id} FAILED: ${String(e).split('\n')[0]}`);
  }
  await page.close();
}
await browser.close();
