#!/usr/bin/env node
/**
 * Optimisation stage (gltf-transform + meshoptimizer + toktx):
 *   cars → apps/client/public/assets/cars/<id>/lod{0,1,2}.glb + thumb.webp, cars.json
 *   map  → apps/client/public/assets/<map assets dir>/*.glb, collision.apxc, the layout JSONs (one map per run:
 *          --map <id>, configured in maps/<id>.json; default the Nürburgring)
 *   shared → packages/shared/src/generated/{track-race,car-ids}.json (server validation data)
 *
 * Budgets: car LOD0 ≤ 100k triangles, textures ≤ 2048 px (colour) / 1024 px (data); LOD1 ≈ 28k; LOD2 ≈ 7k.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, simplifyPrimitive, meshopt, listTextureSlots, compactPrimitive, normals } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { homedir, tmpdir, cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fillHoles, fillTerrain, groundPartsFromGlb, writeFillGlb } from './fill_holes.mjs';
import { snapStackedLayers } from './flatten_layers.mjs';
import { trackLimitsFromLines } from './track_limits.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'out');
const pub = path.join(root, 'apps/client/public/assets');
const sharedGen = path.join(root, 'packages/shared/src/generated');
const KTX_DIR = process.env.KTX_DIR ?? path.join(homedir(), '.local/opt/ktx');
const TOKTX = process.env.TOKTX ?? path.join(KTX_DIR, 'bin/toktx');
const ktxEnv = { ...process.env, LD_LIBRARY_PATH: `${path.join(KTX_DIR, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` };
const HAVE_KTX = existsSync(TOKTX);

const args = process.argv.slice(2);
const carFilter = args.includes('--car') ? args[args.indexOf('--car') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const MAP = loadMapConfig(args.includes('--map') ? args[args.indexOf('--map') + 1] : 'nurburgring');

/** maps/<id>.json: source model, output and asset folders, layouts (turns, file names), map-specific fixes. */
function loadMapConfig(id) {
  const f = path.join(here, 'maps', `${id}.json`);
  if (!existsSync(f)) throw new Error(`unknown map ${id} (no ${f})`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

const log = (...a) => console.log('[opt]', ...a);
/** Cache-busting stamp appended to every asset URL (assets are served as immutable). */
const V = `?v=${Date.now().toString(36)}`;
const tmpRoot = path.join(tmpdir(), `apex-opt-${process.pid}`);
mkdirSync(tmpRoot, { recursive: true });

/* ------------------------------------------------------------ helpers --- */

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (q.length) await fn(q.shift());
    }),
  );
}

function triCount(doc) {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      t += idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
    }
  return Math.round(t);
}

/** 1×1 placeholder textures become plain material factors (fewer textures, fewer samplers). */
async function inlineTinyTextures(doc) {
  let n = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    const slots = [
      ['baseColorTexture', () => mat.getBaseColorTexture(), (t) => mat.setBaseColorTexture(t)],
      ['metallicRoughnessTexture', () => mat.getMetallicRoughnessTexture(), (t) => mat.setMetallicRoughnessTexture(t)],
      ['emissiveTexture', () => mat.getEmissiveTexture(), (t) => mat.setEmissiveTexture(t)],
      ['normalTexture', () => mat.getNormalTexture(), (t) => mat.setNormalTexture(t)],
      ['occlusionTexture', () => mat.getOcclusionTexture(), (t) => mat.setOcclusionTexture(t)],
    ];
    for (const [slot, get, set] of slots) {
      const tex = get();
      if (!tex || !tex.getImage()) continue;
      let meta;
      try {
        meta = await sharp(Buffer.from(tex.getImage())).metadata();
      } catch {
        continue;
      }
      if ((meta.width ?? 99) > 4 || (meta.height ?? 99) > 4) continue;
      const { data } = await sharp(Buffer.from(tex.getImage())).resize(1, 1).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const px = [data[0] / 255, data[1] / 255, data[2] / 255, data[3] / 255];
      const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      if (slot === 'baseColorTexture') {
        const f = mat.getBaseColorFactor();
        mat.setBaseColorFactor([f[0] * lin(px[0]), f[1] * lin(px[1]), f[2] * lin(px[2]), f[3] * px[3]]);
      } else if (slot === 'metallicRoughnessTexture') {
        mat.setRoughnessFactor(mat.getRoughnessFactor() * px[1]);
        mat.setMetallicFactor(mat.getMetallicFactor() * px[2]);
      } else if (slot === 'emissiveTexture') {
        const f = mat.getEmissiveFactor();
        mat.setEmissiveFactor([f[0] * lin(px[0]), f[1] * lin(px[1]), f[2] * lin(px[2])]);
      }
      set(null);
      n++;
    }
  }
  return n;
}

const GLASS_NAME_RE = /glass|window|windscreen|windshield|visor|lexan|clear|perspex/i;

/**
 * Blender exports any material whose texture has an alpha channel as BLEND, including body paint
 * and interior atlases. Only glass should blend; everything else is OPAQUE (alpha unused) or MASK
 * (real cut-outs such as decals, grilles and stickers), decided from the texture's actual alpha.
 */
