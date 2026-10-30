#!/usr/bin/env node
/**
 * Graphics comparison shots: the same views for every run, so before/after changes to the sky, trees, grass and
 * colours can be compared side by side. Phone-sized viewport and the app's presets by default (?app=1).
 *
 *   node tools/e2e/graphicsshots.mjs --tag before [--quality ultra] [--time midday] [--weather clear] [--track nurburgring_gp]
 *       [--desktop] [--points 300,1200,2500,3600]
 *
 * Writes tools/e2e/out/graphics/<tag>_<quality>_<time>.jpg (a contact sheet) and one PNG per view.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'graphics');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const TAG = opt('tag', 'shot');
const QUALITY = opt('quality', 'ultra');
const TIME = opt('time', 'midday');
const WEATHER = opt('weather', 'clear');
const TRACK = opt('track', '');
const APP = !args.includes('--desktop');
const POINTS = opt('points', '300,1250,2500,3650').split(',').map(Number);
// a 20:9 phone in landscape (CSS pixels) or a desktop window
const [W, H] = APP ? [915, 412] : [1280, 720];
const SCALE = APP ? 2 : 1;

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300));
});
await page.addInitScript(
  ([q]) => {
    localStorage.setItem('apexghost.noAudio', '1');
    localStorage.setItem('apexghost.app.init.v1', '1');
    localStorage.setItem(
      'apexghost.settings.v1',
      JSON.stringify({
        nickname: 'Shots',
        quality: q,
        qualityAuto: false,
        language: 'en',
        showPerf: false,
        dynamicResolution: false,
        resolutionScale: 1,
        racingLine: 'off',
        ghost: false,
      }),
    );
  },
  [QUALITY],
);
await page.goto(`${URL}/?app=${APP ? 1 : 0}`);
await page.click('button:has-text("Create room")');
await page.waitForSelector('.lb-steps');
await page.waitForTimeout(800);
if (TRACK) await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['trackId', TRACK]);
// each choice goes through the room and re-renders the lobby: wait for it before the next one
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['weather', WEATHER]);
await page.waitForTimeout(600);
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['time', TIME]);
await page.waitForTimeout(600);
await page.click('.lb-step >> nth=4');
await page.click('.car-card >> nth=16');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);
await page.addStyleTag({ content: '.race-ui,.touch-controls,.tc-root,.perf,[class*="touch"],[class*="perf"]{display:none!important}' });

if (args.includes('--no-ao') || args.includes('--no-post'))
  await page.evaluate((post) => {
    const g = window.__apex.gfx;
    g.quality.ao = false;
    if (post) g.quality.bloom = false;
    g.rebuildPipeline();
  }, args.includes('--no-post'));
if (args.includes('--tree-stats'))
  console.log(
    'tree chunks',
    JSON.stringify(
      await page.evaluate(() => {
        const t = window.__apex.session.track;
        const out = [];
        for (const c of t.chunks)
          if (c.kind === 'trees') {
            const meshes = [];
            c.object.traverse((o) => {
              if (o.isMesh) {
                const g = o.geometry;
                meshes.push({
                  name: o.name,
                  mat: [o.material]
                    .flat()
                    .map((m) => m.name)
                    .join('|'),
                  v: g.getAttribute('position').count,
                  i: g.index?.count ?? 0,
                  attrs: Object.keys(g.attributes).join(','),
                });
              }
            });
            out.push({ node: c.object.name, r: Math.round(c.radius), meshes: meshes.slice(0, 6), n: meshes.length });
          }
        return out.slice(0, 12).concat([{ total: out.length }]);
      }),
    ),
  );
const shots = [];
const snap = async (name) => {
  await page.waitForTimeout(900);
  const png = await page.screenshot();
  const info = await page.evaluate(() => {
    const r = window.__apex.gfx.renderer.info.render;
    return `${r.calls} calls, ${(r.triangles / 1e6).toFixed(2)} M tris`;
  });
  const fi = await page.evaluate(() => {
    const f = window.__apex.session.track.forest;
    if (!f) return '';
    return f.near.map((m, k) => `${k}:${m.count}x${(m.geometry.index.count / 3) | 0}${m.castShadow ? 's' : ''}/far ${f.far[k].count}`).join(' ');
  });
  console.log(`  ${name}: ${info} | ${fi}`);
  writeFileSync(path.join(out, `${TAG}_${QUALITY}_${TIME}_${name}.png`), png);
  shots.push({ name, png });
};
console.log(
  'conditions',
  await page.evaluate(() => {
    const s = window.__apex.session;
    return { hour: s.weather.hour, clouds: s.weather.clouds, fog: s.weather.fog, rain: s.weather.rain, sunEl: s.env.sunElevation, night: s.env.night };
  }),
);
await snap('cockpit');

/** Camera at lap distance s; mode: driver (eye line), verge (low, beside the road, looking along it), air. */
const place = (s, mode) =>
  page.evaluate(
    ([s, mode]) => {
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
      const cam = (window.__shotCam ??= new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 12000));
      const ray = new THREE.Raycaster(new THREE.Vector3(cl[i * 3], cl[i * 3 + 1] + 3, cl[i * 3 + 2]), new THREE.Vector3(0, -1, 0), 0, 8);
      const hit = ray.intersectObject(session.track.root, true)[0];
      const gy = hit ? hit.point.y : cl[i * 3 + 1];
      const x = cl[i * 3];
      const z = cl[i * 3 + 2];
      let info = null;
      if (mode === 'forest' || mode === 'grass') {
        // forest: the tree nearest to this point of the lap, seen from the road; grass: low over the verge
        const f = session.track.forest;
        if (mode === 'forest' && f) {
          // along the next 800 m of lap, the road point with a tree 14–40 m away; look at it from the road
          let best = null;
          for (let a = i; a < Math.min(m, i + 800); a += 4) {
            const ax = cl[a * 3];
            const az = cl[a * 3 + 2];
            for (let k = 0; k < f.x.length; k++) {
              const ddx = f.x[k] - ax;
              const ddz = f.z[k] - az;
              if (Math.abs(ddx) > 70 || Math.abs(ddz) > 70) continue;
              const d = Math.hypot(ddx, ddz);
              if (d > 16 && d < 70 && (!best || d < best.d)) best = { a, k, d };
            }
            if (best && best.d < 30) break;
          }
          if (best) {
            const ax = cl[best.a * 3];
            const az = cl[best.a * 3 + 2];
            const ray2 = new THREE.Raycaster(new THREE.Vector3(ax, cl[best.a * 3 + 1] + 3, az), new THREE.Vector3(0, -1, 0), 0, 8);
            const h2 = ray2.intersectObject(session.track.root, true)[0];
            const ay = h2 ? h2.point.y : cl[best.a * 3 + 1];
            cam.position.set(ax, ay + 1.3, az);
            cam.lookAt(f.x[best.k], f.y[best.k] + 6, f.z[best.k]);
            info = { tree: Math.round(best.d), at: Math.round(td.cumS[best.a]) };
          }
        }
        const gq = info ? null : session.track.groundQuery(session.world);
        const hitG = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: '' };
        for (const side of gq ? [1, -1] : [])
          for (let off = 2; off < 9 && !info; off += 0.5) {
            const e = (side > 0 ? td.widthL[i] : td.widthR[i]) + off;
            const gx = x + fz * e * side;
            const gz = z - fx * e * side;
            if (gq.cast(gx, gy + 5, gz, 0, -1, 0, 12, hitG) && hitG.surface === 'grass') {
              cam.position.set(gx, hitG.py + 0.55, gz);
              cam.lookAt(gx + fx * 12 + fz * side * 1.5, hitG.py, gz + fz * 12 - fx * side * 1.5);
              info = { shells: session.shells?.cells.filter((c) => c.mesh.visible).length ?? -1 };
            }
          }
        if (!info) {
          cam.position.set(x, gy + 1.1, z);
          cam.lookAt(x + fx * 60, gy - 1, z + fz * 60);
        }
      } else if (mode === 'driver') {
        cam.position.set(x, gy + 1.1, z);
        cam.lookAt(x + fx * 60, gy - 1, z + fz * 60);
      } else if (mode === 'verge') {
        const off = (td.widthL[i] ?? 6) + 2.5;
        cam.position.set(x + fz * off, gy + 1.0, z - fx * off);
        cam.lookAt(x + fz * (off + 4) + fx * 25, gy + 0.2, z - fx * (off + 4) + fz * 25);
      } else {
        cam.position.set(x - fx * 70, gy + 55, z - fz * 70);
        cam.lookAt(x + fx * 40, gy, z + fz * 40);
      }
      cam.aspect = window.innerWidth / window.innerHeight;
      cam.updateProjectionMatrix();
      gfx.setCamera(cam);
      window.__refill(cam.position, gfx.quality);
      return info;
    },
    [s, mode],
  );
