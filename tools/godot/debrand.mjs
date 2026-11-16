#!/usr/bin/env node
/**
 * Paints over the makers' badges and suppliers' marks left inside the cars' texture atlases (the game carries no
 * brands since 2026-11-16; the liveries, decals, tyres and label sheets are handled at run time by CarPaint). The
 * regions come from tools/godot/debrand.json; each is filled with the median colour of a thin ring round it. A texture
 * is patched once (marked in its extras), so the step can run again.
 *
 *   node tools/godot/debrand.mjs <car id> <file.glb> [more.glb ...]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [carId, ...files] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'debrand.json'), 'utf8'))[carId] ?? {};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const median = (a) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };

async function patch(image, mime, rects) {
  const { data, info } = await sharp(Buffer.from(image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  for (const [u0, v0, u1, v1] of rects) {
    const x0 = Math.max(0, Math.floor(u0 * w)), x1 = Math.min(w, Math.ceil(u1 * w));
    const y0 = Math.max(0, Math.floor(v0 * h)), y1 = Math.min(h, Math.ceil(v1 * h));
    const ring = Math.max(2, Math.round(Math.min(w, h) * 0.006));
    const ch = [[], [], [], []];
    for (let y = Math.max(0, y0 - ring); y < Math.min(h, y1 + ring); y++)
      for (let x = Math.max(0, x0 - ring); x < Math.min(w, x1 + ring); x++) {
        if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
        const o = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) ch[c].push(data[o + c]);
      }
    const col = ch.map(median);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) data[o + c] = col[c];
      }
  }
  const img = sharp(data, { raw: { width: w, height: h, channels: 4 } });
  return mime === 'image/png' ? img.png().toBuffer() : img.removeAlpha().jpeg({ quality: 92 }).toBuffer();
}

for (const file of files) {
  const doc = await io.read(file);
  const done = [];
  for (const mat of doc.getRoot().listMaterials()) {
    const base = mat.getName().replace(/^LIGHT_(HEAD|TAIL)_/, '');
    const rects = cfg[base];
    const tex = mat.getBaseColorTexture();
    if (!rects || !tex || tex.getExtras().apexDebrand) continue;
    tex.setImage(await patch(tex.getImage(), tex.getMimeType(), rects));
    tex.setExtras({ ...tex.getExtras(), apexDebrand: true });
    done.push(base);
  }
  await io.write(file, doc);
  console.log(`[debrand] ${carId} ${path.basename(file)}: ${done.join(', ') || 'nothing'}`);
}
