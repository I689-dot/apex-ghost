#!/usr/bin/env node
/**
 * The loading sequence as a phone sees it: boot splash, the race loading screen step by step, and the hand-over to
 * the race (no grey frame in between). Phone viewport, the app UI (?app=1) and a CPU slowed down like a phone's.
 *
 *   node tools/e2e/loadingshots.mjs [--quality ultra] [--cpu 4]
 *
 * Writes tools/e2e/out/loading/sheet.jpg: a frame every ~0.7 s, labelled with the time and the loading text.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'loading');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const QUALITY = opt('quality', 'ultra');
const CPU = Number(opt('cpu', '4'));

const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => m.text().startsWith('[timing]') && console.log(m.text()));
await page.addInitScript((q) => {
  localStorage.setItem('apexghost.noAudio', '1');
  localStorage.setItem('apexghost.app.init.v1', '1');
  localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Load', quality: q, qualityAuto: false, language: 'en', showPerf: false }));
}, QUALITY);
const cdp = await page.context().newCDPSession(page);
const frames = [];
const t0 = Date.now();
const grab = async (note) => frames.push({ png: await page.screenshot(), note: `${((Date.now() - t0) / 1000).toFixed(1)} s ${note}` });

await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await page.goto(`${URL}/?app=1`, { waitUntil: 'commit' });
for (let k = 0; k < 4; k++) {
  await grab('boot');
  await page.waitForTimeout(250);
}
await page.waitForSelector('button:has-text("Create room")', { timeout: 60_000 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await page.click('button:has-text("Create room")');
await page.waitForSelector('.car-card');
await page.click('.car-card >> nth=16');
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(300);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await page.evaluate(() => {
  // when each loading step starts (the label changes)
  window.__steps = [];
  let last = '';
  new window.MutationObserver(() => {
    const l = (document.querySelector('.load-label')?.textContent ?? '').replace(/ · \d+ %$/, '');
    if (l && l !== last) window.__steps.push([performance.now(), (last = l)]);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});
await page.click('button:has-text("Start race")');
await page.click('button:has-text("Ready to go")', { timeout: 20_000 }).catch(() => {});
// sample the loading screen until the curtain has gone
for (let k = 0; k < 400; k++) {
  const state = await page.evaluate(() => ({
    label: document.querySelector('.load-label')?.textContent ?? '',
    curtain: !!document.querySelector('.loading.curtain'),
    loading: !!document.querySelector('.loading'),
    race: !!document.querySelector('.race-ui'),
  }));
  if (k % 3 === 0 || state.curtain) await grab(state.loading ? state.label : 'race');
  if (state.race && !state.loading) {
    await grab('race (curtain gone)');
    break;
  }
  await page.waitForTimeout(230);
}
const steps = await page.evaluate(() => window.__steps);
steps.forEach(([t, l], i) => console.log(`  ${l.padEnd(34)} ${(((steps[i + 1]?.[0] ?? t) - t) / 1000).toFixed(1)} s`));
console.log(`${frames.length} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const keep = frames.length > 24 ? frames.filter((_, i) => i < 4 || i >= frames.length - 6 || i % Math.ceil(frames.length / 14) === 0) : frames;
const tw = 458;
const th = 206;
const cols = 4;
const tiles = await Promise.all(
  keep.map(async (f) => ({
    input: await sharp(f.png)
      .resize(tw, th)
      .composite([
        {
          input: Buffer.from(
            `<svg width="${tw}" height="18"><rect width="${tw}" height="18" fill="#000a"/><text x="4" y="13" font-size="12" fill="#ff0" font-family="sans-serif">${f.note.replace(/[<&]/g, '')}</text></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .toBuffer(),
  })),
);
const file = path.join(out, 'sheet.jpg');
await sharp({ create: { width: tw * cols, height: th * Math.ceil(keep.length / cols), channels: 3, background: '#000' } })
  .composite(tiles.map((t, k) => ({ ...t, left: (k % cols) * tw, top: Math.floor(k / cols) * th })))
  .jpeg({ quality: 85 })
  .toFile(file);
console.log(file);
await browser.close();
