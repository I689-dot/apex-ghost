#!/usr/bin/env node
/**
 * The real brands in the circuits' own textures (the game carries no brands, 2026-11-16): sponsor boards, flags and
 * other circuits' names, painted over in the board's colour with an invented name where there was one (the names the
 * Nürburgring's boards use, or the game's own). The circuits' own signs (Circuit de Spa-Francorchamps and its 100 years
 * badge, Circuit Park Zandvoort) stay. Spa's sign atlas is stored upside down (the model's UVs flip it): its new names
 * are drawn flipped too. The patches are in tools/godot/debrand-maps.json, per model. A texture is patched once (marked
 * in its extras), so the step can run again.
 *
 *   node tools/godot/debrand-maps.mjs            (every model the .json lists, under godot/assets/maps)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// per texture (by name): the size the rectangles are written for, and the patches:
//   rect [x0, y0, x1, y1] px; bg: '#hex' or [x, y] (the colour of that pixel); label, fg, flip ('v'), rotate (deg)
const cfg = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'debrand-maps.json'), 'utf8'));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function patch(bytes, spec) {
  const img = sharp(Buffer.from(bytes)).ensureAlpha();
  const { data, info } = await img.clone().raw().toBuffer({ resolveWithObject: true });
  const sx = info.width / spec.size[0];
  const sy = info.height / spec.size[1];
  const layers = [];
  for (const p of spec.patches) {
    const [x0, y0, x1, y1] = [Math.round(p.rect[0] * sx), Math.round(p.rect[1] * sy), Math.round(p.rect[2] * sx), Math.round(p.rect[3] * sy)];
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    let bg = p.bg;
    if (Array.isArray(bg)) {
      const o = (Math.min(info.height - 1, Math.round(bg[1] * sy)) * info.width + Math.min(info.width - 1, Math.round(bg[0] * sx))) * 4;
      bg = `rgb(${data[o]},${data[o + 1]},${data[o + 2]})`;
    }
    let text = '';
    if (p.label) {
      // the text along the board (turned for a flag): as big as fits
      const along = Math.abs(p.rotate ?? 0) === 90 ? h : w;
      const across = Math.abs(p.rotate ?? 0) === 90 ? w : h;
      const size = Math.max(4, Math.min(across * 0.55, (along * 0.86) / (p.label.length * 0.62)));
      text = `<text x="${w / 2}" y="${h / 2}" transform="rotate(${p.rotate ?? 0} ${w / 2} ${h / 2})" dominant-baseline="central" text-anchor="middle" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="bold" font-size="${size.toFixed(1)}" fill="${p.fg}">${esc(p.label)}</text>`;
    }
    let patchImg = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${text}</svg>`)).png();
    if (p.flip === 'v') patchImg = patchImg.flip();
    layers.push({ input: await patchImg.toBuffer(), left: x0, top: y0 });
  }
  return img.composite(layers).png().toBuffer();
}

const maps = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../godot/assets/maps');
for (const [rel, PATCHES] of Object.entries(cfg)) {
  if (rel.startsWith('_')) continue;
  const file = path.join(maps, rel);
  const doc = await io.read(file);
  const done = [];
  for (const tex of doc.getRoot().listTextures()) {
    const spec = PATCHES[tex.getName()] ?? PATCHES[tex.getName().replace(/\.\d+$/, '')];
    if (!spec || !tex.getImage() || tex.getExtras()?.debranded) continue;
    tex.setImage(await patch(tex.getImage(), spec)).setMimeType('image/png');
    tex.setExtras({ ...tex.getExtras(), debranded: true });
    done.push(tex.getName());
  }
  if (done.length) await io.write(file, doc);
  console.log(`[debrand-maps] ${rel}: ${done.join(', ') || 'nothing to do'}`);
}