async function fixAlphaModes(doc) {
  const changed = [];
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getAlphaMode() !== 'BLEND') continue;
    const name = mat.getName();
    const tex = mat.getBaseColorTexture();
    const factor = mat.getBaseColorFactor();
    // share of clearly transparent texels (atlas padding is a few %, decals and grilles far more)
    let transparent = 0;
    if (tex?.getImage()) {
      try {
        const { data } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().resize(256, 256, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] < 128) n++;
        transparent = n / (data.length / 4);
      } catch {
        /* unreadable: treat as opaque */
      }
    }
    if (GLASS_NAME_RE.test(name) && !name.startsWith('LIGHT_')) {
      // glass stays blended; glass that is fully opaque in the source becomes see-through
      if (transparent < 0.01 && factor[3] > 0.97) {
        mat.setBaseColorFactor([factor[0], factor[1], factor[2], 0.25]);
        changed.push(`${name}→see-through`);
      }
      continue;
    }
    if (factor[3] < 0.97 && !tex) continue; // uniformly translucent plastic: keep blending
    if (transparent < 0.08) {
      mat.setAlphaMode('OPAQUE');
      changed.push(`${name}→opaque`);
    } else {
      mat.setAlphaMode('MASK').setAlphaCutoff(0.5);
      changed.push(`${name}→mask`);
    }
  }
  return changed;
}

function floorPow2(n) {
  return 2 ** Math.floor(Math.log2(Math.max(1, n)));
}

/**
 * Encode every texture to KTX2 (Basis Universal). Colour → ETC1S (small), normal maps → UASTC (quality).
 * Sizes are clamped to powers of two within maxColor/maxData.
 */
async function compressTextures(doc, { maxColor, maxData, tag }) {
  if (!HAVE_KTX) {
    log('toktx not found: textures will be WebP');
    return toWebp(doc, { maxColor, maxData });
  }
  const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true);
  void basisu;
  const textures = doc.getRoot().listTextures();
  const dir = path.join(tmpRoot, tag);
  mkdirSync(dir, { recursive: true });
  let i = 0;
  await pool(textures, Math.max(2, cpus().length - 2), async (tex) => {
    const img = tex.getImage();
    if (!img || tex.getMimeType() === 'image/ktx2') return;
    const id = i++;
    const slots = listTextureSlots(tex);
    const isNormal = slots.includes('normalTexture');
    const isColor = slots.some((s) => s === 'baseColorTexture' || s === 'emissiveTexture');
    const max = isColor ? maxColor : maxData;
    const meta = await sharp(Buffer.from(img)).metadata();
    const w = Math.min(max, floorPow2(meta.width ?? 4));
    const h = Math.min(max, floorPow2(meta.height ?? 4));
    const src = path.join(dir, `${id}.png`);
    await sharp(Buffer.from(img)).resize(w, h, { fit: 'fill' }).png().toFile(src);
    const dst = path.join(dir, `${id}.ktx2`);
    const common = ['--t2', '--genmipmap', '--assign_oetf', isColor ? 'srgb' : 'linear'];
    const enc = isNormal
      ? ['--encode', 'uastc', '--uastc_quality', '1', '--uastc_rdo_l', '2', '--zcmp', '19']
      : ['--encode', 'etc1s', '--clevel', '2', '--qlevel', isColor ? '160' : '110'];
    // basisu occasionally hits an encoder assertion for a given quality level: retry with others
    const attempts = isNormal
      ? [enc]
      : [
          enc,
          enc.map((a) => (a === '160' || a === '110' ? '128' : a)),
          enc.map((a) => (a === '160' || a === '110' ? '192' : a)),
          enc.map((a) => (a === '160' || a === '110' ? '96' : a)),
        ];
    let ok = false;
    for (const e of attempts) {
      try {
        await run(TOKTX, [...common, ...e, dst, src], { env: ktxEnv });
        ok = true;
        break;
      } catch {
        /* try the next setting */
      }
    }
    if (ok) {
      tex.setImage(readFileSync(dst)).setMimeType('image/ktx2');
      if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(png|jpe?g|webp)$/i, '.ktx2'));
    } else {
      log(`toktx failed for ${tex.getName() || 'texture'} (${tag}), using WebP`);
      const webp = await sharp(Buffer.from(img)).resize(w, h, { fit: 'fill' }).webp({ quality: 82 }).toBuffer();
      tex.setImage(webp).setMimeType('image/webp');
      doc.createExtension(EXTTextureWebP);
    }
  });
}

async function toWebp(doc, { maxColor, maxData }) {
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const isColor = listTextureSlots(tex).some((s) => s === 'baseColorTexture' || s === 'emissiveTexture');
    const max = isColor ? maxColor : maxData;
    const meta = await sharp(Buffer.from(img)).metadata();
    const w = Math.min(max, meta.width ?? 4);
    const h = Math.min(max, meta.height ?? 4);
    const webp = await sharp(Buffer.from(img)).resize(w, h, { fit: 'fill' }).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
    tex.setImage(webp).setMimeType('image/webp');
  }
  doc.createExtension(EXTTextureWebP).setRequired(true);
}

/** Merge vertices that share a position (ignoring normals/UVs) so triangle soups can be simplified. */
function positionWeld(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      const pos = posAcc.getArray();
      const n = posAcc.getCount();
      const idxAcc = prim.getIndices();
      const idx = idxAcc ? idxAcc.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
      const map = new Map();
      const remap = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        const k = `${Math.round(pos[i * 3] * 4000)}|${Math.round(pos[i * 3 + 1] * 4000)}|${Math.round(pos[i * 3 + 2] * 4000)}`;
        let j = map.get(k);
        if (j === undefined) map.set(k, (j = i));
        remap[i] = j;
      }
      const out = [];
      for (let t = 0; t < idx.length; t += 3) {
        const a = remap[idx[t]];
        const b = remap[idx[t + 1]];
        const c = remap[idx[t + 2]];
        if (a !== b && b !== c && a !== c) out.push(a, b, c);
      }
      const acc = idxAcc ?? doc.createAccessor().setType('SCALAR').setBuffer(posAcc.getBuffer());
      acc.setArray(new Uint32Array(out));
      prim.setIndices(acc);
      compactPrimitive(prim);
    }
  }
}

