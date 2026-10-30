#!/usr/bin/env node
/**
 * Safety car check, solo/offline with car contact and race control on: 1 min qualifying, then in the race the
 * safety car is sent out (the client's race-control state, as the server would: 250 m ahead of the leader). Every
 * 100 ms it records the safety car's heading against the way it moves, and every car's height over the road
 * (thrown into the air, or pushed under the map); screenshots from behind and above the safety car go to
 * tools/e2e/out/sc/. Fails (exit 1) when it drives backwards (its model's nose, judged from the screenshots too: the model can
 * be built back to front), a car leaves the road surface by more than 1.5 m, or it parks solid on the pit lane line.
 *
 *   CHROME=/path/to/chrome node tools/e2e/safetycar.mjs [--url http://127.0.0.1:5173] [--bots 7] [--track nurburgring_gp_2022]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'sc');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const BOTS = Number(opt('bots', '7'));

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({ nickname: 'SC', quality: 'low', qualityAuto: false, language: 'en', camera: 'chase', dynamicResolution: false }),
  );
});
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {});

await page.goto(URL);
await page.waitForSelector('.menu');
await page.waitForTimeout(2000);
await page.click('button.solo');
await page.waitForSelector('.car-card', { timeout: 30_000 });
await page.selectOption('.prep .prep-row:nth-of-type(2) select', 'clear');
for (const label of ['Car contact', 'Race control']) {
  await page.click(`.rules label:has-text("${label}") input`);
  await page.waitForTimeout(250);
}
await page.evaluate(() => {
  window.__app.conn.sendJson({ t: 'setSession', minutes: 1 });
  window.__app.conn.sendJson({ t: 'setRaceLaps', laps: 3 });
});
await page.click('.car-card >> nth=0');
for (let i = 0; i < BOTS; i++) {
  await page.click('button.add-bot');
  await page.waitForTimeout(200);
}
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 30_000 }).catch(() => {});

/** Your car driven by an AiDriver (the bots' class, from the session). */
const drive = () =>
  page.evaluate(() => {
    const s = window.__apex?.session;
    if (!s || s.__ai) return !!s?.__ai;
    const bot = [...s.remotes.values()].find((r) => r.bot);
    if (!bot) return false;
    const Ai = bot.bot.ai.constructor;
    const ai = new Ai(s.trackData, s.vehicle, 0.92, 0);
    s.__ai = ai;
    s.smoother.update = (dt) => ai.update(dt, s.startAt !== null && s.conn.serverNow() >= s.startAt, s.vehicle.weatherGrip * s.vehicle.tyreGripAvg);
    return true;
  });
await page.waitForSelector('.race-ui', { timeout: 180_000 });
await page.keyboard.press('Enter');
await drive();
await page.waitForSelector('.results', { timeout: 6 * 60_000 });
console.log('  qualifying done');
await page.waitForSelector('.race-ui', { timeout: 180_000 });
await page.keyboard.press('Enter');
for (let i = 0; i < 40 && !(await drive()); i++) await page.waitForTimeout(250);
// the race under way, the field spread a little
await page.waitForFunction(
  () => {
    const s = window.__apex?.session;
    return s && s.startAt && s.conn.serverNow() > s.startAt + 40_000;
  },
  null,
  { timeout: 180_000, polling: 1000 },
);

