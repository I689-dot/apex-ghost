#!/usr/bin/env node
/**
 * Generic signage: replaces real sponsor logos and brand advertising in a map's textures with invented,
 * generic boards (the game must not carry real brands). Rules live in maps/<id>.json under "signage":
 *
 *   { "match": "^adv2", "grid": [2, 8], "labels": ["APEX FUEL", …] }          every cell → its own background + a label
 *   { "match": "^building", "size": [256, 256], "panels": [{ "rect": [x0, y0, x1, y1], "label": "…", "bg": "#hex", "rotate": -90 }] }
 *   { "match": "^tuv", "size": [256, 128], "scrub": [[x0, y0, x1, y1], …] }  logo pixels inside the rects → background
 *   { "match": "^garage_spons", "scrub": "all" }
 *   { "match": "^details", "size": [128, 256], "fill": [[x0, y0, x1, y1], …] }    small logos → flat median colour
 *
 * `match` is tested against the texture's name and the names of the materials using it. Rectangles are in pixels of
 * `size` (the texture size the rule was written for) and scale with the actual image. "bg": "auto" (default) is the
 * rectangle's median colour; labels are drawn in white or near-black, whichever contrasts.
 *
 * Used by optimize.mjs (map step, on the source images before KTX2) and standalone on already shipped GLBs:
 *   node tools/asset-pipeline/signage.mjs --map nurburgring [--preview out/dir]
 * which decodes the KTX2 textures (KTX-Software's `ktx extract`), rewrites them and re-encodes them in place.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);
const KTX_DIR = process.env.KTX_DIR ?? path.join(homedir(), '.local/opt/ktx');
const ktxEnv = { ...process.env, LD_LIBRARY_PATH: `${path.join(KTX_DIR, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` };

const FONT = 'DejaVu Sans, Arial, Helvetica, sans-serif';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function median(px, w, [x0, y0, x1, y1]) {
  const ch = [[], [], []];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) ch[c].push(px[(y * w + x) * 4 + c]);
  return ch.map((a) => (a.sort((p, q) => p - q), a[a.length >> 1] ?? 0));
}

const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function fillRect(px, w, [x0, y0, x1, y1], c) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
    }
}

/** Logo pixels (coloured, or clearly darker/lighter than the background) inside the rect → background colour. */
function scrubRect(px, w, h, r) {
  const [x0, y0, x1, y1] = r;
  const bg = median(px, w, r);
  const lb = lum(bg);
  const mask = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * 4;
      const c = [px[o], px[o + 1], px[o + 2]];
      const mx = Math.max(...c);
      const mn = Math.min(...c);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      const d = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
      if ((sat > 0.3 && mx > 50 && d > 60) || Math.abs(lum(c) - lb) > 0.22) mask[y * w + x] = 1;
    }
  // grow by 1 px so anti-aliased edges go too
  for (let y = Math.max(0, y0 - 1); y < Math.min(h, y1 + 1); y++)
    for (let x = Math.max(0, x0 - 1); x < Math.min(w, x1 + 1); x++) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= x0 && xx < x1 && yy >= y0 && yy < y1 && mask[yy * w + xx] === 1) {
            hit = true;
            break;
          }
        }
      if (hit && x >= x0 && x < x1 && y >= y0 && y < y1) fillRect(px, w, [x, y, x + 1, y + 1], bg);
    }
}

function labelSvg([x0, y0, x1, y1], text, bg, rotate = 0) {
  const fg = lum(bg) > 0.55 ? '#1a1a1a' : '#f4f4f4';
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const vertical = Math.abs(rotate) === 90;
  const bw = (vertical ? y1 - y0 : x1 - x0) * 0.86;
  const bh = (vertical ? x1 - x0 : y1 - y0) * 0.62;
  const size = Math.max(4, Math.min(bh, (bw / Math.max(1, text.length)) * 1.6));
  return `<text x="${cx}" y="${cy}" transform="rotate(${rotate} ${cx} ${cy})" dominant-baseline="central" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="${size.toFixed(1)}" fill="${fg}" textLength="${Math.min(bw, size * text.length * 0.62).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(text)}</text>`;
}

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

