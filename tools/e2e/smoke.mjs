#!/usr/bin/env node
/**
 * Browser smoke test (Playwright + software WebGL): menu → create room → pick car → ready → start
 * → load → countdown → drive. Saves screenshots to tools/e2e/out and fails on console errors.
 *
 *   node tools/e2e/smoke.mjs [--url http://127.0.0.1:5173] [--drive-ms 8000] [--quality low] [--gpu] [--width 1280 --height 720] [--bots 3] [--racing-line off|corners|full] [--track nurburgring_short] [--weather heavy_rain]
 *
 * --gpu uses the real GPU through ANGLE/OpenGL (instead of SwiftShader) and reports measured fps.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const DRIVE_MS = Number(opt('drive-ms', '8000'));
const QUALITY = opt('quality', 'low');
const GPU = args.includes('--gpu');
const W = Number(opt('width', '1280'));
const H = Number(opt('height', '720'));
const BOTS = Number(opt('bots', '0'));
const LINE = opt('racing-line', 'corners');
const NO_AUDIO = args.includes('--no-audio');
const TRACK = opt('track', '');
const WEATHER = opt('weather', '');

const browser = await chromium.launch({
  args: GPU
    ? ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errors.push(t);
  if (/\[smoke\]|error|warn/i.test(t)) console.log(`  [console.${m.type()}] ${t.slice(0, 300)}`);
});
page.on('pageerror', (e) => errors.push(String(e)));

const shot = async (name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 120_000 });
  console.log(`  screenshot ${name}.png`);
};

const SEED = opt('weather-seed', '');
await page.addInitScript(
  ([q, seed, line, noAudio]) => {
    if (noAudio) localStorage.setItem('apexghost.noAudio', '1');
    localStorage.setItem(
      'apexghost.settings.v1',
      JSON.stringify({ nickname: 'SmokeTest', quality: q, qualityAuto: false, showPerf: true, dynamicResolution: false, racingLine: line }),
    );
    if (seed) localStorage.setItem('apexghost.devWeatherSeed', seed);
    else localStorage.removeItem('apexghost.devWeatherSeed');
  },
  [QUALITY, SEED, LINE, NO_AUDIO],
);
console.log(`▶ opening ${URL}`);
// any "Malformed message" toast during the whole run (they only stay a few seconds)
await page.addInitScript(() => {
  new MutationObserver(() => {
    if (document.body?.innerText.includes('Malformed')) window.__malformed = true;
  }).observe(document, { subtree: true, childList: true, characterData: true });
});
await page.goto(URL);
await page.waitForSelector('.menu-card', { timeout: 30_000 });
await page.waitForTimeout(4000);
await shot('01-menu');
let apiRequests = 0;
page.on('request', (r) => {
  if (/\/api\//.test(r.url())) apiRequests++;
});
page.on('websocket', (ws) => {
  if (/\/api\//.test(ws.url())) apiRequests++;
});
if (args.includes('--solo')) await page.click('button.solo');
else await page.click('button.primary:has-text("Create room")');
await page.waitForSelector('.lobby', { timeout: 30_000 });
await page.waitForSelector('.car-card', { timeout: 30_000 });
await page.waitForTimeout(2500);
const code = args.includes('--solo') ? 'SOLO (offline)' : await page.textContent('.room-code .code');
console.log(`  room ${code}`);
if (TRACK) {
  await page.selectOption('.prep .prep-row:nth-of-type(1) select', TRACK);
  await page.waitForTimeout(600);
}
if (WEATHER) {
  await page.selectOption('.prep .prep-row:nth-of-type(2) select', WEATHER);
  await page.waitForTimeout(600);
}
if (TRACK || WEATHER) {
  const f = await page.textContent('.forecast b');
  console.log(`  forecast: ${f}`);
}
await page.click('.car-card >> nth=0');
await page.waitForTimeout(1500);
for (let i = 0; i < BOTS; i++) {
  await page.click('button.add-bot');
  await page.waitForTimeout(400);
}
if (BOTS) console.log(`  bots in lobby: ${await page.locator('.players .badge.bot').count()}`);
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(800);
await shot('02-lobby');
await page.click('button:has-text("Start race")');
// briefing: confirm the car setup
await page.waitForSelector('.briefing', { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(800);
await shot('02b-briefing');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await page.waitForSelector('.loading', { timeout: 20_000 });
await page.waitForTimeout(1500);
await shot('03-loading');
console.log('  loading race…');
await page.waitForSelector('.race-ui', { timeout: 240_000 });
console.log('  race UI up');
// pre-race cinematic: aerial flyover, then the grid pass with driver names, then the start lights
await page.waitForTimeout(2500);
await shot('04a-cinematic-flyover');
await page.waitForTimeout(6000);
await shot('04b-cinematic-grid');
const audio = await page.evaluate(() => {
  const s = window.__apex?.session;
  return s ? { snd: !!s.snd, others: s.otherCars?.length ?? 0 } : null;
});
console.log('  audio', JSON.stringify(audio));
await page.waitForTimeout(5500);
await shot('04c-countdown');
// green light at 16 s after everyone loaded
await page.waitForTimeout(3000);
await page.keyboard.down('KeyW');
// measure frame pacing while driving
await page.evaluate(() => {
  const w = window;
  w.__frames = [];
  let last = performance.now();
  const tick = (t) => {
    w.__frames.push(t - last);
    last = t;
    if (w.__frames.length < 100000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(DRIVE_MS / 2);
await shot('05-driving');
await page.keyboard.down('KeyA');
await page.waitForTimeout(DRIVE_MS / 4);
await page.keyboard.up('KeyA');
await page.waitForTimeout(DRIVE_MS / 4);
await shot('06-driving-2');
if (BOTS) {
  const bots = await page.evaluate(() => {
    const s = window.__apex?.session;
    if (!s) return null;
    return [...s.remotes.values()].map((r) => ({
      id: r.id,
      local: !!r.bot,
      kmh: r.bot ? Math.round(r.bot.vehicle.telemetry.speed * 3.6) : null,
      dist: s.localTracker?.players.get(r.id)?.raceDist?.toFixed(0),
    }));
  });
  console.log('  bots', JSON.stringify(bots));
  const tm = await page.evaluate(async () => {
    const acc = {};
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 50));
      for (const [k, v] of Object.entries(window.__timings ?? {})) acc[k] = (acc[k] ?? 0) + v / 30;
    }
    return acc;
  });
  console.log(
    '  frame timings ms',
    JSON.stringify(tm, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)),
  );
}
await page.keyboard.up('KeyW');
const fps = await page.evaluate(() => {
  const f = window.__frames.slice(5);
  const sorted = [...f].sort((a, b) => b - a);
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  return { frames: f.length, avgFps: 1000 / avg, p99FrameMs: sorted[Math.floor(f.length * 0.01)], worstFrameMs: sorted[0] };
});
console.log(
  `  frame pacing (${QUALITY}, ${W}x${H}${GPU ? ', GPU' : ', software'}): avg ${fps.avgFps.toFixed(1)} fps, 1% low ${(1000 / fps.p99FrameMs).toFixed(1)} fps, worst frame ${fps.worstFrameMs.toFixed(1)} ms over ${fps.frames} frames`,
);
const raceInfo = await page.evaluate(() => {
  const s = window.__apex?.session;
  return s ? { track: s.trackData.id, length: Math.round(s.trackData.length), weather: s.race.weather.kind, tyre: s.vehicle.compound.id } : null;
});
console.log('  race', JSON.stringify(raceInfo));
const snd = await page.evaluate(() => {
  const s = window.__apex?.session;
  const a = s?.cb?.audio?.();
  return a ? { state: a.ctx.state, worklet: a.workletOk, rms: +a.level().toFixed(4), session: !!s.snd } : 'no audio object';
});
console.log('  audio output', JSON.stringify(snd));
const hud = await page.evaluate(() => ({
  speed: document.querySelector('.hud-speed')?.textContent,
  gear: document.querySelector('.hud-gear')?.textContent,
  lap: document.querySelector('.hud-big')?.textContent,
  perf: document.querySelector('.perf pre')?.textContent,
}));
console.log('  HUD', JSON.stringify(hud));
if (args.includes('--pit')) {
  // put the car in the pit lane just before the service box, roll in under the limiter and stop
  await page.evaluate(() => {
    const s = window.__apex.session;
    const lane = s.trackData.pitLane;
    const i = lane.boxFrom - 6;
    const a = lane.points[i];
    const b = lane.points[i + 2];
    s.vehicle.place(a[0], a[1] + 0.4, a[2], Math.atan2(b[0] - a[0], b[2] - a[2]));
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  const lim = await page.evaluate(() => ({
    kmh: Math.round(window.__apex.session.vehicle.telemetry.speed * 3.6),
    pit: document.querySelector('.hud-pit')?.textContent,
  }));
  console.log('  pit lane', JSON.stringify(lim));
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(800);
  const menu = await page.$('.pit-menu');
  console.log(`  pit menu ${menu ? 'open' : 'NOT open'}`);
  await shot('07a-pit-box');
  if (menu) {
    await page.click('.pit-tyre >> nth=1'); // soft
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await shot('07b-pit-service');
    await page.waitForSelector('.pit-menu', { state: 'detached', timeout: 60_000 });
    const after = await page.evaluate(() => ({ compound: window.__apex.session.vehicle.compound.id, frozen: window.__apex.session.vehicle.frozen }));
    console.log('  after service', JSON.stringify(after));
  }
}
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await shot('07-pause');
// solo: the in-browser room must not reject any client message
if (args.includes('--solo') && (await page.evaluate(() => window.__malformed === true))) throw new Error('a Malformed message toast appeared');
await browser.close();
const bad = errors.filter((e) => !/favicon|ERR_CONNECTION_REFUSED.*fonts|net::ERR/i.test(e));
if (bad.length) {
  console.error('✘ console errors:\n' + bad.map((e) => '  ' + e).join('\n'));
  process.exit(1);
}
if (args.includes('--solo')) {
  console.log(`  requests to the online server: ${apiRequests}`);
  if (apiRequests > 0) throw new Error('solo mode talked to the online server');
}
console.log('✔ smoke test passed');
