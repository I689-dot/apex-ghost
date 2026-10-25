#!/usr/bin/env node
/**
 * A published (web) GLB back into a plain one Blender can import: meshopt decoded, quantisation removed, KTX2 / WebP
 * textures as PNG. For rebuilding a map step on a machine without the pipeline's intermediates (e.g. the GP map's raw
 * terrain, which the Nordschleife builder conforms: tools/asset-pipeline/out/map/map_terrain.glb).
 *
 *   node tools/asset-pipeline/unpack_glb.mjs <in.glb> <out.glb>
 *   node tools/asset-pipeline/unpack_glb.mjs apps/client/public/assets/track/map_terrain.glb tools/asset-pipeline/out/map/map_terrain.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/asset-pipeline/unpack_glb.mjs <in.glb> <out.glb>');
  process.exit(1);
}
const KTX = process.env.KTX ?? path.join(homedir(), '.local/opt/ktx/bin/ktx');

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
await doc.transform(dequantize());

const tmp = mkdtempSync(path.join(tmpdir(), 'unpack-'));
let n = 0;
for (const tex of doc.getRoot().listTextures()) {
  const mime = tex.getMimeType();
  const img = tex.getImage();
  if (!img || mime === 'image/png' || mime === 'image/jpeg') continue;
  let png;
  if (mime === 'image/ktx2') {
    const src = path.join(tmp, `t${n}.ktx2`);
    const dst = path.join(tmp, `t${n}.png`);
    writeFileSync(src, img);
    execFileSync(KTX, ['extract', '--transcode', 'rgba8', src, dst]);
    png = readFileSync(dst);
  } else png = await sharp(Buffer.from(img)).png().toBuffer();
  tex.setImage(png).setMimeType('image/png');
  n++;
}
// nothing compressed is left: drop the extensions that said so
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (/meshopt|basisu|texture_webp|mesh_quantization/i.test(ext.extensionName)) ext.dispose();
}
mkdirSync(path.dirname(output), { recursive: true });
await io.write(output, doc);
rmSync(tmp, { recursive: true, force: true });
console.log(`${output}: ${doc.getRoot().listMeshes().length} meshes, ${n} textures to PNG`);
