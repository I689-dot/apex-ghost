#!/usr/bin/env node
/**
 * A race hosted on a device: one browser hosts (the room in its page), another joins with the code over a WebRTC
 * data channel (signalled through the game server). Checks both see each other in the lobby, then the race starts
 * and the guest drives.
 *
 *   node tools/e2e/p2p.mjs [--url http://127.0.0.1:5173] [--race]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:5173';
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const open = async (nick) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`${nick} page error:`, e.message));
  await page.addInitScript((n) => {
    localStorage.setItem('apexghost.noAudio', '1');
    localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: n, language: 'en', quality: 'low', qualityAuto: false }));
  }, nick);
  await page.goto(URL);
  await page.waitForSelector('.menu', { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.click('.mm-tabs button[data-tab="online"]');
  await page.waitForTimeout(500);
  return page;
};
const host = await open('HostPhone');
await host.click('button:has-text("Host on this device")');
await host.waitForSelector('.lb-steps', { timeout: 30_000 });
const code = await host.textContent('.room-code .code');
console.log('hosted code', code);
const guest = await open('GuestPhone');
await guest.fill('input[maxlength="5"], .join-row input', code);
await guest.click('.join-row button:has-text("Join")');
await guest.waitForSelector('.lb-steps', { timeout: 30_000 });
await host.waitForTimeout(1500);
const seen = await host.evaluate(() => window.__app.room.players.map((p) => p.nick));
const seenG = await guest.evaluate(() => window.__app.room.players.map((p) => p.nick));
console.log('host sees', JSON.stringify(seen), '· guest sees', JSON.stringify(seenG));
await host.screenshot({ path: 'tools/e2e/out/p2p_host.png' });
await guest.screenshot({ path: 'tools/e2e/out/p2p_guest.png' });
let ok = seen.includes('GuestPhone') && seenG.includes('HostPhone');
console.log(ok ? '✔ joined over the data channel' : '✘ not joined');
if (ok && args.includes('--race')) {
  for (const [p, i] of [
    [host, 0],
    [guest, 1],
  ]) {
    await p.click('.lb-step >> nth=4');
    await p.click(`.car-card >> nth=${i}`);
    await p.click('.lobby-actions button:has-text("Ready")');
    await p.waitForTimeout(500);
  }
  // a short race: practice off, 5 min qualifying would be long: straight to the session as set
  await host.click('button:has-text("Start race")');
  for (const p of [host, guest]) await p.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
  await Promise.all([host, guest].map((p) => p.waitForSelector('.race-ui', { timeout: 240_000 })));
  for (const p of [host, guest]) await p.keyboard.press('Enter');
  await host.waitForFunction(() => !window.__apex.session.vehicle.frozen, null, { timeout: 90_000 });
  await host.keyboard.down('KeyW');
  await host.waitForTimeout(6000);
  const view = await guest.evaluate(() => {
    const s = window.__apex.session;
    const r = [...s.remotes.values()][0];
    return { remotes: s.remotes.size, hasData: r?.buffer.hasData, x: r?.visual.object.position.x };
  });
  const hostPos = await host.evaluate(() => window.__apex.session.vehicle.body.translation().x);
  console.log('guest sees the host car', JSON.stringify(view), 'host x', hostPos.toFixed(1));
  await guest.screenshot({ path: 'tools/e2e/out/p2p_guest_race.png' });
  ok = !!view.hasData && Math.abs((view.x ?? 0) - hostPos) < 30;
  console.log(ok ? '✔ race state over the data channel' : '✘ no race state');
}
await browser.close();
process.exit(ok ? 0 : 1);
