#!/usr/bin/env node
/**
 * Eifel forest scatter: places the procedural forest (apps/client/src/game/forest.ts) on the map's terrain.
 *
 *   node tools/asset-pipeline/forest_scatter.mjs [--map nurburgring] [--margin 1300] [--band <m>] [--spacing 4.6] [--res 2]
 *
 * Runs after `optimize` on the shipped assets (track.json + map_terrain/track/scenery/fill GLBs) in headless Chromium:
 *  1. renders the terrain top-down: colour (the satellite photo) and height;
 *  2. renders everything man-made (track, run-off, buildings, hole fill) as an exclusion mask;
 *  3. forest = dark, green satellite pixels (smoothed over ~10 m); spruce vs beech from the photo's hue and a stand noise;
 *  4. a jittered grid (`--spacing` m) keeps a tree where the smoothed forest share wins a coin flip, so stands get soft
 *     edges and a few hedgerow trees stand in the fields.
 * `--band` (or the map's "forestBand") keeps trees within that distance of the lap line only (long tracks).
 * Writes public/assets/<map assets>/forest.bin (8 bytes per tree, sorted by 128 m cells) + forest.json, a debug image
 * in tools/asset-pipeline/out/<map out>/debug_forest.png, and adds `forest` to the map's layout JSONs.
 * Chromium: Playwright's, or CHROMIUM_PATH=/path/to/chrome.
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
const MAP = JSON.parse(readFileSync(path.join(here, 'maps', `${opt('map', 'nurburgring')}.json`), 'utf8'));
const BAND = Number(opt('band', String(MAP.forestBand ?? 1e9)));
const MARGIN = Math.min(Number(opt('margin', '1300')), BAND);
const SPACING = Number(opt('spacing', '4.6'));
const CELL = 128;

// the map's layouts (track.json for the default GP, tracks/<id>.json for the others)
const index = JSON.parse(readFileSync(path.join(pub, 'assets/tracks.json'), 'utf8')).tracks.filter((t) => (t.map ?? 'nurburgring') === MAP.id);
const layoutPaths = index.map((t) => path.join(pub, t.file.replace(/\?.*$/, '')));
const track = JSON.parse(readFileSync(layoutPaths[0], 'utf8'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const PAGE = /* html */ `<!doctype html><html><body>
<script type="importmap">{"imports":{"three":"/apps/client/node_modules/three/build/three.module.js","three/addons/":"/apps/client/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
window.run = async (cfg) => {
  const r = new THREE.WebGLRenderer({ antialias: false });
  r.outputColorSpace = THREE.SRGBColorSpace;
  const ktx = new KTX2Loader().setTranscoderPath('/apps/client/public/libs/basis/').detectSupport(r);
  const loader = new GLTFLoader().setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
  const load = (u) => new Promise((res, rej) => loader.load(u, (g) => res(g.scene), undefined, rej));
  const [x0, z0, x1, z1] = cfg.rect;
  const W = Math.ceil((x1 - x0) / cfg.res), H = Math.ceil((z1 - z0) / cfg.res);
  // top-down orthographic camera: image x = +X, image row 0 = z0 (readPixels rows start at the bottom: flip below)
  const cam = new THREE.OrthographicCamera(x0, x1, -z0, -z1, 1, 20000);
  cam.position.set(0, 5000, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
  cam.left = x0; cam.right = x1; cam.top = -z0; cam.bottom = -z1; cam.updateProjectionMatrix();
  const read = (scene, float) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { type: float ? THREE.FloatType : THREE.UnsignedByteType, depthBuffer: true });
    if (!float) rt.texture.colorSpace = THREE.SRGBColorSpace; // photo pixels as stored (sRGB)
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, cam); r.setRenderTarget(null);
    const buf = float ? new Float32Array(W * H * 4) : new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf); rt.dispose();
    return buf;
  };
  // colour: the satellite photo, unlit (only the photo-textured terrain: corridors drawn with grass are masked out)
  const colorScene = new THREE.Scene();
  const terrain = new THREE.Group();
  for (const f of cfg.files.terrain) terrain.add(await load(f));
  terrain.updateMatrixWorld(true);
  // the photo is mapped planar on the terrain: fit uv = A·(x, z, 1) from the photo-textured meshes, then show the
  // photo on every terrain mesh (the Nordschleife corridor is drawn with grass but stands on the same photo)
  let photo = null;
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], atu = [0, 0, 0], atv = [0, 0, 0];
  const v3 = new THREE.Vector3();
  terrain.traverse((o) => {
    if (!o.isMesh || !/^top2/i.test(o.material.name) || !o.geometry.attributes.uv) return;
    photo = photo ?? o.material.map;
    const pos = o.geometry.attributes.position, uv = o.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i += 3) {
      v3.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const r = [v3.x, v3.z, 1];
      for (let a = 0; a < 3; a++) { atu[a] += r[a] * uv.getX(i); atv[a] += r[a] * uv.getY(i); for (let c = 0; c < 3; c++) ata[a][c] += r[a] * r[c]; }
    }
  });
  const solve = (A, b) => { const m = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < 3; i++) { let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k; [m[i], m[p]] = [m[p], m[i]]; for (let k = 0; k < 3; k++) if (k !== i) { const f = m[k][i] / m[i][i]; for (let c = i; c < 4; c++) m[k][c] -= f * m[i][c]; } } return m.map((r, i) => r[3] / r[i]); };
  const cu = solve(ata, atu), cv = solve(ata, atv);
  const photoMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { map: { value: photo }, cu: { value: new THREE.Vector3(...cu) }, cv: { value: new THREE.Vector3(...cv) } },
    vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'uniform sampler2D map; uniform vec3 cu; uniform vec3 cv; varying vec2 vW; void main(){ vec2 uv = vec2(dot(cu, vec3(vW,1.0)), dot(cv, vec3(vW,1.0))); gl_FragColor = vec4(texture2D(map, uv).rgb, 1.0); }' });
  terrain.traverse((o) => { if (o.isMesh) o.material = photoMat; });
  colorScene.add(terrain);
  const color = read(colorScene, false);
  // height: world Y of the top surface
  const hMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide,
    vertexShader: 'varying float vY; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying float vY; void main(){ gl_FragColor = vec4(vY, 1.0, 0.0, 1.0); }' });
  terrain.traverse((o) => { if (o.isMesh) o.material = hMat; });
  const height = read(colorScene, true);
  // man-made: everything in the track, scenery and fill files
  const maskScene = new THREE.Scene();
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  for (const f of cfg.files.mask) { const s = await load(f); s.traverse((o) => { if (o.isMesh) o.material = white; }); maskScene.add(s); }
  const mask = read(maskScene, false);
  return { W, H, colorB64: b64(color), heightB64: b64(new Uint8Array(height.buffer)), maskB64: b64(mask) };
};
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
window.ready = true;
</script></body></html>`;

