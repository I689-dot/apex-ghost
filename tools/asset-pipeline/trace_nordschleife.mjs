#!/usr/bin/env node
/**
 * Offline Nordschleife centreline from the GP map's own terrain (no downloads).
 *
 *   node tools/asset-pipeline/trace_nordschleife.mjs [--res 5] [--out tools/asset-pipeline/out/map_nordschleife/ns_trace.json]
 *
 * The satellite terrain of the GP map has the Nordschleife cut out of it (a channel ~20-40 m wide all the way round:
 * the source model left room for a road it never modelled). This tool renders the terrain top-down in headless
 * Chromium (coverage + height), keeps the holes inside the terrain, thins them to a 1-pixel skeleton (Zhang-Suen),
 * removes the GP's own hole and follows the skeleton from one GP junction to the other (shortest path, so spurs and
 * car parks are skipped). Heights come from the terrain on both banks of the channel.
 * Output (game metres): { points: [[x, y, z], …] } ordered from the junction that comes first on the GP lap.
 * build_nordschleife.py uses it with "source": "terrain" (maps/nordschleife.json); OSM stays the default source.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const pub = path.join(root, 'apps/client/public');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const RES = Number(opt('res', '5'));
const OUT = opt('out', path.join(here, 'out/map_nordschleife/ns_trace.json'));
const idx = JSON.parse(readFileSync(path.join(pub, 'assets/tracks.json'), 'utf8')).tracks;
const gpEntry = idx.find((t) => (t.map ?? 'nurburgring') === 'nurburgring' && t.default) ?? idx[0];
const gp = JSON.parse(readFileSync(path.join(pub, gpEntry.file.replace(/\?.*$/, '')), 'utf8'));
const terrainFiles = [...new Set(gp.chunks.filter((c) => c.kind === 'terrain').map((c) => `/apps/client/public/${c.file.replace(/\?.*$/, '')}`))];

const PAGE = /* html */ `<!doctype html><html><body>
<script type="importmap">{"imports":{"three":"/apps/client/node_modules/three/build/three.module.js","three/addons/":"/apps/client/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
window.run = async (cfg) => {
  const r = new THREE.WebGLRenderer();
  const ktx = new KTX2Loader().setTranscoderPath('/apps/client/public/libs/basis/').detectSupport(r);
  const loader = new GLTFLoader().setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
  const scene = new THREE.Scene();
  for (const f of cfg.files) scene.add((await loader.loadAsync(f)).scene);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const [x0, z0, x1, z1] = [box.min.x, box.min.z, box.max.x, box.max.z];
  const W = Math.ceil((x1 - x0) / cfg.res), H = Math.ceil((z1 - z0) / cfg.res);
  const cam = new THREE.OrthographicCamera(x0, x1, -z0, -z1, 1, 20000);
  cam.position.set(0, 5000, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
  cam.left = x0; cam.right = x1; cam.top = -z0; cam.bottom = -z1; cam.updateProjectionMatrix();
  const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide,
    vertexShader: 'varying float vY; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying float vY; void main(){ gl_FragColor = vec4(vY, 1.0, 0.0, 1.0); }' });
  scene.traverse((o) => { if (o.isMesh) o.material = mat; });
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
  r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, cam);
  const buf = new Float32Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  // one float per pixel: the height, NaN where there is no terrain
  const h = new Float32Array(W * H); for (let p = 0; p < W * H; p++) h[p] = buf[p * 4 + 3] > 0.5 ? buf[p * 4] : NaN;
  let s = ''; const u8 = new Uint8Array(h.buffer); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { W, H, x0, z0, b64: btoa(s) };
};
window.ready = true;
</script></body></html>`;

const server = http
  .createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/__trace.html') return (res.writeHead(200, { 'Content-Type': 'text/html' }), res.end(PAGE));
    const f = path.join(root, u);
    if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) return (res.writeHead(404), res.end());
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' });
    createReadStream(f).pipe(res);
  })
  .listen(0);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page:', e));
await page.goto(`http://127.0.0.1:${server.address().port}/__trace.html`);
await page.waitForFunction(() => globalThis.ready);
const out = await page.evaluate((c) => globalThis.run(c), { files: terrainFiles, res: RES });
await browser.close();
server.close();

