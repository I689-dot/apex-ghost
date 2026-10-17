#!/usr/bin/env node
/**
 * GPU performance profiling (dev builds): enters a race on the real GPU and measures fps
 * with individual features switched off to find the expensive ones.
 *
 *   node tools/e2e/profile.mjs [--quality medium] [--width 1920 --height 1080]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const URL = opt('url', 'http://127.0.0.1:5173');
const QUALITY = opt('quality', 'medium');
const W = Number(opt('width', '1920'));
const H = Number(opt('height', '1080'));

const browser = await chromium.launch({
  args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.addInitScript((q) => {
  localStorage.setItem(
    'apexghost.settings.v1',
    JSON.stringify({ nickname: 'Profiler', quality: q, qualityAuto: false, showPerf: true, dynamicResolution: false }),
  );
}, QUALITY);
await page.goto(URL);
await page.waitForSelector('.menu-card');
await page.click('button.primary:has-text("Create room")');
await page.waitForSelector('.car-card');
await page.click('.car-card >> nth=0');
await page.waitForTimeout(800);
await page.click('.lobby-actions button:has-text("Ready")');
await page.waitForTimeout(500);
await page.click('button:has-text("Start race")');
await page.waitForSelector('.race-ui', { timeout: 240_000 });
await page.waitForTimeout(7000);
// stay on the grid: a fixed (and busy) view makes experiments comparable
await page.waitForTimeout(3000);

async function measure(label, setup) {
  await page.evaluate(setup ?? (() => {}));
  await page.waitForTimeout(600);
  const r = await page.evaluate(
    () =>
      new Promise((res) => {
        const f = [];
        const t = { physics: 0, env: 0, other: 0, render: 0 };
        let last = performance.now();
        const start = last;
        window.__worst = null;
        const tick = (now) => {
          f.push(now - last);
          last = now;
          const tm = window.__timings;
          if (tm) for (const k in t) t[k] += tm[k];
          if (f.length > 3 && f[f.length - 1] > (window.__worst?.ms ?? 0)) window.__worst = { ms: f[f.length - 1], ...tm };
          if (now - start < 4000) requestAnimationFrame(tick);
          else res({ n: f.length, avg: f.reduce((a, b) => a + b, 0) / f.length, t: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / f.length])) });
        };
        requestAnimationFrame(tick);
      }),
  );
  const worst = await page.evaluate(() => window.__worst);
  const info = await page.evaluate(() => {
    const g = window.__apex?.gfx;
    return g ? { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles } : {};
  });
  console.log(
    `${label.padEnd(34)} ${(1000 / r.avg).toFixed(1).padStart(6)} fps  frame ${r.avg.toFixed(1)} ms  [phys ${r.t.physics.toFixed(1)} env ${r.t.env.toFixed(1)} other ${r.t.other.toFixed(1)} render ${r.t.render.toFixed(1)}]  draws ${info.calls} tris ${((info.tris ?? 0) / 1000).toFixed(0)}k  worst ${worst ? `${worst.ms.toFixed(0)} ms (phys ${worst.physics?.toFixed(0)} render ${worst.render?.toFixed(0)})` : '-'}`,
  );
}

const experiments = (process.env.EXP ?? 'features').split(',');
if (experiments.includes('features')) {
  await measure('baseline');
  await measure('shadows off', () => {
    const r = window.__apex.gfx.renderer;
    r.shadowMap.enabled = false;
    window.__apex.scene.traverse((o) => {
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
  });
  await measure('+ trees hidden', () => {
    for (const c of window.__apex.session.track.chunks) if (c.kind === 'trees') c.object.visible = false;
    window.__apex.session.track.updateVisibility = () => {};
  });
  await measure('+ scenery hidden', () => {
    for (const c of window.__apex.session.track.chunks) if (c.kind === 'scenery') c.object.visible = false;
  });
  await measure('+ post-processing off', () => {
    window.__apex.gfx.composer = null;
  });
}
if (experiments.includes('materials')) {
  await measure('baseline');
  await measure('override: MeshBasicMaterial', () => {
    window.__apex.scene.overrideMaterial = new window.__apex.THREE.MeshBasicMaterial({ color: 0x888888 });
  });
  await measure('override: MeshStandard (no maps)', () => {
    window.__apex.scene.overrideMaterial = new window.__apex.THREE.MeshStandardMaterial({ color: 0x888888 });
  });
  await measure('no override, car hidden', () => {
    window.__apex.scene.overrideMaterial = null;
    window.__apex.session.myVisual.object.visible = false;
  });
  await measure('only car (track hidden)', () => {
    window.__apex.session.myVisual.object.visible = true;
    window.__apex.session.track.root.visible = false;
  });
}
if (experiments.includes('textures')) {
  const info = await page.evaluate(() => {
    const T = window.__apex.THREE;
    const gl = window.__apex.gfx.renderer.getContext();
    const ext = [
      'EXT_texture_compression_bptc',
      'WEBGL_compressed_texture_s3tc',
      'WEBGL_compressed_texture_astc',
      'WEBGL_compressed_texture_etc',
      'WEBGL_compressed_texture_etc1',
    ].filter((e) => gl.getExtension(e));
    const seen = new Map();
    window.__apex.session.track.root.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
          const t = m[k];
          if (!t || seen.has(t.uuid)) continue;
          seen.set(t.uuid, {
            mat: m.name,
            slot: k,
            w: t.image?.width,
            h: t.image?.height,
            fmt: t.format,
            compressed: !!t.isCompressedTexture,
            mips: t.mipmaps?.length ?? 0,
            min: t.minFilter,
            gen: t.generateMipmaps,
            aniso: t.anisotropy,
          });
        }
      }
    });
    const list = [...seen.values()];
    const summary = {};
    for (const t of list) {
      const k = `${t.compressed ? 'compressed' : 'raw'} fmt=${t.fmt} mips=${t.mips > 1 ? 'yes' : 'NO'} min=${t.min} gen=${t.gen}`;
      summary[k] = (summary[k] ?? 0) + 1;
    }
    return { ext, count: list.length, summary, sample: list.slice(0, 5), LinearMipmapLinear: T.LinearMipmapLinearFilter, Linear: T.LinearFilter };
  });
  console.log(JSON.stringify(info, null, 1));
}
if (experiments.includes('bisect')) {
  const forMats = (fn) =>
    `window.__apex.scene.traverse((o) => { if (!o.material || o.isSky) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!m.isMeshStandardMaterial) continue; (${fn})(m); m.needsUpdate = true; } });`;
  await measure('baseline');
  await measure('no environment map', () => {
    window.__apex.scene.environment = null;
  });
  await page.evaluate(new Function(forMats('(m) => { m.side = 0; }')));
  await measure('+ front faces only', null);
  await page.evaluate(new Function(forMats('(m) => { m.normalMap = null; }')));
  await measure('+ no normal maps', null);
  await page.evaluate(new Function(forMats('(m) => { m.map = null; m.roughnessMap = null; m.metalnessMap = null; m.aoMap = null; m.emissiveMap = null; }')));
  await measure('+ no texture maps', null);
  await page.evaluate(() =>
    window.__apex.scene.traverse((o) => {
      if (o.isMesh) o.receiveShadow = false;
    }),
  );
  await measure('+ no shadow receiving', null);
  await page.evaluate(() => {
    window.__apex.scene.fog = null;
  });
  await measure('+ no fog', null);
  await page.evaluate(() => {
    const e = window.__apex.session.env;
    e.sky.visible = false;
    e.clouds.visible = false;
    e.update = () => {};
  });
  await measure('+ no sky/clouds', null);
}
if (experiments.includes('noise')) {
  for (let i = 0; i < 4; i++) await measure(`baseline #${i + 1}`);
}
if (experiments.includes('car')) {
  const carMats = (fn) =>
    `window.__apex.session.myVisual.object.traverse((o) => { if (!o.material) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { (${fn})(m, o); m.needsUpdate = true; } });`;
  await measure('baseline');
  await page.evaluate(new Function(carMats('(m, o) => { o.receiveShadow = false; }')));
  await measure('car: no shadow receiving', null);
  await page.evaluate(new Function(carMats('(m) => { m.envMap = null; }')));
  await measure('car: + no env map', null);
  await page.evaluate(new Function(carMats('(m) => { if (m.transparent) m.visible = false; }')));
  await measure('car: + transparent hidden', null);
  await page.evaluate(new Function(carMats('(m) => { m.side = 0; }')));
  await measure('car: + front faces only', null);
  await page.evaluate(new Function(carMats('(m) => { m.normalMap = null; }')));
  await measure('car: + no normal maps', null);
  const counts = await page.evaluate(() => {
    let tr = 0,
      op = 0,
      ds = 0;
    window.__apex.session.myVisual.object.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.transparent) tr++;
        else op++;
      }
    });
    return { tr, op, ds };
  });
  console.log('car materials', JSON.stringify(counts));
}
if (experiments.includes('lights')) {
  await measure('baseline');
  await measure('headlight spots hidden', () => {
    for (const l of window.__apex.session.myVisual.headlights) l.visible = false;
  });
  await measure('+ hemisphere hidden', () => {
    window.__apex.session.env.hemi.visible = false;
  });
  await measure('restore spots', () => {
    for (const l of window.__apex.session.myVisual.headlights) l.visible = true;
    window.__apex.session.env.hemi.visible = true;
  });
}
if (experiments.includes('scale')) {
  for (const sc of [1, 0.85, 0.7]) {
    await measure(`resolution ×${sc}`, new Function(`window.__apex.gfx.renderer.setPixelRatio(${sc}); window.__apex.gfx.resize = () => {};`));
  }
}
if (experiments.includes('drive')) {
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 3; i++) await measure(`driving #${i + 1}`);
  await page.keyboard.up('KeyW');
}
if (experiments.includes('trace')) {
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,v8.gc,disabled-by-default-devtools.timeline,gpu', transferMode: 'ReportEvents' });
  await page.waitForTimeout(6000);
  await cdp.send('Tracing.end');
  await done;
  const long = events.filter((e) => e.ph === 'X' && e.dur > 60_000).sort((a, b) => b.dur - a.dur);
  const byName = {};
  for (const e of long) {
    const k = `${e.cat} :: ${e.name}`;
    byName[k] ??= { n: 0, total: 0, max: 0 };
    byName[k].n++;
    byName[k].total += e.dur / 1000;
    byName[k].max = Math.max(byName[k].max, e.dur / 1000);
  }
  console.log('events > 60 ms in 6 s:');
  for (const [k, v] of Object.entries(byName)
    .sort((a, b) => b[1].max - a[1].max)
    .slice(0, 25))
    console.log(`  ${k.padEnd(70)} n=${v.n} max=${v.max.toFixed(0)}ms total=${v.total.toFixed(0)}ms`);
  const gc = events.filter((e) => /GC|Scavenge|MarkCompact/i.test(e.name) && e.dur);
  console.log(
    'GC events',
    gc.length,
    'total ms',
    (gc.reduce((a, e) => a + e.dur, 0) / 1000).toFixed(0),
    'max ms',
    (Math.max(0, ...gc.map((e) => e.dur)) / 1000).toFixed(0),
  );
}
if (experiments.includes('lap')) {
  const len = await page.evaluate(() => window.__apex.session.track.data.length);
  for (let d = 0; d < len; d += 400) {
    await page.evaluate((dist) => {
      const s = window.__apex.session;
      const pt = { x: 0, y: 0, z: 0, yaw: 0 };
      s.track.pointAt(dist, pt);
      s.vehicle.place(pt.x, pt.y + 0.5, pt.z, pt.yaw);
    }, d);
    await page.waitForTimeout(1500);
    await measure(`at ${String(d).padStart(4)} m`);
  }
}
await browser.close();
