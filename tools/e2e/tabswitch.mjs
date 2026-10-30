#!/usr/bin/env node
/**
 * Tab switch check: a host starts a room with AI cars, a visitor watches it; the visitor's tab is hidden and shown
 * again (visibilitychange) a few times, and the other cars must keep moving on the visitor's screen. They froze
 * for good: the clock jumped ~55 years ahead between the tab coming back and the next pong, and the packets
 * stamped then locked the remote buffers (connection.ts, remote.ts). Needs the server too (`pnpm dev`).
 *
 *   CHROME=/path/to/chrome node tools/e2e/tabswitch.mjs [--url http://127.0.0.1:5173]
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const mk = async (nick) => {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${nick}] pageerror`, String(e)));
  await page.addInitScript(
    (n) => localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: n, quality: 'low', qualityAuto: false, language: 'en' })),
    nick,
  );
  // a real connection: pongs come back a round trip later (locally ~1 ms, too short for a state packet to land
  // between the tab coming back and the first pong, which is when the clock was wrong)
  await page.addInitScript(() => {
    const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return desc.get.call(this);
      },
      set(fn) {
        desc.set.call(this, (e) => (typeof e.data === 'string' && e.data.includes('"t":"pong"') ? setTimeout(() => fn.call(this, e), 150) : fn.call(this, e)));
      },
    });
  });
  await page.goto(URL);
  await page.waitForSelector('.menu');
  await page.waitForTimeout(1500);
  return page;
};
const host = await mk('Hosty');
await host.click('button:has-text("Create room")');
await host.waitForSelector('.lb-steps');
await host.check('.switch-row input');
await host.click('.lb-step >> nth=4');
await host.click('.car-card >> nth=0');
for (let i = 0; i < 2; i++) {
  await host.click('button.add-bot');
  await host.waitForTimeout(250);
}
await host.click('.lobby-actions button:has-text("Ready")');
await host.click('button:has-text("Start race")');
await host.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await host.waitForSelector('.race-ui', { timeout: 180_000 });
await host.keyboard.press('Enter');
const fan = await mk('Fan');
await fan.waitForSelector('.room-row', { timeout: 30_000 });
await fan.click('.room-row button.ghost:has-text("Watch")');
await fan.waitForSelector('.race-ui', { timeout: 180_000 });
await fan.keyboard.press('Enter');
await fan.waitForTimeout(20_000); // grid, lights, cars rolling

// how far each other car moved on the visitor's screen over `ms`
const moved = (ms) =>
  fan.evaluate(async (ms) => {
    const remotes = [...window.__apex.session.remotes.values()];
    const a = remotes.map((r) => r.visual.object.position.clone());
    await new Promise((r) => setTimeout(r, ms));
    return remotes.map((r, i) => Math.round(r.visual.object.position.distanceTo(a[i])));
  }, ms);
const setVisible = (v) =>
  fan.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'visible' : 'hidden') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !v });
    document.dispatchEvent(new Event('visibilitychange'));
  }, v);

const before = await moved(3000);
console.log('  before switching tabs, metres moved in 3 s:', before.join(' '));
for (let k = 0; k < 4; k++) {
  await setVisible(false);
  await fan.waitForTimeout(1500);
  await setVisible(true);
  await fan.waitForTimeout(500);
}
await fan.waitForTimeout(2000);
const after = await moved(3000);
console.log('  after 4 tab switches, metres moved in 3 s:', after.join(' '));
await fan.screenshot({ path: 'tools/e2e/out/tabswitch.png' });
// the cars that were driving before (the host's own car stands on the grid: nobody drives it)
const driving = before.map((m, i) => (m > 5 ? i : -1)).filter((i) => i >= 0);
const ok = driving.length > 0 && driving.every((i) => after[i] > 5);
console.log(ok ? '  OK: the other cars keep moving' : '  FAILED: other cars froze after the tab switch');
await browser.close();
process.exit(ok ? 0 : 1);