const server = http
  .createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/__forest.html') return (res.writeHead(200, { 'Content-Type': 'text/html' }), res.end(PAGE));
    const f = path.join(root, u);
    if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) return (res.writeHead(404), res.end());
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' });
    createReadStream(f).pipe(res);
  })
  .listen(0);
const port = server.address().port;

const b = track.bounds;
const rect = [b.min[0] - MARGIN, b.min[2] - MARGIN, b.max[0] + MARGIN, b.max[2] + MARGIN];
// big maps: coarser rasters (the photo is ~9 m/px anyway)
const RES = Math.max(Number(opt('res', '2')), Math.ceil(Math.max(rect[2] - rect[0], rect[3] - rect[1]) / 4096));
const url = (f) => `/apps/client/public/${f.replace(/\?.*$/, '')}`;
const kindFiles = (kinds) => [...new Set(track.chunks.filter((c) => kinds.includes(c.kind)).map((c) => url(c.file)))];
const files = { terrain: kindFiles(['terrain']), mask: kindFiles(['track', 'scenery']) };

if (!existsSync(path.join(pub, 'libs/basis'))) {
  console.error('public/libs/basis missing: run `pnpm --filter @apex/client dev` (or build) once to copy the KTX2 transcoder');
  process.exit(1);
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page:', e));
await page.goto(`http://127.0.0.1:${port}/__forest.html`);
await page.waitForFunction(() => globalThis.ready);
console.log(`[forest] rendering ${Math.round(rect[2] - rect[0])} × ${Math.round(rect[3] - rect[1])} m at ${RES} m/px`);
const out = await page.evaluate((cfg) => globalThis.run(cfg), { rect, res: RES, files });
await browser.close();
server.close();

const W = out.W;
const H = out.H;
const flipRows = (buf, bpp) => {
  const o = new buf.constructor(buf.length);
  for (let y = 0; y < H; y++) o.set(buf.subarray((H - 1 - y) * W * bpp, (H - y) * W * bpp), y * W * bpp);
  return o;
};
const color = flipRows(new Uint8Array(Buffer.from(out.colorB64, 'base64')), 4);
const heightRaw = Buffer.from(out.heightB64, 'base64');
const height = flipRows(new Float32Array(heightRaw.buffer, heightRaw.byteOffset, heightRaw.length / 4), 4);
const mask = flipRows(new Uint8Array(Buffer.from(out.maskB64, 'base64')), 4);
// pixel (i, j) covers world x = x0 + (i + .5) * RES, z = z0 + (j + .5) * RES

// --- classification ---------------------------------------------------------------------------------------------
const N = W * H;
const forestRaw = new Float32Array(N);
const broadRaw = new Float32Array(N);
const built = new Uint8Array(N);
let hasTerrain = 0;
for (let p = 0; p < N; p++) {
  const r = color[p * 4] / 255;
  const g = color[p * 4 + 1] / 255;
  const bl = color[p * 4 + 2] / 255;
  const a = color[p * 4 + 3];
  if (a < 128) continue; // off the terrain
  hasTerrain++;
  const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
  // Eifel forest on the photo: dark (shadowed canopy) and green-dominant; fields/meadows are brighter, roads grey
  const greenish = (g >= r * 0.92 && g >= bl * 0.95) || lum < 0.11;
  const dark = 1 - smooth(0.13, 0.24, lum);
  forestRaw[p] = greenish ? dark : dark * 0.25;
  // deciduous canopy is a lighter, yellower green than spruce
  broadRaw[p] = smooth(0.0, 0.05, g - bl) * smooth(0.1, 0.19, lum);
  built[p] = mask[p * 4] > 127 ? 1 : 0;
}
function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
// box blur (separable) over ~10 m: forest share around each point
function blur(src, rad) {
  const tmp = new Float32Array(N);
  const dst = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = -rad; x <= rad; x++) s += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s / (2 * rad + 1);
      s += src[y * W + Math.min(W - 1, x + rad + 1)] - src[y * W + Math.max(0, x - rad)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -rad; y <= rad; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      dst[y * W + x] = s / (2 * rad + 1);
      s += tmp[Math.min(H - 1, y + rad + 1) * W + x] - tmp[Math.max(0, y - rad) * W + x];
    }
  }
  return dst;
}
const rad = Math.max(1, Math.round(5 / RES));
const forest = blur(forestRaw, rad);
const broad = blur(broadRaw, rad * 2);
// keep-out: man-made footprint grown by 5 m (no trees through fences, roofs or run-off)
const builtNear = blur(Float32Array.from(built), Math.max(1, Math.round(5 / RES)));