// the session drives the camera every frame: freeze it on ours
// and the trees/grass are refilled around the car every frame: refill them around our camera instead
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
for (const s of POINTS) {
  await place(s, 'driver');
  await snap(`driver_${s}`);
}
for (const s of [POINTS[2], POINTS[3]]) {
  const r = await place(s, 'forest');
  console.log('forest view', s, r);
  await snap(`forest_${s}`);
  if (args.includes('--debug-forest')) {
    for (const hide of ['far', 'near']) {
      await page.evaluate((hide) => {
        const f = window.__apex.session.track.forest;
        for (const m of f.near) m.visible = hide !== 'near' && m.count > 0;
        for (const m of f.far) m.visible = hide !== 'far' && m.count > 0;
      }, hide);
      await snap(`forest_${s}_no${hide}`);
    }
    await page.evaluate(() => {
      const f = window.__apex.session.track.forest;
      for (const m of [...f.near, ...f.far]) m.visible = m.count > 0;
    });
  }
}
for (const s of [POINTS[0], POINTS[3]]) {
  const r = await place(s, 'grass');
  console.log('grass view', s, r);
  await snap(`grass_${s}`);
  if (args.includes('--debug-grass')) {
    await page.evaluate(() => (window.__apex.session.grass.mesh.visible = false));
    await snap(`grass_${s}_hidden`);
    await page.evaluate(() => {
      const { session, THREE } = window.__apex;
      const g = session.grass.mesh;
      g.visible = true;
      window.__gm = g.material;
      g.material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    });
    await snap(`grass_${s}_red`);
    await page.evaluate(() => {
      const g = window.__apex.session.grass.mesh;
      g.material = window.__gm;
      window.__gc = g.count;
      g.count = 1;
    });
    await snap(`grass_${s}_one`);
    await page.evaluate(() => {
      const g = window.__apex.session.grass.mesh;
      g.count = window.__gc;
    });
  }
}
await place(POINTS[2], 'air');
await snap('air');
if (args.includes('--debug-atlas')) {
  await page.evaluate(() => {
    const { session, THREE } = window.__apex;
    const cam = window.__shotCam;
    const tex = session.grass.mesh.material.map;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
    m.renderOrder = 5000;
    cam.add(m);
    m.position.set(0, 0, -2.2);
    session.scene.add(cam);
    console.log('atlas', tex.image?.width, tex.image?.height, session.grass.mesh.count, JSON.stringify(session.grass.size));
  });
  await snap('atlas');
}
if (args.includes('--pit')) {
  // the painted pit boxes, from above and at eye height
  for (const [name, up, back] of [
    ['pit_above', 9, 14],
    ['pit_low', 1.2, 10],
  ]) {
    await page.evaluate(
      ([up, back]) => {
        const { session, gfx } = window.__apex;
        const pl = session.trackData.pitLane;
        const i = Math.floor((pl.boxFrom + pl.boxTo) / 2);
        const p = pl.points[i];
        const q = pl.points[Math.min(pl.points.length - 1, i + 6)];
        const dx = q[0] - p[0];
        const dz = q[2] - p[2];
        const l = Math.hypot(dx, dz) || 1;
        const cam = window.__shotCam;
        cam.position.set(p[0] - (dx / l) * back, p[1] + up, p[2] - (dz / l) * back);
        cam.lookAt(p[0] + (dx / l) * 6, p[1], p[2] + (dz / l) * 6);
        gfx.setCamera(cam);
        window.__refill(cam.position, gfx.quality);
      },
      [up, back],
    );
    await snap(name);
  }
}
const fps = await page.evaluate(
  () =>
    new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => (++n < 90 ? requestAnimationFrame(f) : res(Math.round((n * 1000) / (performance.now() - t0))));
      requestAnimationFrame(f);
    }),
);
console.log(`fps (desktop GPU, ${QUALITY}): ${fps}`);
const info = await page.evaluate(() => {
  const r = window.__apex.gfx.renderer.info.render;
  return { calls: r.calls, triangles: r.triangles };
});
console.log('last frame', info);

const tw = 640;
const th = Math.round((tw * H) / W);
const cols = 2;
const rows = Math.ceil(shots.length / cols);
const tiles = await Promise.all(
  shots.map(async (s) => ({
    input: await sharp(s.png)
      .resize(tw, th)
      .composite([
        {
          input: Buffer.from(
            `<svg width="${tw}" height="22"><rect width="${tw}" height="22" fill="#000a"/><text x="6" y="16" font-size="14" fill="#ff0" font-family="sans-serif">${TAG} ${QUALITY} ${TIME} ${s.name}</text></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .toBuffer(),
  })),
);
const file = path.join(out, `${TAG}_${QUALITY}_${TIME}.jpg`);
await sharp({ create: { width: tw * cols, height: th * rows, channels: 3, background: '#000' } })
  .composite(tiles.map((t, k) => ({ ...t, left: (k % cols) * tw, top: Math.floor(k / cols) * th })))
  .jpeg({ quality: 85 })
  .toFile(file);
console.log(file);
await browser.close();