// sampler: heading vs motion, heights over the road
await page.evaluate(() => {
  const s = window.__apex.session;
  const st = { samples: 0, back: 0, worstDot: 1, high: 0, low: 0, maxUp: 0, maxDown: 0, who: [], scLast: null };
  window.__sc = st;
  const hit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
  const gq = s.track.groundQuery(s.world);
  const groundY = (x, y, z) => (gq.cast(x, y + 3, z, 0, -1, 0, 30, hit) ? hit.py : null);
  window.setInterval(() => {
    if (!s.sc?.visible) return;
    const o = s.sc.visual.object;
    const p = o.position;
    if (st.scLast) {
      const dx = p.x - st.scLast.x;
      const dz = p.z - st.scLast.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.5) {
        // the model's forward (+z) in the world
        const f = new window.__apex.THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
        const dot = (f.x * dx + f.z * dz) / (Math.hypot(f.x, f.z) * d);
        st.worstDot = Math.min(st.worstDot, dot);
        if (dot < 0) st.back++;
      }
    }
    st.scLast = { x: p.x, z: p.z };
    st.samples++;
    const cars = [{ id: 'me', p: s.currPos }];
    for (const r of s.remotes.values()) cars.push({ id: r.id, p: r.visual.object.position });
    for (const c of cars) {
      const g = groundY(c.p.x, c.p.y, c.p.z);
      if (g === null) {
        st.low++;
        st.who.push(`${c.id} no ground under it`);
        continue;
      }
      const h = c.p.y - g;
      st.maxUp = Math.max(st.maxUp, h);
      st.maxDown = Math.min(st.maxDown, h);
      if (h > 1.5) {
        st.high++;
        st.who.push(`${c.id} ${h.toFixed(1)} m up`);
      }
      if (h < -1.5) {
        st.low++;
        st.who.push(`${c.id} ${(-h).toFixed(1)} m under`);
      }
    }
  }, 100);
});

// send it out: 250 m ahead of the leader, as race control does
await page.evaluate(() => {
  const s = window.__apex.session;
  const lead = [...s.standings].sort((a, b) => b.raceDist - a.raceDist)[0];
  const now = s.conn.serverNow();
  s.rc = { ...s.rc, course: 'sc', since: now, limitAt: null, sc: { t0: now, s0: ((lead?.raceDist ?? 0) + 250) % s.trackData.length, inAt: null } };
});
for (let k = 0; k < 6; k++) {
  await page.waitForTimeout(5000);
  // camera behind and above the safety car, looking the way the track goes
  await page.evaluate(() => {
    const { session: s, gfx, THREE } = window.__apex;
    if (!s.sc?.visible) return;
    const cam = (window.__scCam ??= new THREE.PerspectiveCamera(55, 1280 / 720, 0.2, 3000));
    const pt = { x: 0, y: 0, z: 0, yaw: 0 };
    s.track.pointAt(s.sc.s, pt);
    const fx = Math.sin(pt.yaw);
    const fz = Math.cos(pt.yaw);
    cam.position.set(pt.x - fx * 14, pt.y + 6, pt.z - fz * 14);
    cam.lookAt(pt.x + fx * 10, pt.y, pt.z + fz * 10);
    gfx.setCamera(cam);
  });
  await page.waitForTimeout(300);
  await shot(`sc-${k}`);
}
// and bring it in: hidden again (parked at the pit exit)
await page.evaluate(() => {
  const s = window.__apex.session;
  s.rc = { ...s.rc, course: 'green', sc: null };
});
await page.waitForTimeout(4000);
const st = await page.evaluate(() => window.__sc);
// parked again at the pit exit: beside the lane line (the cars leaving the pits drive along it), not solid
const park = await page.evaluate(() => {
  const s = window.__apex.session;
  const p = s.sc.visual.object.position;
  const pts = s.trackData.pitLane?.points ?? [];
  const d = Math.min(...pts.map((q) => Math.hypot(q[0] - p.x, q[2] - p.z)));
  return { fromLane: d, solid: s.sc.solid, enabled: s.sc.body?.isEnabled() ?? null };
});
console.log(`  parked ${park.fromLane.toFixed(1)} m from the pit lane line; solid ${park.solid}, body enabled ${park.enabled}`);
await shot('parked');
console.log(`  safety car samples ${st.samples}: heading against the motion in ${st.back} (worst cos ${st.worstDot.toFixed(2)})`);
console.log(
  `  cars more than 1.5 m above the road: ${st.high}, under it / no ground: ${st.low}; extremes ${st.maxUp.toFixed(2)} m up, ${st.maxDown.toFixed(2)} m`,
);
if (st.who.length) console.log('  ', [...new Set(st.who)].slice(0, 12).join(' | '));
if (errors.length) console.log('  page errors:', errors.slice(0, 5).join(' | '));
await browser.close();
process.exit(st.back === 0 && st.high === 0 && st.low === 0 && park.fromLane > 2.5 && !park.enabled ? 0 : 1);
