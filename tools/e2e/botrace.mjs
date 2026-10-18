#!/usr/bin/env node
/**
 * AI traffic in a real browser session: create a room, add bots, start, and watch them for a few minutes while your
 * own car stays parked in its grid box (the worst case for the bots leaving the grid). Every 200 ms it samples
 * every bot through window.__apex and reports, per bot:
 *   laps, best and last lap, resets (teleports), spins (body slip over 20°), track-limit offs, wall damage;
 * and overall: the launch (vertical speed and heave of every car in its first 6 s), and how often two cars overlap
 * (bodies intersecting: within 4.4 m along and 2.0 m across, one of them moving: cars are ghosts, so that is them driving through each
 * other). Screenshots go to tools/e2e/out/botrace/.
 *
 *   node tools/e2e/botrace.mjs [--url http://127.0.0.1:5173] [--bots 7] [--minutes 3] [--weather heavy_rain]
 *       [--gpu] [--quality medium] [--drive]   (--drive: hold throttle instead of staying parked)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'botrace');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const BOTS = Number(opt('bots', '7'));
const MINUTES = Number(opt('minutes', '3'));
const WEATHER = opt('weather', '');
const GPU = args.includes('--gpu');
const QUALITY = opt('quality', 'low');
const DRIVE = args.includes('--drive');

const browser = await chromium.launch({
  args: GPU
    ? ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript((q) => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({ nickname: 'BotWatch', quality: q, qualityAuto: false, showPerf: true, dynamicResolution: false }),
  );
  localStorage.removeItem('apexghost.devWeatherSeed');
}, QUALITY);
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`), timeout: 120_000 });

await page.goto(URL);
await page.click('button.primary:has-text("Create room")');
await page.waitForSelector('.car-card', { timeout: 30_000 });
await page.waitForTimeout(1500);
if (WEATHER) {
  await page.selectOption('.prep .prep-row:nth-of-type(2) select', WEATHER);
  await page.waitForTimeout(500);
}
await page.click('.car-card >> nth=16');
await page.waitForTimeout(800);
for (let i = 0; i < BOTS; i++) {
  await page.click('button.add-bot');
  await page.waitForTimeout(300);
}
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(500);
await page.click('button:has-text("Start race")');
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.waitForTimeout(1500);
await page.keyboard.press('Enter'); // skip the intro
console.log(`▶ ${BOTS} bots, ${MINUTES} min${WEATHER ? `, ${WEATHER}` : ''}${DRIVE ? ', driving' : ', parked on the grid'}`);

// sampler inside the page: every 200 ms, until stopped
await page.evaluate(() => {
  const w = window;
  const s = w.__apex.session;
  const st = { t0: null, bots: {}, overlaps: 0, overlapPairs: {}, samples: 0, info: {} };
  w.__botrace = st;
  const names = (id) => s.names?.get?.(id) ?? id;
  const tick = () => {
    const now = s.conn.serverNow();
    const raceT = s.startAt === null ? -1 : now - s.startAt;
    if (raceT >= 0) {
      st.samples++;
      const cars = [];
      for (const r of s.remotes.values()) {
        if (!r.bot) continue;
        const v = r.bot.vehicle;
        const p = v.body.translation();
        const lv = v.body.linvel();
        let b = st.bots[r.id];
        if (!b) {
          b = st.bots[r.id] = {
            name: names(r.id),
            car: r.entry.id,
            slot: r.slot,
            resets: 0,
            spins: 0,
            spinning: false,
            offs: 0,
            wasOff: false,
            maxVy: 0,
            launchT: null,
            prev: null,
            stuckS: 0,
            damage: 0,
          };
        }
        const moving = v.telemetry.speed > 1;
        if (moving && b.launchT === null) b.launchT = raceT;
        if (b.launchT !== null && raceT - b.launchT < 6000) b.maxVy = Math.max(b.maxVy, Math.abs(lv.y));
        if (b.prev && Math.hypot(p.x - b.prev.x, p.z - b.prev.z) > 25) b.resets++;
        b.prev = { x: p.x, y: p.y, z: p.z };
        const sl = Math.abs(v.telemetry.slipBody);
        if (!b.spinning && sl > 0.35 && v.telemetry.speed > 6) {
          b.spins++;
          b.spinning = true;
          const tr0 = s.localTracker?.players.get(r.id);
          (b.events ??= []).push(`spin ${Math.round(tr0?.progressS ?? 0)} m ${Math.round(v.telemetry.speed * 3.6)} km/h wet ${s.weather.wetness.toFixed(2)}`);
        } else if (sl < 0.1) b.spinning = false;
        if (r.bot.limits.offTrack && !b.wasOff) {
          b.offs++;
          (b.events ??= []).push(`off ${Math.round(s.localTracker?.players.get(r.id)?.progressS ?? 0)} m`);
        }
        b.wasOff = r.bot.limits.offTrack;
        b.damage = Math.max(...r.damage.zones);
        if (b.launchT !== null && v.telemetry.speed < 1) b.stuckS += 0.2;
        const tr = s.localTracker?.players.get(r.id);
        b.laps = tr?.laps ?? 0;
        b.best = tr?.bestLapMs ?? null;
        b.last = tr?.lastLapMs ?? null;
        b.dist = Math.round(tr?.raceDist ?? 0);
        const q = v.body.rotation();
        cars.push({ id: r.id, x: p.x, z: p.z, moving, fx: 2 * (q.x * q.z + q.y * q.w), fz: 1 - 2 * (q.x * q.x + q.y * q.y) });
      }
      const me = s.vehicle.body.translation();
      const mq = s.vehicle.body.rotation();
      cars.push({
        id: 'me',
        x: me.x,
        z: me.z,
        moving: s.vehicle.telemetry.speed > 1,
        fx: 2 * (mq.x * mq.z + mq.y * mq.w),
        fz: 1 - 2 * (mq.x * mq.x + mq.y * mq.y),
      });
      for (let i = 0; i < cars.length; i++)
        for (let j = i + 1; j < cars.length; j++) {
          const a = cars[i];
          const c = cars[j];
          if (!a.moving && !c.moving) continue;
          // bodies intersect: within a car length along and a car width across (in a's frame)
          const dx = c.x - a.x;
          const dz = c.z - a.z;
          if (Math.abs(dx * a.fx + dz * a.fz) < 4.4 && Math.abs(dx * a.fz - dz * a.fx) < 2.0) {
            st.overlaps++;
            const k = [a.id, c.id].map((x) => (x === 'me' ? 'YOU' : names(x))).join('+');
            st.overlapPairs[k] = (st.overlapPairs[k] ?? 0) + 1;
          }
        }
    }
    if (!w.__botraceStop) setTimeout(tick, 200);
  };
  tick();
});

// wait for the green light, then watch
await page.waitForFunction(
  () => {
    const s = window.__apex.session;
    return s.startAt !== null && s.conn.serverNow() > s.startAt;
  },
  null,
  { timeout: 120_000, polling: 250 },
);
if (DRIVE) await page.keyboard.down('KeyW');
for (const [ms, name] of [
  [1500, '01-green'],
  [3000, '02-leaving-grid'],
  [6000, '03-leaving-grid'],
  [12000, '04-after-start'],
]) {
  await page.waitForTimeout(ms - (name === '01-green' ? 0 : 0));
  await shot(name);
}
console.log(
  `  weather: ${await page.evaluate(() => JSON.stringify({ kind: window.__apex.session.race.weather.kind, wet: +window.__apex.session.weather.wetness.toFixed(2) }))}`,
);
const totalMs = MINUTES * 60_000;
let waited = 22_500;
let k = 5;
while (waited < totalMs) {
  const step = Math.min(30_000, totalMs - waited);
  await page.waitForTimeout(step);
  waited += step;
  const st = await page.evaluate(() => {
    const b = Object.values(window.__botrace.bots);
    return b.map((x) => `${x.name} ${x.laps}L ${x.dist}m r${x.resets} s${x.spins} o${x.offs}`).join(' | ');
  });
  console.log(`  ${(waited / 1000).toFixed(0)} s: ${st}`);
  if (k <= 7) await shot(`0${k++}-t${(waited / 1000).toFixed(0)}`);
}
if (DRIVE) await page.keyboard.up('KeyW');
const res = await page.evaluate(() => {
  window.__botraceStop = true;
  return window.__botrace;
});
const fmt = (ms) => (ms === null || ms === undefined ? '—' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`);
console.log('bot              car                               slot laps best      last      resets spins offs damage launch|vy| stopped');
for (const b of Object.values(res.bots))
  console.log(
    `${b.name.padEnd(16)} ${b.car.padEnd(34)} ${String(b.slot).padStart(4)} ${String(b.laps).padStart(4)} ${fmt(b.best).padEnd(9)} ${fmt(b.last).padEnd(9)} ${String(b.resets).padStart(6)} ${String(b.spins).padStart(5)} ${String(b.offs).padStart(4)} ${b.damage.toFixed(2).padStart(6)} ${b.maxVy.toFixed(2).padStart(10)} ${b.stuckS.toFixed(1)} s`,
  );
for (const b of Object.values(res.bots)) if (b.events) console.log(`  ${b.name}: ${b.events.join(', ')}`);
console.log(`overlaps (two car bodies intersecting, one moving): ${res.overlaps} samples of ${res.samples}; ${JSON.stringify(res.overlapPairs)}`);
writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 1));
await browser.close();
const bad = errors.filter((e) => !/favicon|net::ERR/i.test(e));
if (bad.length) console.log(`console errors:\n  ${bad.slice(0, 10).join('\n  ')}`);
