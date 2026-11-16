#!/usr/bin/env node
/**
 * The rear lamps' glow for the Godot app's car models: each tail-lamp material gets an emissive map that lights only
 * the lamps themselves, drawn from its own colour map: where it is red, saturated and not dark (the LED strips and
 * lenses of the lamp atlases). Indicators, reversing lights, chrome and housings sharing the atlas stay dark, and a
 * material listed as a tail lamp that is not red (a grey plastic, an amber indicator glass) does not glow at all.
 * Before, the game lit the whole material one flat red. CarVisual sets how bright (tail lamps, brakes) at run time.
 *
 * Tail-lamp materials: names starting LIGHT_TAIL_ (convert_car.py), and any named on the command line (models whose
 * lamps are in another material: the Vantage's in its "Glass", the Ferrari's anonymous "mat_50").
 * A material with an emissive map already (a mask of the lamp shapes) has it turned red by its brightness.
 * Untextured materials glow where their colour is red. Runs again without change (marks what it made).
 *
 *   node tools/godot/tail-lights.mjs <file.glb> [more.glb ...] [--also=name,name]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

// the lamp's light: a deep LED red
const LAMP = [1.0, 0.07, 0.035];
const MASK_MAX = 1024;

const args = process.argv.slice(2);
const also = (args.find((a) => a.startsWith('--also=')) ?? '--also=').slice(7).split(',').filter(Boolean);
const files = args.filter((a) => !a.startsWith('--'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much a pixel (0..255 sRGB) is lit lamp: red, saturated and not dark. */
function lampness(r, g, b) {
  const sat = (r - Math.max(g, b)) / Math.max(r, 1);
  return smooth(0.45, 0.75, sat) * smooth(0.18, 0.42, r / 255);
}

/** The emissive map from a colour map: the lamp's red where the colour map is lamp. byBrightness: from a mask's grey. */
async function emissiveFrom(image, byBrightness) {
  const img = sharp(Buffer.from(image));
  const meta = await img.metadata();
  const size = Math.min(MASK_MAX, meta.width);
  const h = Math.round((size / meta.width) * meta.height);
  const { data, info } = await img.resize(size, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 3);
  let lit = 0;
  for (let i = 0, o = 0; i < data.length; i += info.channels, o += 3) {
    const m = byBrightness ? Math.max(data[i], data[i + 1], data[i + 2]) / 255 : lampness(data[i], data[i + 1], data[i + 2]);
    if (m > 0.05) lit++;
    out[o] = Math.round(255 * m * LAMP[0]);
    out[o + 1] = Math.round(255 * m * LAMP[1]);
    out[o + 2] = Math.round(255 * m * LAMP[2]);
  }
  const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
  return { png, lit: lit / (info.width * info.height) };
}

for (const file of files) {
  const doc = await io.read(file);
  const done = new Map();
  const report = [];
  for (const mat of doc.getRoot().listMaterials()) {
    const name = mat.getName();
    if (!(name.startsWith('LIGHT_TAIL_') || also.includes(name)) || mat.getExtras().apexTailMask) continue;
    const base = mat.getBaseColorTexture();
    const emis = mat.getEmissiveTexture();
    const src = emis ?? base;
    if (src) {
      // one map per source image (the lamps of several materials often share an atlas)
      let made = done.get(src);
      if (!made) {
        const { png, lit } = await emissiveFrom(src.getImage(), !!emis);
        const tex = doc.createTexture(`${name}_lamp`).setImage(png).setMimeType('image/png');
        made = { tex, lit };
        done.set(src, made);
      }
      const uv = (emis ? mat.getEmissiveTextureInfo() : mat.getBaseColorTextureInfo())?.getTexCoord() ?? 0;
      mat.setEmissiveTexture(made.tex).setEmissiveFactor([1, 1, 1]);
      mat.getEmissiveTextureInfo().setTexCoord(uv);
      report.push(`${name}: ${(made.lit * 100).toFixed(1)} % lamp${emis ? ' (its mask)' : ''}`);
    } else {
      const [r, g, b] = mat.getBaseColorFactor().map((v) => Math.round(255 * Math.pow(v, 1 / 2.2)));
      const m = lampness(r, g, b);
      mat.setEmissiveFactor(m > 0.05 ? LAMP.map((c) => c * m) : [0, 0, 0]);
      report.push(`${name}: ${m > 0.05 ? 'red, lit' : 'not red, dark'}`);
    }
    mat.setExtras({ ...mat.getExtras(), apexTailMask: true });
  }
  await io.write(file, doc);
  console.log(`[tail] ${file.split('/').slice(-2).join('/')}: ${report.join('; ') || 'no tail lamps'}`);
}
