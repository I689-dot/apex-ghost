// Decodes EXT_meshopt_compression and KHR_mesh_quantization in every GLB under a folder (in place) so Godot can import them.
// Textures (KHR_texture_basisu / KTX2) are left as they are: Godot reads them natively.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

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
  // Godot turns a node whose name ends in "_wheel" into a VehicleWheel3D (an import hint): the steering wheel is
  // renamed (the game looks for "steering_rim")
  const rim = doc.getRoot().listNodes().filter((n) => n.getName() === 'steering_wheel');
  for (const n of rim) n.setName('steering_rim');
  if (!webp.length && !rim.length && !used.some((e) => names.includes(e.extensionName))) continue;
  // Godot reads neither: decode the meshopt buffers (done by the reader), turn quantized attributes into floats
  if (used.some((e) => names.includes(e.extensionName))) await doc.transform(dequantize());
  for (const e of used) if (names.includes(e.extensionName)) e.dispose();
  await io.write(f, doc);
  n++;
  console.log('unpacked', f);
}
console.log(n, 'files');