/** Simplify until the triangle budget is met, raising the error bound gradually. */
async function simplifyTo(doc, target, { allowWeld = false, maxError = 0.01, lockBorder = false } = {}) {
  let tris = triCount(doc);
  for (let pass = 0; pass < 2 && tris > target * 1.03; pass++) {
    let error = 0.0004;
    // never exceed maxError (fraction of mesh size): better a few more triangles than shredded panels
    while (tris > target && error <= maxError) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, target / tris), error, lockBorder }));
      tris = triCount(doc);
      error *= 2;
    }
    if (tris > target * 1.03 && allowWeld && pass === 0) positionWeld(doc);
    else break;
  }
  return tris;
}

const INTERIOR_MAT_RE =
  /(^|[_\s.])(int|interior|cockpit|seat|steer|dash|belt|pedal|display|dispaly|gauge|roll_?cage|sparco|cables?|electronics|harness|mangueira|borracha)/i;

/** Distant LODs never show the cabin: drop interior primitives and the steering wheel. */
function dropInterior(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      if (INTERIOR_MAT_RE.test(prim.getMaterial()?.getName() ?? '')) {
        prim.dispose();
        n++;
      }
    }
  for (const node of doc.getRoot().listNodes()) if (node.getName().startsWith('steering_wheel')) node.dispose();
  return n;
}

/** Drop primitives smaller than `minSize` metres (distant LODs). */
function dropTiny(doc, minSize) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const mn = pos.getMin([]);
      const mx = pos.getMax([]);
      const d = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
      if (d < minSize) {
        prim.dispose();
        n++;
      }
    }
  }
  return n;
}

async function finish(doc, file) {
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  mkdirSync(path.dirname(file), { recursive: true });
  await io.write(file, doc);
  return statSync(file).size;
}

/* --------------------------------------------------------------- cars --- */

function deepMerge(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (k.startsWith('_')) continue;
    o[k] = v;
  }
  return o;
}

