// Decodes EXT_meshopt_compression and KHR_mesh_quantization in every GLB under a folder (in place) so Godot can import them.
// KTX2 textures (KHR_texture_basisu) are decoded here with the web game's Basis transcoder and stored as PNG: Godot's
// own KTX2 import hands its importer linear values that are then treated as sRGB again (a texture whose pixels average
// 76 came out at 18: every car, road and building far too dark and too saturated).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// the transcoder is an Emscripten script that defines a global: load a copy of it as a CommonJS module
const here = path.dirname(fileURLToPath(import.meta.url));
const libs = path.join(here, '../../apps/client/public/libs/basis');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'basis-'));
writeFileSync(path.join(tmp, 'basis.cjs'), readFileSync(path.join(libs, 'basis_transcoder.js'), 'utf8') + ';module.exports=BASIS;');
copyFileSync(path.join(libs, 'basis_transcoder.wasm'), path.join(tmp, 'basis_transcoder.wasm'));
const BASIS = await createRequire(import.meta.url)(path.join(tmp, 'basis.cjs'))({ wasmBinary: readFileSync(path.join(libs, 'basis_transcoder.wasm')) });
BASIS.initializeBasis();

/** A KTX2 (Basis) image as PNG, its stored values (sRGB-encoded colour, linear data) unchanged. */
async function ktx2ToPng(bytes) {
  const f = new BASIS.KTX2File(new Uint8Array(bytes));
  try {
    if (!f.isValid() || !f.startTranscoding()) throw new Error('invalid KTX2');
    const w = f.getWidth();
    const h = f.getHeight();
    const RGBA32 = 13;
    const out = new Uint8Array(f.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32));
    if (!f.transcodeImage(out, 0, 0, 0, RGBA32, 0, -1, -1)) throw new Error('transcode failed');
    return new Uint8Array(await sharp(Buffer.from(out), { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer());
  } finally {
    f.close();
    f.delete();
  }
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.glb')) yield p;
  }
}
let n = 0;
for (const f of walk(process.argv[2])) {
  const doc = await io.read(f);
  const used = doc.getRoot().listExtensionsUsed();
  const names = ['EXT_meshopt_compression', 'KHR_mesh_quantization'];
  // Godot's WebP reader fails on some of these files' textures: re-encode them as PNG
  const webp = doc.getRoot().listTextures().filter((t) => t.getMimeType() === 'image/webp');
  for (const t of webp) t.setImage(new Uint8Array(await sharp(Buffer.from(t.getImage())).png().toBuffer())).setMimeType('image/png');
  const ktx = doc.getRoot().listTextures().filter((t) => t.getMimeType() === 'image/ktx2');
  for (const t of ktx) t.setImage(await ktx2ToPng(t.getImage())).setMimeType('image/png');
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'KHR_texture_basisu' && ktx.length) e.dispose();
  // Godot turns a node whose name ends in "_wheel" into a VehicleWheel3D (an import hint): the steering wheel is
  // renamed (the game looks for "steering_rim")
  const rim = doc.getRoot().listNodes().filter((n) => n.getName() === 'steering_wheel');
  for (const n of rim) n.setName('steering_rim');
  if (!webp.length && !ktx.length && !rim.length && !used.some((e) => names.includes(e.extensionName))) continue;
  // Godot reads neither: decode the meshopt buffers (done by the reader), turn quantized attributes into floats
  if (used.some((e) => names.includes(e.extensionName))) await doc.transform(dequantize());
  for (const e of used) if (names.includes(e.extensionName)) e.dispose();
  await io.write(f, doc);
  n++;
  console.log('unpacked', f);
}
console.log(n, 'files');
