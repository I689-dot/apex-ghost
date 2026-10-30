#!/usr/bin/env node
/**
 * Menu layout check: screenshots of the main menu at common desktop sizes, English and Spanish, and a list of
 * elements whose text overflows their box. Output: tools/e2e/out/menu-<w>x<h>-<lang>.png
 *
 *   node tools/e2e/menushots.mjs [--url https://apex-ghost-liard.vercel.app]
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:5173';
const browser = await chromium.launch();
for (const [w, hgt] of [
  [1920, 1080],
  [1366, 768],
  [1280, 720],
]) {
  for (const lang of ['en', 'es']) {
    const page = await browser.newPage({ viewport: { width: w, height: hgt } });
    await page.addInitScript((l) => localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'Checker', language: l })), lang);
    await page.goto(URL);
    await page.waitForSelector('.menu');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `tools/e2e/out/menu-${w}x${hgt}-${lang}.png` });
    const bad = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.menu *')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const cs = window.getComputedStyle(el);
        const textOverflow = el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll';
        const parent = el.parentElement?.getBoundingClientRect();
        const outside = parent && (r.right > parent.right + 1 || r.left < parent.left - 1);
        if (textOverflow || outside)
          out.push(
            `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent ?? '').trim().slice(0, 40)}" ${textOverflow ? `scrollW ${el.scrollWidth} > ${el.clientWidth}` : ''} ${outside ? `outside parent (${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(parent.left)}–${Math.round(parent.right)})` : ''}`,
          );
      }
      return out;
    });
    console.log(`${w}x${hgt} ${lang}: ${bad.length ? '\n   ' + bad.join('\n   ') : 'ok'}`);
    await page.close();
  }
}
await browser.close();