async function cars() {
  const cfg = JSON.parse(readFileSync(path.join(here, 'cars.config.json'), 'utf8'));
  const carDir = path.join(out, 'cars');
  const ids = readdirSync(carDir)
    .filter((f) => f.endsWith('.glb'))
    .map((f) => f.slice(0, -4))
    .sort();
  const entries = [];
  const fallbackReport = [];
  const excluded = [];
  for (const id of ids) {
    const c = cfg.cars[id];
    if (!c) {
      log(`no config for ${id}, skipping`);
      continue;
    }
    if (c.exclude) {
      excluded.push({ id, reason: c.exclude });
      continue;
    }
    const meta = JSON.parse(readFileSync(path.join(carDir, `${id}.json`), 'utf8'));
    const dst = path.join(pub, 'cars', id);
    const lodFiles = ['lod0.glb', 'lod1.glb', 'lod2.glb'];
    let bytes = 0;
    const skip = carFilter && carFilter !== id;
    if (!skip) {
      log(`car ${id}`);
      const base = await io.read(path.join(carDir, `${id}.glb`));
      const tiny = await inlineTinyTextures(base);
      const alphaFix = await fixAlphaModes(base);
      if (alphaFix.length) log(`  alpha modes fixed: ${alphaFix.join(', ')}`);
      await base.transform(dedup(), weld());
      const srcTris = triCount(base);
      // LOD0
      const lod0 = await io.readBinary(await io.writeBinary(base));
      // LOD0 is seen from inside the cockpit: keep UV seams (borders) intact, never weld across them
      const t0 = await simplifyTo(lod0, 100_000, { maxError: 0.002, lockBorder: true });
      await compressTextures(lod0, { maxColor: 1024, maxData: 512, tag: `${id}-0` });
      const s0 = await finish(lod0, path.join(dst, lodFiles[0]));
      // COCKPIT: the player's own car, seen from the driver's seat for the whole race. Near the source detail
      // (switches, dials, steering-wheel buttons, stitching) and sharper textures; loaded for your car only.
      const lodC = await io.readBinary(await io.writeBinary(base));
      const tc = await simplifyTo(lodC, 400_000, { maxError: 0.0005, lockBorder: true });
      await compressTextures(lodC, { maxColor: 2048, maxData: 1024, tag: `${id}-c` });
      const sc = await finish(lodC, path.join(dst, 'cockpit.glb'));
      log(`  cockpit model: ${tc} tris (${(sc / 1e6).toFixed(2)} MB)`);
      // LOD1
      const lod1 = await io.readBinary(await io.writeBinary(base));
      dropInterior(lod1);
      dropTiny(lod1, 0.04);
      const t1 = await simplifyTo(lod1, 28_000, { maxError: 0.04, allowWeld: true });
      await compressTextures(lod1, { maxColor: 512, maxData: 256, tag: `${id}-1` });
      const s1 = await finish(lod1, path.join(dst, lodFiles[1]));
      // LOD2
      const lod2 = await io.readBinary(await io.writeBinary(base));
      dropInterior(lod2);
      dropTiny(lod2, 0.15);
      positionWeld(lod2);
      const t2 = await simplifyTo(lod2, 7_000, { maxError: 0.06 });
      await lod2.transform(normals({ overwrite: true }));
      await compressTextures(lod2, { maxColor: 128, maxData: 64, tag: `${id}-2` });
      const s2 = await finish(lod2, path.join(dst, lodFiles[2]));
      log(
        `  ${srcTris} tris (${tiny} tiny textures inlined) → LOD0 ${t0} (${(s0 / 1e6).toFixed(2)} MB), LOD1 ${t1} (${(s1 / 1e6).toFixed(2)} MB), LOD2 ${t2} (${(s2 / 1e6).toFixed(2)} MB)`,
      );
      // thumbnail
      await sharp(path.join(carDir, `${id}.png`))
        .resize(480, 270, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 85, alphaQuality: 90 })
        .toFile(path.join(dst, 'thumb.webp'));
    }
    for (const f of lodFiles) if (existsSync(path.join(dst, f))) bytes += statSync(path.join(dst, f)).size;
    const prof = c.profile ? cfg.profiles[c.profile] : {};
    const specs = deepMerge(prof, c.specs);
    if (meta.genericWheels.length) fallbackReport.push({ id, wheels: meta.genericWheels });
    entries.push({
      id,
      name: c.name,
      manufacturer: c.manufacturer,
      year: c.year ?? null,
      category: c.category,
      color: c.color ?? '#888888',
      thumbnail: `assets/cars/${id}/thumb.webp${V}`,
      lods: lodFiles.map((f) => `assets/cars/${id}/${f}${V}`),
      bytes,
      cockpit: existsSync(path.join(dst, 'cockpit.glb')) ? `assets/cars/${id}/cockpit.glb${V}` : null,
      cockpitBytes: existsSync(path.join(dst, 'cockpit.glb')) ? statSync(path.join(dst, 'cockpit.glb')).size : 0,
      dims: { length: meta.lengthM, width: meta.widthM, height: meta.heightM },
      wheels: Object.fromEntries(
        ['FL', 'FR', 'RL', 'RR'].map((k) => [k, { position: meta.wheels[k].position, radius: meta.wheels[k].radius, width: meta.wheels[k].width }]),
      ),
      wheelbase: meta.wheelbase,
      trackFront: meta.trackFront,
      trackRear: meta.trackRear,
      // hand-set in cars.config.json → pipeline (checked with tools/e2e/cockpitlab.mjs): the driver's eye
      // (cockpitEye), a steering wheel for a model without one (steering), an interior the detection missed
      steering: c.pipeline?.steering ?? meta.steering,
      cockpitCamera: c.pipeline?.cockpitEye ? { ...meta.cockpitCamera, position: c.pipeline.cockpitEye, tuned: true } : meta.cockpitCamera,
      hasInterior: c.pipeline?.hasInterior ?? meta.hasInterior,
      lights: meta.lights,
      genericWheels: meta.genericWheels,
      specs,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(path.join(pub, 'cars.json'), JSON.stringify({ version: 1, forward: '+Z', up: '+Y', units: 'm', cars: entries }, null, 1));
  mkdirSync(sharedGen, { recursive: true });
  writeFileSync(path.join(sharedGen, 'car-ids.json'), JSON.stringify(entries.map((e) => e.id)));
  writeFileSync(path.join(out, 'cars_report.json'), JSON.stringify({ fallbackReport, excluded }, null, 1));
  log(
    `cars.json: ${entries.length} cars; generic-wheel fallback: ${fallbackReport.map((f) => f.id).join(', ') || 'none'}; excluded: ${excluded.map((e) => e.id).join(', ') || 'none'}`,
  );
}

/* ---------------------------------------------------------------- map --- */

const HEAVY_RE =
  /^(galvanized|grail|fence|fences_b|details|metals|signs|marshal|gantry|lights_0|garage|handle|spons|speaker|box_fence|wall|tyrewall|grille|stairs|window_doors|openstand)/i;
const CUTOUT_RE = /^(tree|pines|trees_new|fence|fences_b|grille|box_fence|galvanized|net|glass_railing|spons_panels)/i;

/**
 * Grass and sand border strips (grassbrd_gp, sandbrd) fade out with alpha over ground the export does not
 * contain, so their transparent part showed the void (magenta in tools/e2e/trackscan.mjs) right along the track
 * edges. Flatten them onto the average colour of the ground they blend into and make them opaque.
 */
async function flattenBorderStrips(doc) {
  const mats = doc.getRoot().listMaterials();
  const meanOf = async (re) => {
    const m = mats.find((x) => re.test(x.getName()) && x.getBaseColorTexture());
    if (!m) return null;
    const st = await sharp(Buffer.from(m.getBaseColorTexture().getImage())).stats();
    return { r: Math.round(st.channels[0].mean), g: Math.round(st.channels[1].mean), b: Math.round(st.channels[2].mean) };
  };
  const ground = { grassbrd: await meanOf(/^grass_?0/i), sandbrd: await meanOf(/^sand_?0/i) };
  for (const m of mats) {
    const k = /^grassbrd/i.test(m.getName()) ? 'grassbrd' : /^sandbrd/i.test(m.getName()) ? 'sandbrd' : null;
    const tex = m.getBaseColorTexture();
    if (!k || !tex || !ground[k]) continue;
    const png = await sharp(Buffer.from(tex.getImage())).flatten({ background: ground[k] }).png().toBuffer();
    tex.setImage(new Uint8Array(png)).setMimeType('image/png');
    m.setAlphaMode('OPAQUE');
    log(`border strip ${m.getName()}: flattened onto ${JSON.stringify(ground[k])}, opaque`);
  }
}

async function map() {
  const mapOut = path.join(out, MAP.out);
  const dstDir = path.join(pub, MAP.assets);
  mkdirSync(dstDir, { recursive: true });
  const chunks = JSON.parse(readFileSync(path.join(mapOut, 'chunks.json'), 'utf8'));
  const files = {};
  for (const kind of ['track', 'scenery', 'trees', 'terrain']) {
    const src = path.join(mapOut, `map_${kind}.glb`);
    if (!existsSync(src)) continue;
    const doc = await io.read(src);
    await inlineTinyTextures(doc);
    if (kind === 'track') await flattenBorderStrips(doc);
    await doc.transform(dedup(), weld());
    const before = triCount(doc);
    if (kind === 'track' || kind === 'scenery') {
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const name = prim.getMaterial()?.getName() ?? '';
          if (!HEAVY_RE.test(name)) continue;
          // borders locked: free borders shrank away from the neighbouring mesh (kerb ↔ grass) and the sky showed through the cracks
          simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error: kind === 'track' ? 0.00025 : 0.0006, lockBorder: true });
        }
      }
    }
    // foliage and fences: alpha-tested, double sided (cheaper than blending, no sorting)
    for (const mat of doc.getRoot().listMaterials()) {
      if (CUTOUT_RE.test(mat.getName()) && mat.getAlphaMode() !== 'OPAQUE') {
        mat.setAlphaMode('MASK').setAlphaCutoff(0.45).setDoubleSided(true);
      }
    }
    // the terrain is one image over several km²: keep its full 2048 px (seen from the cinematic's aerial shots)
    await compressTextures(doc, { maxColor: kind === 'terrain' ? 2048 : 512, maxData: 256, tag: `map-${kind}` });
    const file = `map_${kind}.glb`;
    const size = await finish(doc, path.join(dstDir, file));
    files[kind] = file;
    log(`map ${kind}: ${before} → ${triCount(doc)} tris, ${(size / 1e6).toFixed(2)} MB`);
  }
  await collision(mapOut, dstDir);

  const base = `assets/${MAP.assets}`;
  await writeTracks(mapOut, {
    chunks: chunks.map((c) => ({ file: `${base}/${files[c.kind]}${V}`, node: c.name, center: c.center, radius: c.radius, kind: c.kind })),
    files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, `${base}/${f}${V}`])),
    collision: { file: `${base}/collision.apxc${V}`, surfaces: ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'] },
  });
}

