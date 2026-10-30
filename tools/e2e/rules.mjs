#!/usr/bin/env node
/**
 * The host's rules in a real browser session, solo/offline: contact, the mandatory pit stop, fuel and race control
 * all on, a 1 min qualifying and a 3-lap race with bots. Your car is driven by the bots' AI (borrowed through the
 * dev hooks), makes its mandatory stop through the pit menu, and parks on the track for a while in the race so
 * race control has an incident: yellow flag, full-course yellow, then the safety car. Every 250 ms it samples:
 *   the course state and the safety car, the fastest car under the FCY speed limit, bots in the pit lane, stops and
 *   drive-throughs from the standings, fuel, and how often two cars' bodies overlap (contact rule: they should not);
 * prints a summary and the race results; screenshots go to tools/e2e/out/rules/.
 *
 *   node tools/e2e/rules.mjs [--url http://127.0.0.1:5173] [--bots 5] [--park-at 50] [--park-for 70]
 *   CHROME=/path/to/chrome node tools/e2e/rules.mjs   (a Chromium other than Playwright's own)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'rules');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const BOTS = Number(opt('bots', '5'));
const PARK_AT = Number(opt('park-at', '50'));
const PARK_FOR = Number(opt('park-for', '70'));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript(() => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({ nickname: 'Rules', quality: 'low', qualityAuto: false, language: 'en', camera: 'chase', dynamicResolution: false }),
  );
});
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`), timeout: 120_000 }).catch(() => {});

await page.goto(URL);
await page.waitForSelector('.menu');
await page.waitForTimeout(2500);
await page.click('button.solo');
await page.waitForSelector('.car-card', { timeout: 30_000 });
await page.selectOption('.prep .prep-row:nth-of-type(2) select', 'clear');
// the four rules, through the lobby's switches
for (const label of ['Car contact', 'Mandatory pit stop', 'Fuel and refuelling', 'Race control']) {
  await page.click(`.rules label:has-text("${label}") input`);
  await page.waitForTimeout(250);
}
await page.evaluate(() => {
  const c = window.__app.conn;
  c.sendJson({ t: 'setSession', minutes: 1 });
  c.sendJson({ t: 'setRaceLaps', laps: 3 });
});
await page.waitForTimeout(500);
await shot('1-lobby');
console.log('  rules:', (await page.evaluate(() => JSON.stringify(window.__app.room.rules))) ?? '?');
await page.click('.car-card >> nth=0');
for (let i = 0; i < BOTS; i++) {
  await page.click('button.add-bot');
  await page.waitForTimeout(250);
}
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(400);
await page.click('button:has-text("Start race")');
// briefing: fuel for the race, the advanced setup
await page.waitForSelector('.briefing', { timeout: 20_000 });
await page.click('.setup-details summary').catch(() => {});
await page.click('button:has-text("Fuel for the whole race")').catch(() => {});
await page.waitForTimeout(400);
await shot('2-briefing');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});

/** Your car driven by an AiDriver (the class of the bots', from the session), parked on demand. */
const drive = () =>
  page.evaluate(() => {
    const s = window.__apex?.session;
    if (!s || s.__ai) return !!s?.__ai;
    const bot = [...s.remotes.values()].find((r) => r.bot);
    if (!bot) return false;
    const Ai = bot.bot.ai.constructor;
    const ai = new Ai(s.trackData, s.vehicle, 0.92, 0);
    if (s.pit) {
      const [a, b] = s.pit.boxes()[s.pit.boxOf(s.race.slots[s.me] ?? 0)];
      ai.pitBox = Math.round((a + b) / 2);
    }
    s.__ai = ai;
    s.__park = false;
    s.smoother.update = (dt) => {
      const raceT = s.startAt !== null ? s.conn.serverNow() - s.startAt : -1;
      const c = ai.update(dt, raceT >= 0, s.vehicle.weatherGrip * s.vehicle.tyreGripAvg);
      if (s.__park) {
        c.throttle = 0;
        c.brake = 1;
      }
      return c;
    };
    return true;
  });