// keep-out around the racing line itself (safety: never on the road even where the mask has holes)
const cl = track.centerline;
const nCl = cl.length / 3;
const clGrid = new Map();
const G = 64;
for (let i = 0; i < nCl; i++) {
  const k = `${Math.floor(cl[i * 3] / G)},${Math.floor(cl[i * 3 + 2] / G)}`;
  if (!clGrid.has(k)) clGrid.set(k, []);
  clGrid.get(k).push(i);
}
function nearTrack(x, z, d) {
  const gx = Math.floor(x / G);
  const gz = Math.floor(z / G);
  for (let a = -1; a <= 1; a++)
    for (let c = -1; c <= 1; c++)
      for (const i of clGrid.get(`${gx + a},${gz + c}`) ?? []) {
        const w = Math.max(track.widthL[i], track.widthR[i]) + d;
        if ((cl[i * 3] - x) ** 2 + (cl[i * 3 + 2] - z) ** 2 < w * w) return true;
      }
  return false;
}

// distance to the lap line (chamfer distance transform), for --band
const band = new Float32Array(N).fill(1e9);
if (BAND < 1e8) {
  for (let i = 0; i < nCl; i++) {
    const a = Math.floor((cl[i * 3] - rect[0]) / RES);
    const c = Math.floor((cl[i * 3 + 2] - rect[1]) / RES);
    if (a >= 0 && c >= 0 && a < W && c < H) band[c * W + a] = 0;
  }
  const d1 = RES;
  const d2 = RES * Math.SQRT2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      let v = band[p];
      if (x > 0) v = Math.min(v, band[p - 1] + d1);
      if (y > 0) {
        v = Math.min(v, band[p - W] + d1);
        if (x > 0) v = Math.min(v, band[p - W - 1] + d2);
        if (x < W - 1) v = Math.min(v, band[p - W + 1] + d2);
      }
      band[p] = v;
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x;
      let v = band[p];
      if (x < W - 1) v = Math.min(v, band[p + 1] + d1);
      if (y < H - 1) {
        v = Math.min(v, band[p + W] + d1);
        if (x < W - 1) v = Math.min(v, band[p + W + 1] + d2);
        if (x > 0) v = Math.min(v, band[p + W - 1] + d2);
      }
      band[p] = v;
    }
}

