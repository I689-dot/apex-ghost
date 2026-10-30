#!/usr/bin/env node
/**
 * Public room + spectator check: a host makes a public room with AI cars and starts; a second visitor finds it
 * in the menu's live session list, clicks Watch and follows the cars (←/→). Screenshots: tools/e2e/out/spec-*.png.
 *
 *   node tools/e2e/spectate.mjs [--url http://127.0.0.1:5173]
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:5173';
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const mk = async (nick) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${nick}] pageerror`, String(e)));
  await page.addInitScript(
    (n) => localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: n, quality: 'low', qualityAuto: false, language: 'en' })),
    nick,
  );
  await page.goto(URL);
  await page.waitForSelector('.menu');
  await page.waitForTimeout(2000);
  return page;
};
const host = await mk('Hosty');
await host.click('button:has-text("Create room")');
await host.waitForSelector('.lb-steps');
await host.check('.switch-row input');
await host.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), ['weather', 'clear']);
await host.click('.lb-step >> nth=4');
await host.click('.car-card >> nth=0');
for (let i = 0; i < 3; i++) {
  await host.click('button.add-bot');
  await host.waitForTimeout(250);
}
await host.click('.lobby-actions button:has-text("Ready")');
// the visitor sees the room in the list
const fan = await mk('Fan');
await fan.waitForSelector('.room-row', { timeout: 20_000 });
console.log('  listed:', (await fan.textContent('.room-list')).replace(/\s+/g, ' '));
await fan.screenshot({ path: 'tools/e2e/out/spec-1-list.png' });
await host.click('button:has-text("Start race")');
await host.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
await host.waitForSelector('.race-ui', { timeout: 180_000 });
await host.keyboard.press('Enter');
await fan.waitForTimeout(16_000); // list refresh
await fan.click('.room-row button.ghost:has-text("Watch")');
await fan.waitForSelector('.race-ui', { timeout: 180_000 });
await fan.keyboard.press('Enter');
await fan.waitForTimeout(25_000);
await fan.screenshot({ path: 'tools/e2e/out/spec-2-watching.png' });
console.log('  fan HUD:', await fan.textContent('.hud-pit'), '|', (await fan.textContent('.hud-board')).replace(/\s+/g, ' '));
await fan.keyboard.press('ArrowRight');
await fan.waitForTimeout(3000);
await fan.screenshot({ path: 'tools/e2e/out/spec-3-next-car.png' });
console.log('  after →:', await fan.textContent('.hud-pit'));
console.log('  host sees spectators:', await host.evaluate(() => window.__app?.room?.spectators));
await browser.close();