await page.waitForSelector('.race-ui', { timeout: 180_000 });
await page.keyboard.press('Enter');
await drive();
console.log('  qualifying running (your car on the AI)');
// every 15 s: each car's distance and speed (and a picture), until the results
for (let k = 0; !(await page.$('.results')) && k < 48; k++) {
  await page.waitForTimeout(15_000);
  const line = await page
    .evaluate(() => {
      const s = window.__apex?.session;
      if (!s) return 'no session';
      const sp = (v) => Math.round(Math.hypot(v.x, v.z) * 3.6);
      const me = `me ${sp(s.vehicle.body.linvel())}`;
      const bots = [...s.remotes.values()].map((r) => `${s.names.get(r.id)?.slice(3, 7)} ${r.bot ? sp(r.bot.vehicle.body.linvel()) : '?'}`);
      const st = s.standings.map((x) => `${s.names.get(x.id)?.slice(-5)}:${Math.round(x.raceDist)}`).join(' ');
      return `${me} | ${bots.join(', ')} | ${st}`;
    })
    .catch(() => 'session ended');
  console.log(`  q+${(k + 1) * 15}s ${line}`);
  if (k % 4 === 1) await shot(`q-${(k + 1) * 15}s`);
}
await page.waitForSelector('.results', { timeout: 12 * 60_000 });
await page.waitForTimeout(1000);
console.log('  qualifying:', (await page.textContent('.results table')).replace(/\s+/g, ' ').slice(0, 300));
await page.waitForSelector('.race-ui', { timeout: 120_000 }).catch(async () => {
  await shot('x-no-race');
  const state = await page.evaluate(() => {
    const a = window.__app;
    return JSON.stringify({
      screen: a.screen,
      phase: a.room?.phase,
      raceAt: a.room ? undefined : null,
      pending: a.pendingRace?.kind,
      overlay: document.querySelector('.loading, .results, .lobby')?.className,
    });
  });
  console.log('  no race:', state, '| errors:', errors.join(' | ').slice(0, 2000));
  process.exit(1);
});
await page.keyboard.press('Enter');
for (let i = 0; i < 40 && !(await drive()); i++) await page.waitForTimeout(250);

