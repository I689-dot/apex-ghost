// App icon and splash screens for Android and iOS, from the game's logo mark (the red "A" chevron of the
// website's favicon, with a translucent ghost copy behind it) and an in-engine photo of the grid
// (apps/client/public/assets/ui/photo_grid.webp). Run: pnpm --filter @apex/mobile assets
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const res = path.join(root, 'android/app/src/main/res');
const ios = path.join(root, 'ios/App/App/Assets.xcassets');
const photo = path.resolve(root, '../client/public/assets/ui/photo_grid.webp');
const BG = '#0d0e11';
const RED = '#ff2d3d';

// the chevron of the favicon (viewBox 32), drawn in a 100-unit box
const mark = (x, y, s, fill, opacity = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s / 32})" d="M6 24 16 6l10 18h-5l-5-9-5 9z" fill="${fill}" fill-opacity="${opacity}"/>`;

/** Foreground artwork centred in a square of `size` (safe zone: the middle ~60 %). */
const markSvg = (size, scale = 0.62, withBg = false, rounded = 0) => {
  const s = size * scale;
  const x = (size - s) / 2;
  const y = (size - s) / 2 + s * 0.05; // the chevron sits in the upper 3/4 of its box
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${withBg ? `<rect width="${size}" height="${size}" rx="${rounded}" fill="${BG}"/>` : ''}
    ${mark(x - s * 0.16, y, s, '#ffffff', 0.18)}
    ${mark(x + s * 0.04, y, s, RED)}
  </svg>`);
};

const png = (buf, out) => {
  mkdirSync(path.dirname(out), { recursive: true });
  return sharp(buf).png().toFile(out);
};

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  const dir = path.join(res, `mipmap-${d}`);
  const legacy = Math.round(48 * k);
  await png(markSvg(legacy, 0.6, true, legacy * 0.18), path.join(dir, 'ic_launcher.png'));
  // round legacy icon: a circle mask
  const circle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`,
  );
  await sharp(
    await sharp(markSvg(legacy, 0.56, true))
      .png()
      .toBuffer(),
  )
    .composite([{ input: circle, blend: 'dest-in' }])
    .png()
    .toFile(path.join(dir, 'ic_launcher_round.png'));
  // adaptive icon foreground: 108 dp canvas, artwork inside the 66 dp safe zone
  await png(markSvg(Math.round(108 * k), 0.42), path.join(dir, 'ic_launcher_foreground.png'));
}
writeFileSync(
  path.join(res, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
);

/** Splash: the grid photo, darkened, with the logo mark and the APEX GHOST word mark. */
async function splash(w, h, out) {
  const m = Math.min(w, h);
  const s = m * 0.2;
  const text = Math.round(m * 0.11);
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><radialGradient id="v" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="${BG}" stop-opacity="0.55"/><stop offset="1" stop-color="${BG}" stop-opacity="0.95"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#v)"/>
    ${mark(w / 2 - s / 2 - s * 0.12, h / 2 - s * 0.95, s, '#ffffff', 0.18)}
    ${mark(w / 2 - s / 2 + s * 0.03, h / 2 - s * 0.95, s, RED)}
    <text x="${w / 2}" y="${h / 2 + text * 0.95}" text-anchor="middle" font-family="Roboto Condensed, Liberation Sans Narrow, sans-serif" font-weight="700" font-style="italic" font-size="${text}" letter-spacing="${text * 0.04}" fill="#f2f3f5">APEX <tspan fill="${RED}">GHOST</tspan></text>
  </svg>`);
  const base = await sharp(photo).resize(w, h, { fit: 'cover' }).modulate({ brightness: 0.7, saturation: 0.8 }).toBuffer();
  mkdirSync(path.dirname(out), { recursive: true });
  await sharp(base)
    .composite([{ input: overlay }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}

const land = { mdpi: [480, 320], hdpi: [800, 480], xhdpi: [1280, 720], xxhdpi: [1600, 960], xxxhdpi: [1920, 1280] };
for (const [d, [w, h]] of Object.entries(land)) {
  await splash(w, h, path.join(res, `drawable-land-${d}/splash.png`));
  await splash(h, w, path.join(res, `drawable-port-${d}/splash.png`));
}
await splash(480, 320, path.join(res, 'drawable/splash.png'));

// iOS (prepared; built on a Mac): 1024 icon without alpha, square 2732 splash
await sharp(markSvg(1024, 0.6, true, 0))
  .flatten({ background: BG })
  .png()
  .toFile(path.join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'));
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await splash(2732, 2732, path.join(ios, 'Splash.imageset', f));

// the icon for the website / store listings
await png(markSvg(512, 0.6, true, 96), path.join(root, 'resources/icon-512.png'));
console.log('icons and splash screens written');