/** Where a layout's JSON lives (public/assets/<file>): the map config can name it (the Nürburgring GP keeps track.json). */
const layoutFile = (id) => MAP.tracks?.[id]?.file ?? `tracks/${id}.json`;

/**
 * One JSON per layout (the GP and the alternatives traced on the same map), sharing the render chunks and the
 * collision mesh: public/assets/track.json (Nürburgring GP), public/assets/tracks/<id>.json, an index (tracks.json)
 * and the server's validation data (shared/generated/tracks-race.json). The index and the validation data hold
 * every map: this run replaces the entries of its own map and keeps the others.
 */
async function writeTracks(mapOut, render) {
  const bases = [JSON.parse(readFileSync(path.join(mapOut, 'track_base.json'), 'utf8'))];
  for (const f of readdirSync(mapOut)
    .filter((x) => /^track_base_.+\.json$/.test(x))
    .sort())
    bases.push(JSON.parse(readFileSync(path.join(mapOut, f), 'utf8')));
  const surf = roadSurface(mapOut);
  if (MAP.fixPitEntry) fixPitEntry(bases);
  for (const b of bases) fixHeights(b, surf);
  // track limits from the painted white lines (track_limits.mjs)
  const rawTrack = path.join(mapOut, 'map_track.glb');
  if (existsSync(rawTrack)) {
    const doc = await io.read(rawTrack);
    for (const b of bases) {
      const lim = trackLimitsFromLines(doc, b);
      b.limitL = lim.limitL;
      b.limitR = lim.limitR;
      log(`${b.id}: track limits from the white lines (${Math.round((lim.painted / (2 * lim.limitL.length)) * 100)} % painted)`);
    }
  }
  mkdirSync(path.join(pub, 'tracks'), { recursive: true });
  const index = [];
  const races = {};
  // the hole fill (fill_holes.mjs) is one more always-visible track chunk
  const fillInfo = existsSync(path.join(mapOut, 'fill.json')) ? JSON.parse(readFileSync(path.join(mapOut, 'fill.json'), 'utf8')) : null;
  if (fillInfo) {
    const url = `assets/${MAP.assets}/${fillInfo.file}${V}`;
    render = {
      ...render,
      chunks: [
        ...render.chunks.filter((c) => c.node !== 'chunk_fill'),
        { file: url, node: 'chunk_fill', center: fillInfo.center, radius: fillInfo.radius, kind: 'track' },
      ],
      files: { ...render.files, fill: url },
    };
  }
  bases.forEach((base, i) => {
    const track = { ...base, ...render };
    const file = layoutFile(base.id);
    writeFileSync(path.join(pub, file), JSON.stringify(track));
    index.push({
      id: base.id,
      name: base.name,
      length: base.length,
      turns: MAP.tracks?.[base.id]?.turns ?? null,
      file: `assets/${file}${V}`,
      default: !!MAP.default && i === 0,
      map: MAP.id,
    });
    races[base.id] = {
      id: base.id,
      name: base.name,
      length: base.length,
      centerline: base.centerline,
      cumS: base.cumS,
      gates: base.gates,
      sectorGates: base.sectorGates,
      firstGate: base.firstGate,
      minLapMs: base.minLapMs,
      pitExitS: base.pitLane ? base.pitLane.exitS : null,
    };
  });
  // merge with the other maps' layouts (entries without a map field are the Nürburgring's, from before maps/)
  const indexFile = path.join(pub, 'tracks.json');
  const prev = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')).tracks : [];
  const mapOf = (e) => e.map ?? 'nurburgring';
  const others = prev.filter((e) => mapOf(e) !== MAP.id && !index.some((n) => n.id === e.id));
  const merged = [...others, ...index].sort(
    (a, b) => Number(b.default) - Number(a.default) || Number(mapOf(a) !== 'nurburgring') - Number(mapOf(b) !== 'nurburgring'),
  );
  // keep each map's layouts together, in the order they were listed
  const order = [...new Set(merged.map(mapOf))];
  const all = order.flatMap((m) => merged.filter((e) => mapOf(e) === m));
  writeFileSync(indexFile, JSON.stringify({ tracks: all }));
  mkdirSync(sharedGen, { recursive: true });
  const racesFile = path.join(sharedGen, 'tracks-race.json');
  const prevRaces = existsSync(racesFile) ? JSON.parse(readFileSync(racesFile, 'utf8')) : {};
  const keep = Object.fromEntries(Object.entries(prevRaces).filter(([id]) => others.some((e) => e.id === id)));
  if (MAP.default) writeFileSync(path.join(sharedGen, 'track-race.json'), JSON.stringify(races[bases[0].id]));
  writeFileSync(racesFile, JSON.stringify({ ...keep, ...races }));
  log(`tracks written: ${index.map((t) => `${t.id} (${Math.round(t.length)} m)`).join(', ')}; index: ${all.map((t) => t.id).join(', ')}`);
}

