#!/usr/bin/env node
/**
 * Close-up shots of chosen places: a session on one track, the camera put at lap distance s, sideways offset and
 * height, looking along / across the track. For checking grass, grandstand bases, the pit lane, textures.
 *
 *   node tools/e2e/spots.mjs --tag grass [--quality high] [--track nurburgring_gp] \
 *     --spot "name:s:side:offset:height:yawDeg:pitchDeg" [--spot ...]
 *
 * side +1 = left of the racing direction, -1 = right; offset from the centreline (m); yaw 0 = along the track,
 * 90 = towards the side given. Writes tools/e2e/out/spots/<tag>_<name>.png.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'spots');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const TAG = opt('tag', 'spot');
const QUALITY = opt('quality', 'high');
const TRACK = opt('track', '');
const GFX = JSON.parse(opt('graphics', '{}'));
const spots = args
  .flatMap((a, i) => (a === '--spot' ? [args[i + 1]] : []))
  .map((s) => {
    const [name, ...n] = s.split(':');
    const [ls, side, offset, height, yaw, pitch] = n.map(Number);
    return { name, s: ls, side, offset, height, yaw, pitch };
  });

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.addInitScript(
  ([q, g, rl]) => {
    localStorage.setItem('apexghost.noAudio', '1');
    localStorage.setItem(
      'apexghost.settings.v1',
      JSON.stringify({
        nickname: 'Spots',
        quality: q,
        qualityAuto: false,
        graphics: g,
        language: 'en',
        dynamicResolution: false,
        racingLine: rl,
        ghost: false,
        mirror: false,
      }),
    );
    localStorage.setItem('apexghost.devWeatherSeed', '1');
  },
  [QUALITY, GFX, opt('racing-line', 'off')],
);
await page.goto(URL);
await page.click('button:has-text("Play solo")');
await page.waitForSelector('.lb-steps', { timeout: 60_000 });
await page.waitForTimeout(800);
if (TRACK) await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['trackId', TRACK]);
await page.waitForTimeout(600);
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['weather', 'clear']).catch(() => {});
await page.waitForTimeout(400);
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['time', 'midday']).catch(() => {});
await page.waitForTimeout(400);
await page.click('.lb-step >> nth=4');
await page.click('.car-card >> nth=0');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);
await page.addStyleTag({ content: '.race-ui,.hud,.perf{display:none!important}' });
await page.evaluate(() => {
  const s = window.__apex.session;
  s.driveCamera = () => window.__shotCam ?? s.cockpit.camera;
  const vis = s.track.updateVisibility.bind(s.track);
  const shells = s.shells ? s.shells.update.bind(s.shells) : null;
  window.__refill = (pos, q) => {
    vis(pos, q);
    s.track.forest?.update(pos, q, true);
    shells?.(pos, q);
  };
  s.track.updateVisibility = () => {};
  if (s.shells) s.shells.update = () => {};
});
if (args.includes('--stands')) {
  // the grandstands: clusters of spectators, each as (lap distance, side, offset) of its lowest row
  const stands = await page.evaluate(() => {
    const { session, THREE } = window.__apex;
    const crowd = session.scene.getObjectByName('crowd');
    if (!crowd) return [];
    const td = session.trackData;
    const cl = td.centerline;
    const m4 = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const found = new Map();
    for (let k = 0; k < crowd.count; k += 7) {
      crowd.getMatrixAt(k, m4);
      p.setFromMatrixPosition(m4);
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < cl.length / 3; i++) {
        const d = (cl[i * 3] - p.x) ** 2 + (cl[i * 3 + 2] - p.z) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const key = Math.round(td.cumS[bi] / 150);
      const j = (bi + 3) % (cl.length / 3);
      const fx = cl[j * 3] - cl[bi * 3];
      const fz = cl[j * 3 + 2] - cl[bi * 3 + 2];
      const side = fz * (p.x - cl[bi * 3]) - fx * (p.z - cl[bi * 3 + 2]) > 0 ? 1 : -1;
      const h = p.y - cl[bi * 3 + 1];
      const e = found.get(key);
      if (!e || h < e.h) found.set(key, { s: Math.round(td.cumS[bi]), side, off: Math.round(Math.sqrt(bd)), h: +h.toFixed(1) });
    }
    return [...found.values()];
  });
  console.log('stands', JSON.stringify(stands));
  for (const st of stands) spots.push({ name: `stand_${st.s}`, s: st.s, side: st.side, offset: Math.max(6, st.off - 22), height: 1.2, yaw: 75, pitch: -4 });
}
// --line-speed <km/h>: the racing line coloured as for a car at this speed at the camera's spot
const LINE_KMH = Number(opt('line-speed', '0'));
for (const sp of spots) {
  sp.lineKmh = LINE_KMH;
  const info = await page.evaluate((sp) => {
    const { session, gfx, THREE } = window.__apex;
    const td = session.trackData;
    const cl = td.centerline;
    const m = cl.length / 3;
    let i = 0;
    while (i < m - 1 && td.cumS[i] < sp.s) i++;
    const j = (i + 3) % m;
    const yaw = Math.atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // left of the direction of travel: (fz, -fx)
    const x = cl[i * 3] + fz * sp.offset * sp.side;
    const z = cl[i * 3 + 2] - fx * sp.offset * sp.side;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, cl[i * 3 + 1] + 30, z), new THREE.Vector3(0, -1, 0), 0, 60);
    const hit = ray.intersectObject(session.track.root, true).find((h) => h.object.visible);
    const gy = hit ? hit.point.y : cl[i * 3 + 1];
    const cam = (window.__shotCam ??= new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 12000));
    cam.position.set(x, gy + sp.height, z);
    const a = yaw + ((sp.yaw * Math.PI) / 180) * sp.side;
    const p = (sp.pitch * Math.PI) / 180;
    cam.lookAt(x + Math.sin(a) * Math.cos(p) * 20, gy + sp.height + Math.sin(p) * 20, z + Math.cos(a) * Math.cos(p) * 20);
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
    gfx.setCamera(cam);
    window.__refill(cam.position, gfx.quality);
    if (sp.lineKmh && session.racingLine) {
      session.racingLine.update(i, sp.lineKmh / 3.6);
      session.racingLine.update = () => {};
    }
    return { x: x.toFixed(1), y: gy.toFixed(2), z: z.toFixed(1), hit: hit?.object.name ?? '' };
  }, sp);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, `${TAG}_${sp.name}.png`) });
  console.log(sp.name, JSON.stringify(info));
}
await browser.close();
