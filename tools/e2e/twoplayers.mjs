#!/usr/bin/env node
/**
 * Two drivers in one room (contact rule on), each driven by the bots' AI, over a network with a delay added in each
 * direction (--lag ms, each way between a browser and the server). Every 50 ms each page logs its own car and where
 * it draws the other one; afterwards each view of the other car is compared with where that car really was at the
 * same server time (its own log): the error along its heading (+ = drawn ahead of where it is) and across.
 * The two drivers used to see each other ~150 ms + the network's delay in the past (~10 m behind at 250 km/h), so in
 * a close fight both saw the other behind them. --old draws the others in the past again, for comparison.
 * Needs the server too (`pnpm dev`).
 *
 * --crash: the host's car stops on the racing line --park-at m into the lap and the guest's runs into it; each car's
 * speed and height over the road are logged: the parked car must be shoved by the hit (it used to feel nothing:
 * the hitting car met an immovable box), and neither may fly up or sink under the road.
 *
 *   CHROME=/path/to/chrome node tools/e2e/twoplayers.mjs [--url http://127.0.0.1:5173] [--lag 50] [--secs 40] [--old]
 *     [--crash] [--park-at 700]
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
const LAG = Number(opt('lag', '50'));
const SECS = Number(opt('secs', '40'));
const OLD = args.includes('--old');
const CRASH = args.includes('--crash');
const PARK_AT = Number(opt('park-at', '700'));

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const mk = async (nick) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${nick}] pageerror`, String(e)));
  await page.addInitScript((n) => {
    localStorage.setItem('apexghost.noAudio', '1');
    localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: n, quality: 'low', qualityAuto: false, language: 'en', camera: 'chase' }));
  }, nick);
  // the network's delay, both ways (a WebSocket keeps its order: one fixed delay keeps it too)
  await page.addInitScript((lag) => {
    const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return desc.get.call(this);
      },
      set(fn) {
        desc.set.call(this, (e) => setTimeout(() => fn.call(this, e), lag));
      },
    });
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) {
      setTimeout(() => this.readyState === 1 && send.call(this, d), lag);
    };
  }, LAG);
  await page.goto(URL);
  await page.waitForSelector('.menu');
  await page.waitForTimeout(1500);
  return page;
};

const host = await mk('Hosty');
await host.click('button:has-text("Create room")');
await host.waitForSelector('.car-card');
const code = await host.evaluate(() => window.__app.conn.code);
await host.click('.rules label:has-text("Car contact") input');
await host.evaluate(() => window.__app.conn.sendJson({ t: 'setSession', minutes: 5 }));
await host.click('.car-card >> nth=0');
await host.click('.lobby-actions button:has-text("Ready")');
const guest = await mk('Guesty');
await guest.fill('input.code-input', code);
await guest.click('.menu-card button:has-text("Join")');
await guest.waitForSelector('.car-card', { timeout: 30_000 });
await guest.click('.car-card >> nth=1');
await guest.click('.lobby-actions button:has-text("Ready")');
await host.waitForTimeout(800);
await host.click('button:has-text("Start race")');
for (const p of [host, guest]) await p.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
for (const p of [host, guest]) await p.waitForSelector('.race-ui', { timeout: 240_000 });
for (const p of [host, guest]) await p.keyboard.press('Enter');

// both cars on the AI (the guest a little faster, so it catches the host), and a log of what each page sees
const start = (p, skill, old, parkAt) =>
  p.evaluate(
    ({ skill, old, parkAt }) => {
      const s = window.__apex.session;
      const ai = new window.__apex.AiDriver(s.trackData, s.vehicle, skill, 0);
      let parked = false;
      s.smoother.update = (dt) => {
        const c = ai.update(dt, s.startAt !== null && s.conn.serverNow() >= s.startAt, s.vehicle.weatherGrip * s.vehicle.tyreGripAvg);
        const tr = s.localTracker?.players.get(s.me);
        if (parkAt > 0 && tr && tr.passed >= 0 && tr.laps === 0 && s.loc.s > parkAt) parked = true;
        if (parked) {
          c.throttle = 0;
          c.brake = 0; // stopped, rolling free: a hit can move it
          c.steer = 0;
        }
        return c;
      };
      const hit = { dist: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt' };
      const gq = s.track.groundQuery(s.world);
      if (old)
        for (const r of s.remotes.values()) {
          const f = r.buffer.sample.bind(r.buffer);
          r.buffer.sample = (n, dt) => f(n, dt, 150);
        }
      window.__log = [];
      window.__bumps = 0;
      const onBump = s.onBump.bind(s);
      s.onBump = (m) => {
        window.__bumps++;
        onBump(m);
      };
      window.setInterval(() => {
        const me = s.myVisual.object.position;
        const q = s.myVisual.object.quaternion;
        const o = [...s.remotes.values()][0]?.visual.object.position;
        // heading (x, z) of my car
        const hx = 2 * (q.x * q.z + q.y * q.w);
        const hz = 1 - 2 * (q.x * q.x + q.y * q.y);
        // height of my car over the road under it (the body's origin sits on the ground)
        const bp = s.vehicle.body.translation();
        const g = gq.cast(bp.x, bp.y + 4, bp.z, 0, -1, 0, 30, hit) ? bp.y - hit.py : null;
        window.__log.push({ t: s.conn.serverNow(), me: [me.x, me.z, hx, hz], other: o ? [o.x, o.z] : null, v: s.vehicle.telemetry.speed, h: g, parked });
      }, 50);
    },
    { skill, old, parkAt },
  );
await start(host, 0.9, OLD, CRASH ? PARK_AT : 0);
await start(guest, 0.97, OLD, 0);
console.log(`  room ${code}: both cars on the AI, ${LAG} ms each way, ${OLD ? 'OLD (drawn in the past)' : 'drawn in the present'}; ${SECS} s`);
await host.waitForTimeout(16_000 + SECS * 1000);
await guest.screenshot({ path: path.join(out, 'twoplayers-guest.png') });
await host.screenshot({ path: path.join(out, 'twoplayers-host.png') });
const [hl, gl] = await Promise.all([host.evaluate(() => window.__log), guest.evaluate(() => window.__log)]);
const bumps = await Promise.all([host.evaluate(() => window.__bumps), guest.evaluate(() => window.__bumps)]);

/** Where a car really was at time t (its own log, linear between entries). */
const truth = (log, t) => {
  for (let i = 1; i < log.length; i++)
    if (log[i].t >= t) {
      const a = log[i - 1];
      const b = log[i];
      const u = (t - a.t) / (b.t - a.t || 1);
      return { x: a.me[0] + (b.me[0] - a.me[0]) * u, z: a.me[1] + (b.me[1] - a.me[1]) * u, hx: b.me[2], hz: b.me[3], v: b.v };
    }
  return null;
};
const compare = (viewer, owner, name) => {
  const along = [];
  const across = [];
  for (const e of viewer) {
    if (!e.other) continue;
    const tr = truth(owner, e.t);
    if (!tr || tr.v < 20) continue; // moving at racing speed
    const l = Math.hypot(tr.hx, tr.hz) || 1;
    const dx = e.other[0] - tr.x;
    const dz = e.other[1] - tr.z;
    along.push((dx * tr.hx + dz * tr.hz) / l);
    across.push(Math.abs((dx * tr.hz - dz * tr.hx) / l));
  }
  along.sort((a, b) => a - b);
  across.sort((a, b) => a - b);
  const q = (a, f) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : '-');
  const mean = along.reduce((s, x) => s + x, 0) / Math.max(1, along.length);
  console.log(
    `  ${name}: ${along.length} samples · along the heading mean ${mean.toFixed(2)} m (p5 ${q(along, 0.05)}, median ${q(along, 0.5)}, p95 ${q(along, 0.95)}) · across median ${q(across, 0.5)} p95 ${q(across, 0.95)} m`,
  );
  return mean;
};
const a = compare(hl, gl, "host's view of the guest");
const b = compare(gl, hl, "guest's view of the host");
await browser.close();
let ok = Math.abs(a) < 2 && Math.abs(b) < 2;
if (CRASH) {
  // the parked car: its top speed while parked (a hit shoves it), and both cars' heights over the road
  const park = hl.filter((e) => e.parked);
  const settled = park.slice(40);
  const shove = Math.max(0, ...settled.map((e) => e.v));
  const hs = (log) => log.map((e) => e.h).filter((x) => x !== null);
  const [hh, gh] = [hs(hl), hs(gl)];
  const gv = new Map(gl.map((e) => [Math.round(e.t / 250), e.v]));
  const line = park
    .filter((_, i) => i % 5 === 0)
    .map((e) => `${(e.v * 3.6).toFixed(0)}/${((gv.get(Math.round(e.t / 250)) ?? 0) * 3.6).toFixed(0)}`)
    .join(' ');
  console.log(`  parked car / guest km/h every 0.25 s: ${line}`);
  console.log(`  bumps received: host ${bumps[0]}, guest ${bumps[1]}`);
  console.log(`  crash: parked for ${(park.length / 20).toFixed(0)} s; parked car's top speed after settling ${(shove * 3.6).toFixed(1)} km/h`);
  console.log(
    `  height over the road (m): host ${Math.min(...hh).toFixed(2)}…${Math.max(...hh).toFixed(2)}, guest ${Math.min(...gh).toFixed(2)}…${Math.max(...gh).toFixed(2)}`,
  );
  ok = ok && shove > 1 && Math.min(...hh, ...gh) > -0.3 && Math.max(...hh, ...gh) < 1.5;
}
console.log(ok ? '  OK: each driver sees the other where it is' : '  FAILED: a driver sees the other car metres away from where it is');
process.exit(ok ? 0 : 1);
