#!/usr/bin/env node
/**
 * Pit stop check, solo/offline: your car is put in its box, a set of tyres is ordered from the pit menu, and the stop
 * runs with the crew. It logs when each sound plays (wheel guns, jacks) and when each tyre is fitted, which must be
 * spread over the stop (they all used to change at the end, the guns on a timer of their own), and takes pictures
 * from beside the box (tools/e2e/out/pitcrew/).
 *
 *   CHROME=/path/to/chrome node tools/e2e/pitcrew.mjs [--url http://127.0.0.1:5173] [--quality high] [--track zandvoort]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'pitcrew');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const QUALITY = opt('quality', 'high');
const TRACK = opt('track', '');

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e)));
await page.addInitScript((q) => {
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Crew', quality: q, qualityAuto: false, language: 'en', dynamicResolution: false }));
}, QUALITY);
await page.goto(URL);
await page.waitForSelector('.menu');
await page.waitForTimeout(1500);
await page.click('button.solo');
await page.waitForSelector('.lb-steps', { timeout: 30_000 });
if (TRACK) await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['trackId', TRACK]);
await page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['weather', 'clear']);
await page.click('.lb-step >> nth=4');
await page.click('.car-card >> nth=0');
await page.click('button.add-bot');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.keyboard.press('Enter');
await page.waitForFunction(
  () => {
    const s = window.__apex?.session;
    return s && s.startAt !== null && s.conn.serverNow() > s.startAt + 800;
  },
  null,
  { timeout: 60_000 },
);

// into my box, stopped, and the lap logic told we came down the lane
await page.evaluate(() => {
  const s = window.__apex.session;
  const i = s.crewOf.get(s.me);
  const c = s.crewCentre[i];
  const pts = s.trackData.pitLane.points;
  let best = 0;
  for (let k = 0; k < pts.length; k++) if ((pts[k][0] - c.x) ** 2 + (pts[k][2] - c.z) ** 2 < (pts[best][0] - c.x) ** 2 + (pts[best][2] - c.z) ** 2) best = k;
  const a = pts[Math.max(0, best - 1)];
  const b = pts[Math.min(pts.length - 1, best + 1)];
  s.vehicle.place(c.x, c.y + 0.3, c.z, Math.atan2(b[0] - a[0], b[2] - a[2]));
  s.pit.inLane = true;
  s.pit.index = best;
  window.__events = [];
  const t0 = () => (s.service ? (performance.now() - s.service.start) / 1000 : -1);
  const ev = s.stopEvent.bind(s);
  s.stopEvent = (e, v, plan, audible) => {
    window.__events.push(
      `${t0().toFixed(1)}s ${e.kind}${e.kind.startsWith('wheel') || e.kind.startsWith('gun') ? ' ' + ['FL', 'FR', 'RL', 'RR'][e.wheel] : ''}`,
    );
    ev(e, v, plan, audible);
  };
});
await page
  .waitForFunction(() => !!window.__apex.session.pitMenu, null, { timeout: 20_000 })
  .catch(async () => {
    console.log(
      '  no pit menu:',
      await page.evaluate(() => {
        const s = window.__apex.session;
        const p = s.pit;
        const pts = p.lane.points;
        const q = pts[p.index];
        const [ax, az] = p.awayAt(p.index);
        const across = (s.currPos.x - q[0]) * ax + (s.currPos.z - q[2]) * az;
        return JSON.stringify({
          inLane: p.inLane,
          index: p.index,
          boxFrom: p.lane.boxFrom,
          boxTo: p.lane.boxTo,
          across,
          shift: p.shiftAt(p.index),
          speed: s.vehicle.telemetry.speed,
          hold: s.pitHold,
        });
      }),
    );
  });
await page.waitForTimeout(800);
// a set of softs, then go
// (the first button keeps the tyres on the car)
await page.click('button.pit-tyre >> nth=1').catch(() => console.log('  no tyre button'));
await page.waitForTimeout(300);
await page.click('button:has-text("Start service")');
const startedAt = Date.now();
console.log(
  '  after start:',
  await page.evaluate(() => {
    const s = window.__apex.session;
    return JSON.stringify({ service: !!s.service, events: s.service?.events.length, plan: s.service?.plan, menu: !!s.pitMenu, hold: s.pitHold });
  }),
);
// a camera beside the box, looking at the car from the lane
const cam = () =>
  page.evaluate(() => {
    const { session: s, gfx, THREE } = window.__apex;
    const o = s.myVisual.object;
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
    // from the fast-lane side of the box (the garage is on the other side), a little ahead of the car
    const [ax, az] = s.pit.awayAt(s.pit.index);
    const c = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.05, 2000);
    c.position
      .copy(o.position)
      .add(new THREE.Vector3(-ax * 6.5, 2.4, -az * 6.5))
      .addScaledVector(f, 3);
    c.lookAt(o.position.x, o.position.y + 0.4, o.position.z);
    gfx.setCamera(c);
  });
await page.addStyleTag({ content: '.perf, .race-ui > *:not(.pit-menu) { opacity: 0.35; }' });
for (const at of [1.5, 4, 6.5, 9.5, 12.5, 15]) {
  await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - startedAt)));
  await cam();
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(out, `stop-${String(at).replace('.', '_')}s.png`) });
}
await page.waitForTimeout(6000);
const events = await page.evaluate(() => window.__events);
console.log('  the stop, as it happened:');
for (const e of events) console.log(`    ${e}`);
const fits = events.filter((e) => e.includes('wheelOn')).map((e) => parseFloat(e));
const spread = fits.length === 4 ? Math.max(...fits) - Math.min(...fits) : 0;
await browser.close();
const ok = fits.length === 4 && spread > 3 && events.filter((e) => e.includes('gun')).length === 8;
console.log(ok ? `  OK: four tyres fitted ${spread.toFixed(1)} s apart from first to last, eight wheel-gun sounds with them` : '  FAILED');
process.exit(ok ? 0 : 1);