// --- scatter ----------------------------------------------------------------------------------------------------
let seed = 20261021;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const noise2 = (x, z, f) => {
  const h = (i, j) => {
    let n = (i * 374761393 + j * 668265263) ^ 0x5bd1e995;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const fx = x / f;
  const fz = z / f;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  return (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv;
};
const [x0, z0] = rect;
const trees = [];
for (let z = z0 + SPACING / 2; z < rect[3]; z += SPACING)
  for (let x = x0 + SPACING / 2; x < rect[2]; x += SPACING) {
    const tx = x + (rnd() - 0.5) * SPACING * 0.9;
    const tz = z + (rnd() - 0.5) * SPACING * 0.9;
    const i = Math.floor((tx - x0) / RES);
    const j = Math.floor((tz - z0) / RES);
    if (i < 0 || j < 0 || i >= W || j >= H) continue;
    const p = j * W + i;
    if (color[p * 4 + 3] < 128 || built[p] || builtNear[p] > 0.02 || band[p] > BAND) continue;
    // forest share → probability; a thin 3 % of field points become hedgerow/solitary trees
    let prob = smooth(0.35, 0.75, forest[p]);
    if (prob < 0.03 && noise2(tx, tz, 23) > 0.82) prob = 0.04;
    if (rnd() >= prob) continue;
    if (nearTrack(tx, tz, 22)) continue;
    const y = height[p * 4];
    if (!(Math.abs(y) < 5000)) continue;
    // stands: spruce dominates (≈70 %), beech where the photo is lighter green and in noise patches
    const isBroad = broad[p] * 0.7 + noise2(tx, tz, 140) * 0.55 > 0.62 ? 1 : 0;
    // edge trees are smaller and fuller; deep stands taller
    const s = (isBroad ? 0.75 : 0.8) + 0.35 * smooth(0.5, 0.95, forest[p]) + (rnd() - 0.5) * 0.3;
    trees.push([tx, y, tz, Math.min(1.6, Math.max(0.45, s)), rnd(), isBroad]);
  }
console.log(`[forest] ${trees.length} trees (${((hasTerrain * RES * RES) / 1e6).toFixed(1)} km² of terrain scanned)`);

// --- pack: sorted by cell, 8 bytes per tree -----------------------------------------------------------------------
const nx = Math.ceil((rect[2] - x0) / CELL);
const nz = Math.ceil((rect[3] - z0) / CELL);
const cellOf = (t) => Math.floor((t[2] - z0) / CELL) * nx + Math.floor((t[0] - x0) / CELL);
trees.sort((a, b) => cellOf(a) - cellOf(b));
const buf = Buffer.alloc(trees.length * 8);
const cells = [];
let last = -1;
trees.forEach((t, k) => {
  const c = cellOf(t);
  if (c !== last) {
    cells.push([c, k, 0]);
    last = c;
  }
  cells[cells.length - 1][2]++;
  // uint16 x, z (0.2 m from the origin: 13 km), int16 y (0.05 m), uint8 scale (0..2.55), uint8 type<<7 | yaw (7 bits)
  buf.writeUInt16LE(Math.min(65535, Math.round((t[0] - x0) * 5)), k * 8);
  buf.writeUInt16LE(Math.min(65535, Math.round((t[2] - z0) * 5)), k * 8 + 2);
  buf.writeInt16LE(Math.round(t[1] * 20), k * 8 + 4);
  buf.writeUInt8(Math.round(t[3] * 100), k * 8 + 6);
  buf.writeUInt8((t[5] << 7) | Math.floor(t[4] * 127), k * 8 + 7);
});
if (Math.max(rect[2] - rect[0], rect[3] - rect[1]) > 13100) console.warn('[forest] map wider than the 13.1 km uint16 range: lower --margin');
const assetDir = path.join(pub, 'assets', MAP.assets);
writeFileSync(path.join(assetDir, 'forest.bin'), buf);
const ver = Date.now().toString(36);
const meta = { version: 2, cell: CELL, origin: [x0, z0], nx, nz, count: trees.length, cells };
writeFileSync(path.join(assetDir, 'forest.json'), JSON.stringify(meta));
const ref = { file: `assets/${MAP.assets}/forest.bin?v=${ver}`, meta: `assets/${MAP.assets}/forest.json?v=${ver}` };
for (const f of layoutPaths) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  j.forest = ref;
  writeFileSync(f, JSON.stringify(j));
}
console.log(
  `[forest] wrote ${path.relative(root, assetDir)}/forest.bin (${(buf.length / 1e6).toFixed(2)} MB, ${cells.length} cells) and updated ${layoutPaths.length} layout(s)`,
);

// --- debug image: photo, forest share (green), keep-out (red), trees (white) ------------------------------------------
try {
  const sharp = (await import('sharp')).default;
  const img = Buffer.alloc(W * H * 3);
  for (let p = 0; p < N; p++) {
    img[p * 3] = Math.min(255, color[p * 4] * 0.6 + built[p] * 140);
    img[p * 3 + 1] = Math.min(255, color[p * 4 + 1] * 0.6 + forest[p] * 90);
    img[p * 3 + 2] = color[p * 4 + 2] * 0.6;
  }
  for (const t of trees) {
    const p = Math.floor((t[2] - z0) / RES) * W + Math.floor((t[0] - x0) / RES);
    img[p * 3] = img[p * 3 + 1] = img[p * 3 + 2] = t[5] ? 200 : 255;
  }
  const dbgDir = path.join(here, 'out', MAP.out);
  mkdirSync(dbgDir, { recursive: true });
  await sharp(img, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toFile(path.join(dbgDir, 'debug_forest.png'));
  console.log(`[forest] debug image: ${path.relative(root, path.join(dbgDir, 'debug_forest.png'))}`);
} catch (e) {
  console.warn('[forest] no debug image:', e.message);
}
