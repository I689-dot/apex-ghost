#!/usr/bin/env node
/**
 * Headlamps for models whose lamps share a material with other things (the Vantage's are in its "Glass", with the
 * windows and the tail lamps): the triangles inside the headlamp box (and its mirror across the centre line) move to a
 * material of their own, LIGHT_HEAD_LAMP_<name>, which CarVisual drives as a headlamp. Its glow map is drawn from the
 * colour map: where it is bright and white (the LED elements), not the grey housing or the clear cover. Before, the
 * Vantage's headlamps never lit. Runs again without change (a model with the lamp material is left alone).
 *
 *   node tools/godot/head-lamps.mjs <material> <x0,y0,z0,x1,y1,z1> <file.glb> [more.glb ...]
 *   (the box in the car's frame, +Z forward, +Y up, m: one side's lamp; the other side is its mirror)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import path from 'node:path';

const [matName, boxArg, ...files] = process.argv.slice(2);
const box = boxArg.split(',').map(Number);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const MASK_MAX = 1024;

const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const inBox = (c) => {
  const x = Math.abs(c[0]);
  const lo = Math.min(Math.abs(box[0]), Math.abs(box[3]));
  const hi = Math.max(Math.abs(box[0]), Math.abs(box[3]));
  return x >= lo && x <= hi && c[1] >= box[1] && c[1] <= box[4] && c[2] >= box[2] && c[2] <= box[5];
};

/** The glow map: white where the colour map is bright and near white (an LED), black elsewhere. */
async function glowMap(image) {
  const img = sharp(Buffer.from(image));
  const meta = await img.metadata();
  const size = Math.min(MASK_MAX, meta.width);
  const { data, info } = await img.resize(size, Math.round((size * meta.height) / meta.width)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
    const mx = Math.max(r, g, b);
    const sat = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
    const v = smooth(0.62, 0.9, mx) * (1 - smooth(0.18, 0.4, sat));
    out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = Math.round(v * 255);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
}

for (const file of files) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const lampName = `LIGHT_HEAD_LAMP_${matName}`;
  if (root.listMaterials().some((m) => m.getName() === lampName)) {
    console.log(`[head-lamps] ${path.basename(file)}: already split`);
    continue;
  }
  const src = root.listMaterials().find((m) => m.getName() === matName);
  if (!src) {
    console.log(`[head-lamps] ${path.basename(file)}: no ${matName}`);
    continue;
  }
  const lamp = src.clone().setName(lampName);
  const base = src.getBaseColorTexture();
  if (base?.getImage()) {
    const tex = doc.createTexture(`${lampName}_glow`).setImage(await glowMap(base.getImage())).setMimeType('image/png');
    lamp.setEmissiveTexture(tex).setEmissiveFactor([1, 1, 1]);
    const info = src.getBaseColorTextureInfo();
    if (info) lamp.getEmissiveTextureInfo().setTexCoord(info.getTexCoord());
  }
  // (its blending stays the source's: the clear covers are in it too; made opaque, they turned into grey lids)
  let moved = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of [...mesh.listPrimitives()]) {
      if (prim.getMaterial() !== src || !prim.getIndices()) continue;
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const keep = [];
      const take = [];
      const t = [];
      for (let i = 0; i < idx.getCount(); i += 3) {
        const tri = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)];
        const q = tri.map((v) => apply(m, pos.getElement(v, t)));
        const c = [0, 1, 2].map((k) => (q[0][k] + q[1][k] + q[2][k]) / 3);
        (inBox(c) ? take : keep).push(...tri);
      }
      if (!take.length) continue;
      const Arr = idx.getArray().constructor;
      const np = prim.clone().setMaterial(lamp);
      np.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Arr(take)).setBuffer(idx.getBuffer()));
      mesh.addPrimitive(np);
      if (keep.length) idx.setArray(new Arr(keep));
      else prim.dispose();
      moved += take.length / 3;
    }
  }
  await io.write(file, doc);
  console.log(`[head-lamps] ${path.basename(file)}: ${moved} triangles to ${lampName}`);
}