/** Applies one rule to an encoded image (PNG/JPEG/WebP); returns PNG bytes. */
export async function applyRule(bytes, rule) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const [rw, rh] = rule.size ?? [w, h];
  const sc = ([a, b, c, d]) => [Math.round((a * w) / rw), Math.round((b * h) / rh), Math.round((c * w) / rw), Math.round((d * h) / rh)];
  const texts = [];
  let n = 0;
  if (rule.grid) {
    const [gx, gy] = rule.grid;
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) {
        const r = [Math.round((i * w) / gx), Math.round((j * h) / gy), Math.round(((i + 1) * w) / gx), Math.round(((j + 1) * h) / gy)];
        const bg = median(data, w, r);
        fillRect(data, w, r, bg);
        const label = rule.labels?.[n++ % rule.labels.length];
        if (label) texts.push(labelSvg(r, label, bg));
      }
  }
  for (const p of rule.panels ?? []) {
    const r = sc(p.rect);
    const bg = p.bg && p.bg !== 'auto' ? hex(p.bg) : median(data, w, r);
    fillRect(data, w, r, bg);
    if (p.label) texts.push(labelSvg(r, p.label, bg, p.rotate ?? 0));
  }
  for (const r of rule.fill ?? []) {
    const rr = sc(r);
    fillRect(data, w, rr, median(data, w, rr));
  }
  const scrub = rule.scrub === 'all' ? [[0, 0, rw, rh]] : (rule.scrub ?? []);
  for (const r of scrub) scrubRect(data, w, h, sc(r));
  let img = sharp(data, { raw: { width: w, height: h, channels: 4 } });
  if (texts.length)
    img = sharp(await img.png().toBuffer()).composite([
      { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${texts.join('')}</svg>`) },
    ]);
  return img.png().toBuffer();
}

export function ruleFor(tex, rules) {
  const names = [tex.getName(), ...tex.listParents().map((p) => p.getName?.() ?? '')].filter(Boolean);
  return rules.find((r) => names.some((n) => new RegExp(r.match, 'i').test(n)));
}

async function decodeKtx2(bytes, dir) {
  const src = path.join(dir, 'in.ktx2');
  const dst = path.join(dir, 'out.png');
  writeFileSync(src, bytes);
  rmSync(dst, { force: true });
  await run(path.join(KTX_DIR, 'bin/ktx'), ['extract', '--transcode', 'rgba8', src, dst], { env: ktxEnv });
  return readFileSync(dst);
}

async function encodeKtx2(png, dir) {
  const src = path.join(dir, 'enc.png');
  const dst = path.join(dir, 'enc.ktx2');
  writeFileSync(src, png);
  rmSync(dst, { force: true });
  // same settings as optimize.mjs compressTextures (colour → ETC1S)
  await run(
    path.join(KTX_DIR, 'bin/toktx'),
    ['--t2', '--genmipmap', '--assign_oetf', 'srgb', '--encode', 'etc1s', '--clevel', '2', '--qlevel', '160', dst, src],
    { env: ktxEnv },
  );
  return readFileSync(dst);
}

/**
 * Rewrites every matching texture of a glTF-Transform document. KTX2 images are decoded first and, when `reencode`
 * is set, encoded back to KTX2 (otherwise they stay PNG for a later compression pass). Returns the names changed.
 */
export async function applySignage(doc, rules, { reencode = false, preview = null } = {}) {
  if (!rules?.length) return [];
  const dir = mkdtempSync(path.join(tmpdir(), 'signage-'));
  const done = [];
  try {
    for (const tex of doc.getRoot().listTextures()) {
      const rule = ruleFor(tex, rules);
      if (!rule || !tex.getImage()) continue;
      const ktx = tex.getMimeType() === 'image/ktx2';
      const before = ktx ? await decodeKtx2(tex.getImage(), dir) : Buffer.from(tex.getImage());
      const after = await applyRule(before, rule);
      if (preview) {
        mkdirSync(preview, { recursive: true });
        const name = (tex.getName() || 'texture').replace(/[^\w.-]/g, '_');
        writeFileSync(path.join(preview, `${name}_before.png`), await sharp(before).png().toBuffer());
        writeFileSync(path.join(preview, `${name}_after.png`), after);
      }
      if (ktx && reencode) tex.setImage(await encodeKtx2(after, dir)).setMimeType('image/ktx2');
      else tex.setImage(after).setMimeType('image/png');
      done.push(tex.getName());
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return done;
}

/* ------------------------------------------------------------ CLI: shipped GLBs, in place --- */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { MeshoptDecoder, MeshoptEncoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
  const MAP = JSON.parse(readFileSync(path.join(here, 'maps', `${opt('map', 'nurburgring')}.json`), 'utf8'));
  const pub = path.join(here, '../../apps/client/public/assets', MAP.assets);
  const preview = opt('preview', null);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  for (const kind of ['track', 'scenery', 'trees', 'terrain']) {
    const file = path.join(pub, `map_${kind}.glb`);
    if (!existsSync(file)) continue;
    const doc = await io.read(file);
    const done = await applySignage(doc, MAP.signage, { reencode: true, preview });
    if (!done.length) continue;
    await io.write(file, doc);
    console.log(`[signage] map_${kind}.glb: ${done.join(', ')}`);
  }
}