const { W, H, x0, z0 } = out;
const raw = Buffer.from(out.b64, 'base64');
const f32 = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
// rows come bottom-up from readPixels: row j of the image = world z0 + j·RES after the flip
const N = W * H;
const cover = new Uint8Array(N);
const height = new Float32Array(N);
for (let j = 0; j < H; j++)
  for (let i = 0; i < W; i++) {
    const v = f32[(H - 1 - j) * W + i];
    cover[j * W + i] = Number.isNaN(v) ? 0 : 1;
    height[j * W + i] = v;
  }
const X = (i) => x0 + (i + 0.5) * RES;
const Z = (j) => z0 + (j + 0.5) * RES;
console.log(`[trace] terrain ${W}×${H} px at ${RES} m (${((W * RES) / 1000).toFixed(1)} × ${((H * RES) / 1000).toFixed(1)} km)`);

// 1. holes = uncovered pixels not connected to the image border
const outside = new Uint8Array(N);
const stack = [];
for (let i = 0; i < W; i++) stack.push(i, (H - 1) * W + i);
for (let j = 0; j < H; j++) stack.push(j * W, j * W + W - 1);
while (stack.length) {
  const p = stack.pop();
  if (outside[p] || cover[p]) continue;
  outside[p] = 1;
  const i = p % W;
  if (i > 0) stack.push(p - 1);
  if (i < W - 1) stack.push(p + 1);
  if (p >= W) stack.push(p - W);
  if (p < N - W) stack.push(p + W);
}
const hole = new Uint8Array(N);
for (let p = 0; p < N; p++) hole[p] = !cover[p] && !outside[p] ? 1 : 0;

// 2. Zhang-Suen thinning (only the hole pixels are visited)
const sk = hole.slice();
let live = [];
for (let p = 0; p < N; p++) {
  const i = p % W;
  if (sk[p] && i > 0 && i < W - 1 && p >= W && p < N - W) live.push(p);
}
const n8 = new Uint8Array(8);
let changed = true;
while (changed) {
  changed = false;
  for (const step of [0, 1]) {
    const kill = [];
    for (const p of live) {
      if (!sk[p]) continue;
      n8[0] = sk[p - W];
      n8[1] = sk[p - W + 1];
      n8[2] = sk[p + 1];
      n8[3] = sk[p + W + 1];
      n8[4] = sk[p + W];
      n8[5] = sk[p + W - 1];
      n8[6] = sk[p - 1];
      n8[7] = sk[p - W - 1];
      let b = 0;
      for (let k = 0; k < 8; k++) b += n8[k];
      if (b < 2 || b > 6) continue;
      let a = 0;
      for (let k = 0; k < 8; k++) if (!n8[k] && n8[(k + 1) % 8]) a++;
      if (a !== 1) continue;
      if (step === 0 ? n8[0] * n8[2] * n8[4] || n8[2] * n8[4] * n8[6] : n8[0] * n8[2] * n8[6] || n8[0] * n8[4] * n8[6]) continue;
      kill.push(p);
    }
    for (const p of kill) sk[p] = 0;
    if (kill.length) changed = true;
  }
  live = live.filter((p) => sk[p]);
}

// 3. remove the GP's own hole: skeleton pixels within 80 m of the GP lap line or pit lane
const gpPts = [];
for (let k = 0; k < gp.centerline.length / 3; k++) gpPts.push([gp.centerline[k * 3], gp.centerline[k * 3 + 2]]);
for (const p of gp.pitLane?.points ?? []) gpPts.push([p[0], p[2]]);
const nearGp = new Uint8Array(N);
const R = Math.ceil(80 / RES);
for (const [x, z] of gpPts) {
  const ci = Math.floor((x - x0) / RES);
  const cj = Math.floor((z - z0) / RES);
  for (let dj = -R; dj <= R; dj++)
    for (let di = -R; di <= R; di++) {
      if (di * di + dj * dj > R * R) continue;
      const i = ci + di;
      const j = cj + dj;
      if (i >= 0 && j >= 0 && i < W && j < H) nearGp[j * W + i] = 1;
    }
}
// junction candidates: skeleton pixels just outside the GP zone, touching it
const neigh8 = (p) => [p - W - 1, p - W, p - W + 1, p - 1, p + 1, p + W - 1, p + W, p + W + 1];
const junctions = [];
for (let p = 0; p < N; p++) if (sk[p] && !nearGp[p] && neigh8(p).some((q) => nearGp[q] && hole[q])) junctions.push(p);
console.log(`[trace] skeleton junction candidates at the GP: ${junctions.length}`);