// sampler in the page
await page.evaluate(
  ({ parkAt, parkFor }) => {
    const w = window;
    const st = {
      courses: [],
      scSeen: 0,
      fcyOver: 0,
      fcyMax: 0,
      fcySamples: 0,
      overlaps: 0,
      samples: 0,
      laneBots: {},
      stops: {},
      dts: {},
      fuel: {},
      myStop: null,
      parked: null,
    };
    w.__rules = st;
    const tick = () => {
      const s = w.__apex?.session;
      if (!s || !s.startAt || s.disposed) return;
      const now = s.conn.serverNow();
      const raceT = (now - s.startAt) / 1000;
      if (raceT < 0) return;
      st.samples++;
      const rc = s.rc;
      if (st.courses[st.courses.length - 1]?.course !== rc.course) st.courses.push({ course: rc.course, at: Math.round(raceT) });
      if (s.sc?.visible) st.scSeen++;
      // park for a while to make an incident, then drive on
      if (raceT > parkAt && raceT < parkAt + parkFor && !s.__park && st.parked === null) {
        s.__park = true;
        st.parked = Math.round(raceT);
      }
      if (raceT >= parkAt + parkFor) s.__park = false;
      // the pit menu: start the service (Enter), then let the AI drive on
      if (s.pitMenu && !s.service) window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Enter' }));
      if (s.__ai && !s.pitHold && s.__ai.atBox) s.__ai.pitServed();
      // ask for the player's mandatory stop on lap 2
      if (s.__ai && s.myLaps === 1 && !s.__ai.pitRequest && !s.__ai.inPitLane && !s.__stopAsked) {
        s.__ai.pitRequest = 'stop';
        s.__stopAsked = true;
      }
      const cars = [];
      cars.push({ id: s.me, p: s.currPos, v: Math.hypot(s.vehicle.body.linvel().x, s.vehicle.body.linvel().z), lane: s.pit?.inLane });
      for (const r of s.remotes.values()) {
        const v = r.bot ? r.bot.vehicle.body.linvel() : r.vel;
        cars.push({ id: r.id, p: r.visual.object.position, v: Math.hypot(v.x, v.z), lane: r.bot?.ai.inPitLane });
        if (r.bot?.ai.inPitLane) st.laneBots[r.id] = (st.laneBots[r.id] ?? 0) + 1;
        if (r.bot && r.bot.vehicle.fuelL !== null) st.fuel[r.id] = Math.round(r.bot.vehicle.fuelL * 10) / 10;
      }
      st.fuel[s.me] = s.vehicle.fuelL === null ? null : Math.round(s.vehicle.fuelL * 10) / 10;
      if (rc.course === 'fcy' && rc.limitAt && now > rc.limitAt + 2000) {
        for (const c of cars) {
          if (c.lane) continue;
          st.fcySamples++;
          st.fcyMax = Math.max(st.fcyMax, c.v * 3.6);
          if (c.v * 3.6 > 85) st.fcyOver++;
        }
      }
      // bodies intersecting (within 4.2 m along and 1.8 m across): with contact on, cars push each other apart
      for (let i = 0; i < cars.length; i++)
        for (let j = i + 1; j < cars.length; j++) {
          const a = cars[i].p;
          const b = cars[j].p;
          if (Math.hypot(a.x - b.x, a.z - b.z) < 1.8 && (cars[i].v > 2 || cars[j].v > 2)) st.overlaps++;
        }
      for (const x of s.standings) {
        if (x.stopDone) st.stops[x.id] = true;
        if (x.driveThroughs) st.dts[x.id] = Math.max(st.dts[x.id] ?? 0, x.driveThroughs);
      }
    };
    window.setInterval(tick, 250);
  },
  { parkAt: PARK_AT, parkFor: PARK_FOR },
);

// screenshots of the course states as they happen
const seen = new Set();
const deadline = Date.now() + 20 * 60_000;
while (Date.now() < deadline) {
  if (await page.$('.results')) break;
  const course = await page.evaluate(() => window.__apex?.session?.rc.course ?? 'none').catch(() => 'none');
  const flag = await page.textContent('.hud-flag').catch(() => '');
  const key = `${course}:${(flag ?? '').split(' ')[0]}`;
  if (!seen.has(key) && flag) {
    seen.add(key);
    await shot(`3-race-${seen.size}-${course}`);
    console.log(`  ${course}: "${flag}"`);
  }
  const pitMenu = await page.$('.pit-menu');
  if (pitMenu && !seen.has('pit')) {
    seen.add('pit');
    await shot('4-pit-menu');
    console.log('  pit menu:', (await page.textContent('.pit-card')).replace(/\s+/g, ' ').slice(0, 300));
  }
  await page.waitForTimeout(1000);
}
const st = await page.evaluate(() => window.__rules);
console.log('  course states:', st.courses.map((c) => `${c.course}@${c.at}s`).join(' → '));
console.log(`  parked at ${st.parked} s for ${PARK_FOR} s; safety car seen in ${st.scSeen} samples`);
console.log(`  FCY: ${st.fcySamples} car samples after the limit, fastest ${st.fcyMax.toFixed(0)} km/h, ${st.fcyOver} over 85 km/h`);
console.log(`  bodies overlapping: ${st.overlaps} of ${st.samples} samples`);
console.log('  bots in the pit lane (samples):', JSON.stringify(st.laneBots));
console.log('  mandatory stops done:', JSON.stringify(st.stops), ' drive-throughs:', JSON.stringify(st.dts));
console.log('  fuel at the end (l):', JSON.stringify(st.fuel));
await page.waitForSelector('.results', { timeout: 5 * 60_000 }).catch(() => {});
await page.waitForTimeout(1000);
await shot('5-results');
console.log('  race results:', ((await page.textContent('.results').catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 900));
if (errors.length) console.log('  page errors:', errors.slice(0, 8).join(' | '));
await browser.close();