/**
 * The traced pit entry wandered off into the paddock (up to 89 m from the lane, so the minimap and the pit-lane
 * markings were wrong there). The real lane, measured from the collision surfaces (tools/sim/pitlat.mjs):
 * it leaves the track at ~4975 m of the GP lap, runs 10–16 m left of the centreline behind the pit wall, crosses
 * the apron and reaches the garages ~20 m left by ~5190 m, where the trace was right again. Rebuilt as
 * (lap s, lateral) pairs on the GP centreline; the service box is moved in front of the garages
 * (5190 m … 60 m, across the start line). Other layouts sharing the lane get the same points.
 */
const PIT_ENTRY = [
  [4975, -3],
  [4990, -12],
  [5000, -13],
  [5060, -13],
  [5100, -14],
  [5150, -16],
  [5190, -19.5],
];
const PIT_BOX = [5190, 60];

function fixPitEntry(bases) {
  const gp = bases[0];
  const pl = gp.pitLane;
  if (!pl) return;
  const cl = gp.centerline;
  const cs = gp.cumS;
  const n = cl.length / 3;
  const L = gp.length;
  const frame = (sLap) => {
    const sm = ((sLap % L) + L) % L;
    let i = 0;
    while (i < n - 1 && cs[i + 1] <= sm) i++;
    const j = (i + 1) % n;
    const seg = (j === 0 ? L : cs[j]) - cs[i] || 1;
    const f = Math.min(1, Math.max(0, (sm - cs[i]) / seg));
    let tx = cl[j * 3] - cl[i * 3];
    let tz = cl[j * 3 + 2] - cl[i * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    return { x: cl[i * 3] + (cl[j * 3] - cl[i * 3]) * f, y: cl[i * 3 + 1], z: cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * f, tx, tz };
  };
  const project = (p) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (cl[i * 3] - p[0]) ** 2 + (cl[i * 3 + 2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const j = (best + 1) % n;
    let tx = cl[j * 3] - cl[best * 3];
    let tz = cl[j * 3 + 2] - cl[best * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    return { s: cs[best], lat: (p[0] - cl[best * 3]) * tz - (p[2] - cl[best * 3 + 2]) * tx };
  };
  const old = pl.points;
  // first old point back on the real lane (in front of the garages)
  const join = old.findIndex((p) => {
    const q = project(p);
    return q.s >= PIT_ENTRY[PIT_ENTRY.length - 1][0] && q.s < L - 2 && q.lat < -17 && q.lat > -25;
  });
  if (join < 0) return;
  const sJoin = project(old[join]).s;
  const latAt = (sl) => {
    const P = [...PIT_ENTRY, [sJoin, project(old[join]).lat]];
    for (let k = 0; k < P.length - 1; k++) if (sl <= P[k + 1][0]) return P[k][1] + ((P[k + 1][1] - P[k][1]) * (sl - P[k][0])) / (P[k + 1][0] - P[k][0] || 1);
    return P[P.length - 1][1];
  };
  const pts = [];
  for (let sl = PIT_ENTRY[0][0]; sl < sJoin - 1; sl += 2.5) {
    const f = frame(sl);
    const lat = latAt(sl);
    // + lateral = left of travel: left of (tx, tz) is (tz, -tx)
    pts.push([round3(f.x + f.tz * lat), f.y, round3(f.z - f.tx * lat)]);
  }
  const points = [...pts, ...old.slice(join)];
  let len = 0;
  for (let k = 1; k < points.length; k++) len += Math.hypot(points[k][0] - points[k - 1][0], points[k][2] - points[k - 1][2]);
  const lapS = points.map((p) => project(p).s);
  const inBox = (sl) => (PIT_BOX[0] > PIT_BOX[1] ? sl >= PIT_BOX[0] || sl <= PIT_BOX[1] : sl >= PIT_BOX[0] && sl <= PIT_BOX[1]);
  const boxFrom = lapS.findIndex((sl, k) => k > pts.length / 2 && inBox(sl));
  let boxTo = boxFrom;
  while (boxTo + 1 < points.length && inBox(lapS[boxTo + 1])) boxTo++;
  const before = old.length;
  const fixed = { ...pl, points, length: Math.round(len * 10) / 10, entryS: PIT_ENTRY[0][0], boxFrom, boxTo };
  for (const b of bases) {
    if (!b.pitLane) continue;
    const mid = b.pitLane.points[Math.floor(b.pitLane.points.length / 2)];
    const same = old.some((p) => Math.hypot(p[0] - mid[0], p[2] - mid[2]) < 5);
    if (!same) continue;
    b.pitLane = b === gp ? fixed : { ...b.pitLane, points: points.map((p) => p.slice()), length: fixed.length, boxFrom, boxTo };
  }
  log(`pit entry rebuilt: ${before} → ${points.length} points, ${Math.round(len)} m, service box ${boxFrom}–${boxTo}`);
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Road surface lookup from the collision meshes (asphalt + kerbs): every height under a point (x, z).
 * Where roads overlap in plan (under a bridge) there are several; the raster heights of the analysis could
 * pick the wrong one (the lap line sat 4 m under the road there, so resets dropped cars below the map).
 */
function roadSurface(mapOut) {
  const tris = [];
  for (const s of ['asphalt', 'curb']) {
    const pf = path.join(mapOut, 'collision_raw', `${s}.pos.bin`);
    if (!existsSync(pf)) continue;
    tris.push({ pos: new Float32Array(fileBytes(pf)), idx: new Uint32Array(fileBytes(path.join(mapOut, 'collision_raw', `${s}.idx.bin`))) });
  }
  const CELL = 8;
  const grid = new Map();
  tris.forEach((t, ti) => {
    for (let k = 0; k < t.idx.length; k += 3) {
      const a = t.idx[k] * 3;
      const b = t.idx[k + 1] * 3;
      const c = t.idx[k + 2] * 3;
      const x0 = Math.floor(Math.min(t.pos[a], t.pos[b], t.pos[c]) / CELL);
      const x1 = Math.floor(Math.max(t.pos[a], t.pos[b], t.pos[c]) / CELL);
      const z0 = Math.floor(Math.min(t.pos[a + 2], t.pos[b + 2], t.pos[c + 2]) / CELL);
      const z1 = Math.floor(Math.max(t.pos[a + 2], t.pos[b + 2], t.pos[c + 2]) / CELL);
      if (x1 - x0 > 8 || z1 - z0 > 8) continue;
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`;
          let l = grid.get(key);
          if (!l) grid.set(key, (l = []));
          l.push(ti, k);
        }
    }
  });
  return (x, z) => {
    const l = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    const ys = [];
    if (!l) return ys;
    for (let q = 0; q < l.length; q += 2) {
      const t = tris[l[q]];
      const k = l[q + 1];
      const a = t.idx[k] * 3;
      const b = t.idx[k + 1] * 3;
      const c = t.idx[k + 2] * 3;
      const ax = t.pos[a],
        ay = t.pos[a + 1],
        az = t.pos[a + 2];
      const bx = t.pos[b],
        by = t.pos[b + 1],
        bz = t.pos[b + 2];
      const cx = t.pos[c],
        cy = t.pos[c + 1],
        cz = t.pos[c + 2];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-9) continue;
      const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
      const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
      const w3 = 1 - w1 - w2;
      if (w1 >= -1e-6 && w2 >= -1e-6 && w3 >= -1e-6) ys.push(w1 * ay + w2 * by + w3 * cy);
    }
    return ys;
  };
}

/** Heights of the lap line and the pit lane from the road surface, continuous from point to point. */
function fixHeights(base, surf) {
  const pick = (x, z, prev) => {
    const ys = surf(x, z);
    if (!ys.length) return prev;
    return ys.reduce((best, y) => (Math.abs(y - prev) < Math.abs(best - prev) ? y : best), ys[0]);
  };
  const cl = base.centerline;
  const n = cl.length / 3;
  let fixed = 0;
  // walk the loop twice so the first points also get a continuous value
  let prev = cl[1];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const y = pick(cl[i * 3], cl[i * 3 + 2], prev);
      if (pass === 1) {
        if (Math.abs(y - cl[i * 3 + 1]) > 1.5) fixed++;
        cl[i * 3 + 1] = Math.round(y * 1000) / 1000;
      }
      prev = y;
    }
  }
  for (const g of base.gates) {
    const i = base.cumS.findIndex((s) => s >= g.s);
    if (i >= 0) g.p[1] = cl[i * 3 + 1];
  }
  if (base.pitLane) {
    let py = base.pitLane.points[0][1];
    for (const p of base.pitLane.points) {
      py = pick(p[0], p[2], py);
      p[1] = Math.round(py * 1000) / 1000;
    }
  }
  if (fixed) log(`${base.id}: ${fixed} lap-line heights corrected from the road surface (>1.5 m off)`);
}

/** Re-write the layout JSONs only (after a new track analysis), keeping the optimized meshes. */
async function tracksOnly() {
  const first = JSON.parse(readFileSync(path.join(out, MAP.out, 'track_base.json'), 'utf8')).id;
  const cur = JSON.parse(readFileSync(path.join(pub, layoutFile(first)), 'utf8'));
  await writeTracks(path.join(out, MAP.out), { chunks: cur.chunks, files: cur.files, collision: cur.collision });
}

/* ---------------------------------------------------------- collision --- */

const SURF = ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'];
const SIMPLIFY_ERR = { asphalt: 0, curb: 0, grass: 0.00004, gravel: 0, sand: 0.00004, wall: 0.00012 };

function weldPositions(pos, idx) {
  const map = new Map();
  const outPos = [];
  const remap = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[i * 3] * 500)},${Math.round(pos[i * 3 + 1] * 500)},${Math.round(pos[i * 3 + 2] * 500)}`;
    let j = map.get(k);
    if (j === undefined) {
      j = outPos.length / 3;
      map.set(k, j);
      outPos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    remap[i] = j;
  }
  const outIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]];
    const b = remap[idx[t + 1]];
    const c = remap[idx[t + 2]];
    if (a !== b && b !== c && a !== c) outIdx.push(a, b, c);
  }
  return { pos: new Float32Array(outPos), idx: new Uint32Array(outIdx) };
}

/**
 * collision.bin layout (little endian):
 *   'APXC' u32 version u32 count
 *   per sub-mesh: u32 surface u32 vertexCount u32 indexCount, f32 positions[], u32 indices[]
 */
function fileBytes(file) {
  const b = readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

async function collision(mapOut, dstDir) {
  const parts = [];
  let total = 0;
  for (const [si, s] of SURF.entries()) {
    const pf = path.join(mapOut, 'collision_raw', `${s}.pos.bin`);
    if (!existsSync(pf)) continue;
    // copy exactly the file's bytes: small files live inside Node's shared buffer pool (reading `.buffer` whole
    // filled the small gravel mesh with garbage vertices at ~1e28 m)
    const rawPos = new Float32Array(fileBytes(pf));
    const rawIdx = new Uint32Array(fileBytes(path.join(mapOut, 'collision_raw', `${s}.idx.bin`)));
    let { pos, idx } = weldPositions(rawPos, rawIdx);
    const before = idx.length / 3;
    // paint, grid-box bars and patches lie a few cm above the road: one surface for the wheels (flatten_layers.mjs)
    if (s !== 'wall') {
      const r = snapStackedLayers({ pos, idx });
      idx = r.idx;
      log(`collision ${s}: stacked layers: ${r.snapped} vertices snapped down (up to ${(r.maxGap * 100).toFixed(1)} cm), ${r.dropped} triangles dropped`);
    }
    if (SIMPLIFY_ERR[s] > 0) {
      const [simp] = MeshoptSimplifier.simplify(idx, pos, 3, 0, SIMPLIFY_ERR[s], ['LockBorder']);
      idx = simp;
    }
    // compact unused vertices
    const used = new Int32Array(pos.length / 3).fill(-1);
    const cp = [];
    const ci = new Uint32Array(idx.length);
    for (let i = 0; i < idx.length; i++) {
      let v = used[idx[i]];
      if (v < 0) {
        v = used[idx[i]] = cp.length / 3;
        cp.push(pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]);
      }
      ci[i] = v;
    }
    parts.push({ si, pos: new Float32Array(cp), idx: ci });
    total += ci.length / 3;
    log(`collision ${s}: ${before} → ${ci.length / 3} tris`);
  }
  // ground holes in the source model (sky showing through, cars falling out of the world): fill them with grass
  const base = JSON.parse(readFileSync(path.join(mapOut, 'track_base.json'), 'utf8'));
  const GROUND_VIS_RE = /^(asph|curb|lines|redline|grass|sand|gravel|travert|conc_|pits|astroturf|box_decal|pavement|tiles|grille|top2)/i;
  const visual = [];
  for (const k of ['track', 'scenery', 'terrain']) {
    const f = path.join(mapOut, `map_${k}.glb`);
    if (existsSync(f)) visual.push(...(await groundPartsFromGlb(io, f, GROUND_VIS_RE)));
  }
  const fill = fillHoles(parts, SURF, base.centerline, base.pitLane ? base.pitLane.points.flat() : [], visual);
  if (fill.cells) {
    const gi = SURF.indexOf('grass');
    parts.push({ si: gi, pos: fill.pos, idx: fill.idx });
    total += fill.idx.length / 3;
    const terrain = await fillTerrain(io, path.join(mapOut, 'map_terrain.glb'), parts, SURF);
    log(`terrain holes filled: ${terrain.cells} cells of 20 m`);
    // the grass texture for the fill: the map's main grass (maps/<id>.json "fillGrass"), else the first grass material
    const grassRe = MAP.fillGrass ? new RegExp(`^${MAP.fillGrass}$`) : undefined;
    const bounds = await writeFillGlb(io, fill, path.join(mapOut, 'map_track.glb'), path.join(dstDir, 'map_fill.glb'), terrain, grassRe);
    writeFileSync(path.join(mapOut, 'fill.json'), JSON.stringify({ file: 'map_fill.glb', cells: fill.cells, ...bounds }));
    log(`ground holes filled: ${fill.cells} cells of 2 m (${((fill.cells * 4) / 1e4).toFixed(2)} ha)`);
  }
  let size = 12;
  for (const p of parts) size += 12 + p.pos.byteLength + p.idx.byteLength;
  const buf = Buffer.alloc(size);
  buf.write('APXC', 0, 'ascii');
  buf.writeUInt32LE(1, 4);
  buf.writeUInt32LE(parts.length, 8);
  let o = 12;
  for (const p of parts) {
    buf.writeUInt32LE(p.si, o);
    buf.writeUInt32LE(p.pos.length / 3, o + 4);
    buf.writeUInt32LE(p.idx.length, o + 8);
    o += 12;
    Buffer.from(p.pos.buffer).copy(buf, o);
    o += p.pos.byteLength;
    Buffer.from(p.idx.buffer).copy(buf, o);
    o += p.idx.byteLength;
  }
  // gzip ourselves (static hosts do not reliably compress binaries). A neutral extension avoids hosts
  // adding Content-Encoding for .gz; the client sniffs the gzip magic and inflates only when needed.
  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(path.join(dstDir, 'collision.apxc'), gz);
  rmSync(path.join(dstDir, 'collision.bin'), { force: true });
  rmSync(path.join(dstDir, 'collision.bin.gz'), { force: true });
  log(`collision.apxc: ${total} tris, ${(size / 1e6).toFixed(2)} MB raw, ${(gz.length / 1e6).toFixed(2)} MB gzipped`);
}

/* --------------------------------------------------------------- main --- */

try {
  // a run for one map (--map) leaves the cars alone
  if ((!only && !args.includes('--map')) || only === 'cars') await cars();
  if (!only || only === 'map') await map();
  if (only === 'tracks') await tracksOnly();
  if (only === 'collision') {
    await collision(path.join(out, MAP.out), path.join(pub, MAP.assets));
    await tracksOnly();
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