// 4. BFS over the skeleton (outside the GP zone) between every pair of junctions; keep the longest of the shortest
// paths (the Nordschleife; other pairs are short service roads near the GP)
function bfs(from) {
  const prev = new Int32Array(N).fill(-2);
  prev[from] = -1;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const p = q[h];
    for (const r of neigh8(p))
      if (sk[r] && !nearGp[r] && prev[r] === -2) {
        prev[r] = p;
        q.push(r);
      }
  }
  return prev;
}
let best = null;
for (let a = 0; a < junctions.length; a++) {
  const prev = bfs(junctions[a]);
  for (let b = 0; b < junctions.length; b++) {
    if (b === a || prev[junctions[b]] === -2) continue;
    let len = 0;
    for (let p = junctions[b]; prev[p] !== -1; p = prev[p]) len++;
    if (!best || len > best.len) best = { a: junctions[a], b: junctions[b], len, prev };
  }
}
if (!best) {
  console.error('[trace] no channel connects back to the GP: is this the Nürburgring map?');
  process.exit(1);
}
const pathPx = [];
for (let p = best.b; p !== -1; p = best.prev[p]) pathPx.push(p);
pathPx.reverse();
console.log(`[trace] channel path: ${pathPx.length} px ≈ ${((pathPx.length * RES * 1.08) / 1000).toFixed(1)} km`);

// 5. smooth, resample, heights from both banks
let pts = pathPx.map((p) => [X(p % W), Z(Math.floor(p / W))]);
for (let it = 0; it < 30; it++)
  pts = pts.map((p, k) =>
    k === 0 || k === pts.length - 1 ? p : [(pts[k - 1][0] + 2 * p[0] + pts[k + 1][0]) / 4, (pts[k - 1][1] + 2 * p[1] + pts[k + 1][1]) / 4],
  );
// resample every 3 m along the arc
const cum = [0];
for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
const resampled = [];
for (let s = 0, k = 0; s <= cum[cum.length - 1]; s += 3) {
  while (k < cum.length - 2 && cum[k + 1] < s) k++;
  const u = (s - cum[k]) / (cum[k + 1] - cum[k] || 1);
  resampled.push([pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u]);
}
const bank = (x, z, dx, dz) => {
  for (let t = 4; t < 80; t += RES / 2) {
    const i = Math.floor((x + dx * t - x0) / RES);
    const j = Math.floor((z + dz * t - z0) / RES);
    if (i < 0 || j < 0 || i >= W || j >= H) return null;
    if (cover[j * W + i]) return height[j * W + i];
  }
  return null;
};
let ys = resampled.map((p, k) => {
  const a = resampled[Math.max(0, k - 1)];
  const b = resampled[Math.min(resampled.length - 1, k + 1)];
  let tx = b[0] - a[0];
  let tz = b[1] - a[1];
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  const h = [bank(p[0], p[1], tz, -tx), bank(p[0], p[1], -tz, tx)].filter((v) => v !== null);
  return h.length ? h.reduce((s, v) => s + v, 0) / h.length : NaN;
});
for (let k = 0; k < ys.length; k++) if (Number.isNaN(ys[k])) ys[k] = ys[k - 1] ?? ys.find((v) => !Number.isNaN(v));
// heights: running median (banks can be a cutting on one side) then a smooth
const med = ys.map((_, k) => {
  const w = ys.slice(Math.max(0, k - 6), k + 7).sort((p, q) => p - q);
  return w[w.length >> 1];
});
ys = med.map((_, k) => {
  let s = 0;
  let c = 0;
  for (let d = -5; d <= 5; d++) {
    const v = med[k + d];
    if (v !== undefined) {
      s += v;
      c++;
    }
  }
  return s / c;
});
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    source: 'terrain channel of the GP map',
    res: RES,
    points: resampled.map((p, k) => [+p[0].toFixed(2), +ys[k].toFixed(2), +p[1].toFixed(2)]),
  }),
);
console.log(`[trace] wrote ${path.relative(root, OUT)}: ${resampled.length} points, ${((resampled.length * 3) / 1000).toFixed(2)} km`);
