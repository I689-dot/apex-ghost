#!/usr/bin/env node
/**
 * Drives a stretch of a circuit in the web game (dev server) with the car held on a lateral line, onto the kerbs, and
 * prints the worst body roll and the biggest jump in vertical speed (a bounce) there.
 *   FROM=3120 TO=3470 LANES="[0,-5.5,5.5]" node tools/e2e/kerbdrive.mjs   (dev server on :5199, Spa)
 */
import { chromium } from 'playwright';
const lanes = JSON.parse(process.env.LANES || '[0,-5.8,5.8]');
const AI_LINE_ENV = process.env.AI_LINE ? 1 : 0;
const FROM = Number(process.env.FROM || 3120), TO = Number(process.env.TO || 3470), KMH = Number(process.env.KMH || 150);
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const lane of lanes) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.addInitScript(() => {
    localStorage.setItem('apexghost.noAudio', '1');
    localStorage.setItem('apexghost.settings.v1', JSON.stringify({ nickname: 'T9', quality: 'low', qualityAuto: false, language: 'en', camera: 'chase', showPerf: false, racingLine: 'off', ghost: false }));
  });
  await page.goto(`${process.env.URL || 'http://localhost:5199'}/?nointro`);
  await page.click('button:has-text("Play solo")');
  await page.waitForSelector('.lb-steps', { timeout: 60000 });
  await page.waitForTimeout(800);
  const cond = (k, v) => page.evaluate(([k, v]) => window.__app.conn.sendJson({ t: 'setConditions', [k]: v }), [k, v]);
  await cond('trackId', 'spa');
  await page.waitForTimeout(400);
  await cond('weather', 'clear'); await cond('time', 'midday');
  await page.waitForTimeout(300);
  await page.click('.lb-step >> nth=4');
  await page.click('.car-card >> nth=0');
  await page.click('.lobby-actions button:has-text("Ready")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("Start race")');
  await page.click('button:has-text("Ready to go")', { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('.race-ui', { timeout: 240000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__apex?.session?.vehicle && !window.__apex.session.vehicle.frozen, null, { timeout: 90000 });
  await page.waitForTimeout(500);
  const res = await page.evaluate(
    ([from, to, lane, kmh, AI_LINE]) =>
      new Promise((resolve) => {
        const { session: ses, AiDriver } = window.__apex;
        const td = ses.trackData, cl = td.centerline, n = cl.length / 3, v = ses.vehicle;
        const at = (s) => { let i = 0; while (i < n - 2 && td.cumS[i + 1] < s) i++; const u = (s - td.cumS[i]) / (td.cumS[i + 1] - td.cumS[i]); const j = i + 1; return { x: cl[i*3] + (cl[j*3]-cl[i*3])*u, y: cl[i*3+1] + (cl[j*3+1]-cl[i*3+1])*u, z: cl[i*3+2] + (cl[j*3+2]-cl[i*3+2])*u, yaw: Math.atan2(cl[j*3]-cl[i*3], cl[j*3+2]-cl[i*3+2]) }; };
        const p0 = at(from - 150);
        v.place(p0.x, p0.y + 0.4, p0.z, p0.yaw);
        v.frozen = false;
        const ai = new AiDriver(td, v, 0.85, 0);
        const orig = v.step.bind(v);
        let hint = -1;
        const sOf = (x, z) => { let best = 1e18, bi = hint; const full = hint < 0; for (let k = full ? 0 : -60; k <= (full ? n - 1 : 60); k++) { const i = full ? k : ((hint + k) % n + n) % n; const dx = cl[i*3]-x, dz = cl[i*3+2]-z; const d = dx*dx+dz*dz; if (d < best) { best = d; bi = i; } } hint = bi; return td.cumS[bi]; };
        v.step = (dt, c) => {
          const t = v.body.translation(), lv = v.body.linvel();
          const s = sOf(t.x, t.z);
          const ctl = ai.update(dt, true, 1, undefined, kmh / 3.6);
          const look = Math.min(22, Math.max(6, Math.hypot(lv.x, lv.z) * 0.45));
          const q = at(s + look);
          const tx = q.x + Math.cos(q.yaw) * lane - t.x, tz = q.z - Math.sin(q.yaw) * lane - t.z;
          let fx = lv.x, fz = lv.z; const sp = Math.hypot(fx, fz); if (sp < 3) { fx = Math.sin(q.yaw); fz = Math.cos(q.yaw); } else { fx /= sp; fz /= sp; }
          const cross = fx * tz - fz * tx; const ang = Math.atan2(-cross, fx * tx + fz * tz);
          c.throttle = ctl.throttle; c.brake = ctl.brake; c.handbrake = 0; c.digital = false;
          // AI_LINE: the AI drives its own racing line (no lateral offset of ours)
          c.steer = AI_LINE ? ctl.steer : Math.max(-1, Math.min(1, ang * 2.2));
          orig(dt, c);
        };
        const out = { worstRoll: 0, worstS: 0, maxVy: 0, rows: [], bounce: 0, bounceS: 0, rock: 0, rockS: 0, rocks: [] };
        let lastVy = null;
        const iv = setInterval(() => {
          const t = v.body.translation(), r = v.body.rotation(), lv = v.body.linvel();
          const s = sOf(t.x, t.z);
          // the body's side axis (x) height: sin(roll)
          const sideY = 2 * (r.x * r.y + r.w * r.z);
          const roll = Math.abs(Math.asin(Math.max(-1, Math.min(1, sideY)))) * 180 / Math.PI;
          if (s >= from && s <= to) {
            if (roll > out.worstRoll) { out.worstRoll = roll; out.worstS = s; }
            out.maxVy = Math.max(out.maxVy, Math.abs(lv.y));
            // bounce: how sharply the vertical speed changes between samples (0.1 s), the hill's own descent cancels out
            if (lastVy !== null) { const j = Math.abs(lv.y - lastVy); if (j > out.bounce) { out.bounce = j; out.bounceS = s; } }
            lastVy = lv.y;
            // rocking: the body's turning rate other than about its own vertical (pitch and roll rates, deg/s)
            const w = v.body.angvel();
            const ux = 2 * (r.x * r.y - r.w * r.z), uy = 1 - 2 * (r.x * r.x + r.z * r.z), uz = 2 * (r.y * r.z + r.w * r.x);
            const wu = w.x * ux + w.y * uy + w.z * uz;
            const rock = Math.sqrt(Math.max(0, w.x * w.x + w.y * w.y + w.z * w.z - wu * wu)) * 180 / Math.PI;
            if (rock > out.rock) { out.rock = rock; out.rockS = s; }
            out.rocks.push([Math.round(s), rock]);
            const fr = at(s);
            const latNow = (t.x - fr.x) * Math.cos(fr.yaw) - (t.z - fr.z) * Math.sin(fr.yaw);
            const surf = v.wheels.map((w) => (w.contact ? (w.surface ?? '?')[0] : '-')).join('');
            out.rows.push([Math.round(s), Math.round(Math.hypot(lv.x, lv.z) * 3.6), +roll.toFixed(1), +lv.y.toFixed(2), 'lat ' + latNow.toFixed(1), surf]);
          }
          if (s > to + 10 && out.rows.length > 5) { clearInterval(iv); v.step = orig; resolve(out); }
          if (out.rows.length > 4000) { clearInterval(iv); v.step = orig; resolve(out); }
        }, 100);
        setTimeout(() => { clearInterval(iv); v.step = orig; resolve(out); }, 170000);
      }),
    [FROM, TO, lane, KMH, AI_LINE_ENV],
  );
  console.log(`lane ${lane}: worst roll ${res.worstRoll.toFixed(1)} deg at s=${Math.round(res.worstS)}, biggest jump in vertical speed ${res.bounce.toFixed(2)} m/s per 0.1 s at s=${Math.round(res.bounceS)}, rocking up to ${res.rock.toFixed(1)} deg/s at s=${Math.round(res.rockS)}, ${res.rows.length} samples`);
  // rocking per 50 m: where the car is unsettled
  const per = new Map();
  for (const [s, k] of res.rocks) { const b = Math.floor(s / 50) * 50; per.set(b, Math.max(per.get(b) ?? 0, k)); }
  console.log('  rocking per 50 m (deg/s): ' + [...per].sort((a, b) => a[0] - b[0]).map(([b, k]) => `${b}:${k.toFixed(0)}`).join(' '));
  if (process.env.ROWS) console.log(res.rows.filter((_, i) => i % 3 === 0).map((r) => r.join(' ')).join('\n'));
  await page.close();
}
await browser.close();
