#!/usr/bin/env node
/**
 * Vegetation for the forest and the verges, from the models in GRAPHICS-IMPROVEMENT/:
 *
 *   node tools/asset-pipeline/vegetation.mjs            (Blender conversion + texture/mesh optimisation)
 *   node tools/asset-pipeline/vegetation.mjs --skip-blender
 *
 * 1. blender/convert_vegetation.py → out/vegetation/trees.glb (normalised, thinned, decimated);
 * 3. the lawn scan → assets/vegetation/lawn.jpg (blender/bake_lawn.py + a seamless blend), the verges' ground grass.
 * 2. here: only the base colour is kept (the game shades vegetation itself), the maple's leaf cut-out comes from its
 *    roughness map (the leaf JPEG has no alpha: leaves are bright on a grey ground there), leaves become
 *    alpha-masked and double-sided, textures are resized and stored as WebP, meshes quantised + meshopt;
 *
 * Output: apps/client/public/assets/vegetation/ (~0.5 MB), bundled in the mobile app (vite.config.ts).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const SRC = process.env.VEGETATION_DIR ?? path.join(root, 'GRAPHICS-IMPROVEMENT');
const TMP = path.join(here, 'out/vegetation');
const OUT = path.join(root, 'apps/client/public/assets/vegetation');
const BLENDER = process.env.BLENDER ?? path.join(homedir(), '.local/opt/blender-4.2.3-linux-x64/blender');
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

if (!process.argv.includes('--skip-blender')) {
  console.log('▶ blender: convert_vegetation.py');
  execFileSync(BLENDER, ['-b', '--factory-startup', '-P', path.join(here, 'blender/convert_vegetation.py'), '--', SRC, TMP], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** Longest side of each kind of texture (px). */
const SIZE = { leaf: 1024, bark: 256 };

async function optimise(name, kindOf) {
  const doc = await io.read(path.join(TMP, `${name}.glb`));
  for (const mat of doc.getRoot().listMaterials()) {
    const kind = kindOf(mat.getName());
    const base = mat.getBaseColorTexture();
    let img = base ? sharp(Buffer.from(base.getImage())) : null;
    if (img && kind === 'leaf' && /maple/i.test(mat.getName())) {
      // The maple leaf JPEG has no alpha. Leaves are dark green there, the padding around them pale green or white,
      // and the roughness map is black outside the leaves (with smeared streaks below them, ~80-110): a leaf pixel is
      // dark in the colour map and rough; stems (brown, red ≥ green) are kept.
      const mr = mat.getMetallicRoughnessTexture();
      if (mr) {
        const { data: rgb, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const { width, height } = info;
        const rough = await sharp(Buffer.from(mr.getImage())).resize(width, height).extractChannel('green').raw().toBuffer();
        const rgba = Buffer.alloc(width * height * 4);
        for (let i = 0; i < width * height; i++) {
          const [r, g, b] = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
          const ro = rough[i];
          let a = Math.min(1, Math.max(0, (128 - g) / 16)) * Math.min(1, Math.max(0, (ro - 112) / 16));
          if (r >= g * 0.95 && r < 200 && ro > 100) a = 1;
          rgba[i * 4] = r;
          rgba[i * 4 + 1] = g;
          rgba[i * 4 + 2] = b;
          rgba[i * 4 + 3] = Math.round(a * 255);
        }
        img = sharp(
          await sharp(rgba, { raw: { width, height, channels: 4 } })
            .median(3)
            .png()
            .toBuffer(),
        );
      }
    }
    // only the base colour is used in the game
    for (const t of [mat.getNormalTexture(), mat.getOcclusionTexture(), mat.getMetallicRoughnessTexture(), mat.getEmissiveTexture()]) t?.dispose();
    mat.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
    mat.setMetallicFactor(0).setRoughnessFactor(1);
    for (const ext of mat.listExtensions()) mat.setExtension(ext.extensionName, null);
    if (kind === 'leaf') mat.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
    else mat.setAlphaMode('OPAQUE');
    if (img && base) {
      const max = SIZE[kind] ?? 512;
      const out = await img.resize(max, max, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 95 }).toBuffer();
      base.setImage(out).setMimeType('image/webp');
      const uri = base.getURI();
      if (uri) base.setURI(uri.replace(/\.\w+$/, '.webp'));
    }
    console.log(`  ${name}: ${mat.getName()} → ${kind}${base ? '' : ' (no texture)'}`);
  }
  await doc.transform(
    dedup(),
    prune(),
    quantize({ quantizeNormal: 10, quantizeTexcoord: 14, quantizePosition: 14 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const file = path.join(OUT, `${name}.glb`);
  await io.write(file, doc);
  console.log(`✔ ${path.relative(root, file)} ${(statSync(file).size / 1024).toFixed(0)} KB`);
}

console.log('▶ optimise');
await optimise('trees', (n) => (/leaf/i.test(n) ? 'leaf' : 'bark'));

// The lawn scan (photogrammetry of a mown lawn, Grass.usdz at the repo root; LAWN_SCAN to point elsewhere) rendered
// top-down by blender/bake_lawn.py, cropped clear of its brick edging and made seamless: the verges' ground grass.
const LAWN = process.env.LAWN_SCAN ?? path.join(root, 'Grass.usdz');
console.log('▶ lawn');
const raw = path.join(TMP, 'lawn_raw.png');
execFileSync(BLENDER, ['-b', '--factory-startup', '-P', path.join(here, 'blender/bake_lawn.py'), '--', LAWN, raw, '2048'], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
const N = 1024;
const { data: src } = await sharp(raw)
  .extract({ left: 0, top: 0, width: 1600, height: 1600 })
  .resize(N, N)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
// seamless: blend the tile with itself shifted by half, the shifted copy covering a cross over the original's edges
const lawn = Buffer.alloc(N * N * 3);
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const e = Math.min(x, N - 1 - x, y, N - 1 - y) / (N * 0.14);
    const w = Math.min(1, Math.max(0, e)) ** 2;
    const sx = (x + N / 2) % N;
    const sy = (y + N / 2) % N;
    for (let c = 0; c < 3; c++) lawn[(y * N + x) * 3 + c] = Math.round(src[(y * N + x) * 3 + c] * w + src[(sy * N + sx) * 3 + c] * (1 - w));
  }
const lawnJpg = await sharp(lawn, { raw: { width: N, height: N, channels: 3 } })
  .jpeg({ quality: 88, mozjpeg: true })
  .toBuffer();
writeFileSync(path.join(OUT, 'lawn.jpg'), lawnJpg);
console.log(`✔ lawn.jpg ${(lawnJpg.length / 1024).toFixed(0)} KB`);
