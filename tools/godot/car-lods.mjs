#!/usr/bin/env node
/**
 * The Godot app's models of one car, from convert_car.py's normalised GLB (tools/godot/build-cars.py runs it):
 *   cockpit.glb  your own car from the seat: the source as it is (no simplification), 4K colour / 2K data textures
 *   lod0.glb     your own car from outside (chase, replays): the source as it is, 4K / 2K
 *   lod1.glb     other cars near you (the session draws others from lod1: Assets.load_car_model's first_level 1):
 *                up to LOD1_TRIS with the cabin, UV seams kept, 4K / 2K
 *   lod2.glb     other cars further off: no cabin, LOD2_TRIS, 1K / 512
 * Full detail on the PC (the user: as many triangles as possible): an earlier cut to 300k / 60k near read as faceted
 * curves. Godot's own generated mesh LODs are off for these files (tools/godot/build-cars.py patches their .import).
 * Plain glTF (no meshopt, no KTX2): Godot imports it and compresses the textures for the GPU itself. The web game's
 * cars (tools/asset-pipeline/optimize.mjs) are not touched.
 *
 *   node tools/godot/car-lods.mjs <car.glb> <out dir>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, normals, join, flatten } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const LOD1_TRIS = 400_000;
const LOD2_TRIS = 80_000;

const INTERIOR_MAT_RE =
  /(^|[_\s.])(int|interior|cockpit|seat|steer|dash|belt|pedal|display|dispaly|gauge|roll_?cage|sparco|cables?|electronics|harness|racelogic|lcd)/i;
const GLASS_NAME_RE = /glass|window|windscreen|windshield|lights_?glass|lens/i;
const DATA_SLOT_RE = /normal|metallicRoughness|occlusion/i;

const [src, outDir, onlyArg] = process.argv.slice(2);
// a third argument: build only these (comma list), e.g. "lod1.glb,lod2.glb"
const only = onlyArg ? onlyArg.split(',') : null;
mkdirSync(outDir, { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function triCount(doc) {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      t += idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
    }
  return Math.round(t);
}

async function simplifyTo(doc, target, maxError, lockBorder = true) {
  let tris = triCount(doc);
  let error = 0.0003;
  // never past maxError (a fraction of the mesh's size): a few more triangles rather than torn panels
  while (tris > target * 1.03 && error <= maxError) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, target / tris), error, lockBorder }));
    tris = triCount(doc);
    error *= 2;
  }
  return tris;
}

function dropInterior(doc) {
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) if (INTERIOR_MAT_RE.test(prim.getMaterial()?.getName() ?? '')) prim.dispose();
  for (const node of doc.getRoot().listNodes()) if (node.getName().startsWith('steering_wheel')) node.dispose();
}

function dropTiny(doc, minSize) {
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const mn = pos.getMin([]);
      const mx = pos.getMax([]);
      if (Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) < minSize) prim.dispose();
    }
}

/** Textures down to the given sizes (powers of two), colour as JPEG (PNG where it has alpha), data as PNG. */
async function sizeTextures(doc, maxColor, maxData) {
  const data = new Set();
  for (const mat of doc.getRoot().listMaterials())
    for (const [slot, tex] of [
      ['normal', mat.getNormalTexture()],
      ['metallicRoughness', mat.getMetallicRoughnessTexture()],
      ['occlusion', mat.getOcclusionTexture()],
    ])
      if (tex && DATA_SLOT_RE.test(slot)) data.add(tex);
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const max = data.has(tex) ? maxData : maxColor;
    const s = sharp(Buffer.from(img));
    const meta = await s.metadata();
    const size = 2 ** Math.floor(Math.log2(Math.max(1, Math.min(max, Math.max(meta.width, meta.height)))));
    const alpha = meta.hasAlpha && !data.has(tex);
    let p = sharp(Buffer.from(img)).resize(size, size, { fit: 'fill' });
    const buf = alpha ? await p.png().toBuffer() : data.has(tex) ? await p.png().toBuffer() : await p.jpeg({ quality: 90 }).toBuffer();
    tex.setImage(buf).setMimeType(alpha || data.has(tex) ? 'image/png' : 'image/jpeg');
  }
}

async function build(name, opts) {
  if (only && !only.includes(name)) return;
  return buildOne(name, opts);
}

async function buildOne(name, { tris, maxError, interior, tiny, color, dataSize, seams = true }) {
  const doc = await io.read(src);
  for (const mat of doc.getRoot().listMaterials()) {
    // see-through glass stays blended; any other blended material with a mostly opaque texture is drawn opaque (fewer
    // sorting problems, and Godot's depth prepass sees it)
    if (mat.getAlphaMode() === 'BLEND' && !GLASS_NAME_RE.test(mat.getName())) mat.setAlphaMode('MASK').setAlphaCutoff(0.5);
  }
  // the lights keep their own materials: the merge below joined identical materials whatever their names, and a tail
  // lamp's copy went into a headlight's (the AMG Evo) or the glass (the BMW M4), so the game no longer found it
  for (const mat of doc.getRoot().listMaterials()) {
    const role = /^LIGHT_TAIL_/.test(mat.getName()) ? 'tail' : /^LIGHT_HEAD_/.test(mat.getName()) ? 'head' : null;
    if (role) mat.setExtras({ ...mat.getExtras(), apexLight: role });
  }
  if (!interior) dropInterior(doc);
  if (tiny) dropTiny(doc, tiny);
  // one primitive per material within each named part (body, wheel_XX_spin, steering_wheel stay apart): the sources
  // keep dozens of small objects per material, 60-90 draw calls a car, ~2,900 a frame with a grid of 12
  await doc.transform(dedup(), weld(), join({ keepNamed: true }), prune());
  // the distant models may collapse across UV seams (locked, the simplifier stopped at 2-10x their budget)
  const t = await simplifyTo(doc, tris, maxError, seams);
  if (tiny) await doc.transform(normals({ overwrite: false }));
  await sizeTextures(doc, color, dataSize);
  // Godot imports a node whose name ends in "_wheel" as a VehicleWheel3D (an import hint), not as a mesh: the steering
  // wheel goes by "steering_rim", the name CarVisual turns (as tools/godot/unpack-glb.mjs does for the web game's cars)
  for (const n of doc.getRoot().listNodes()) if (n.getName() === 'steering_wheel') n.setName('steering_rim');
  await doc.transform(prune());
  const file = path.join(outDir, name);
  await io.write(file, doc);
  console.log(`[lods] ${name}: ${t} tris, ${(statSync(file).size / 1e6).toFixed(1)} MB`);
}

await build('cockpit.glb', { tris: Infinity, maxError: 0, interior: true, color: 4096, dataSize: 2048 });
await build('lod0.glb', { tris: Infinity, maxError: 0, interior: true, color: 4096, dataSize: 2048 });
await build('lod1.glb', { tris: LOD1_TRIS, maxError: 0.0015, interior: true, color: 4096, dataSize: 2048 });
await build('lod2.glb', { tris: LOD2_TRIS, maxError: 0.03, interior: false, tiny: 0.03, color: 1024, dataSize: 512, seams: false });
