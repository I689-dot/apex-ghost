// Downloads the country flags of the driver profile (the COUNTRIES list of apps/client/src/ui/social.ts) from
// flagcdn.com into godot/assets_static/flags/<cc>.png (40 px wide), so the game shows them offline.
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
const src = readFileSync('apps/client/src/ui/social.ts', 'utf8');
const m = src.match(/const COUNTRIES = \(([\s\S]*?)\)\.split/);
const codes = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].flatMap((x) => x[1].trim().split(/\s+/));
mkdirSync('godot/assets_static/flags', { recursive: true });
let n = 0;
for (const cc of codes) {
  const out = `godot/assets_static/flags/${cc.toLowerCase()}.png`;
  if (existsSync(out)) continue;
  const res = await fetch(`https://flagcdn.com/w40/${cc.toLowerCase()}.png`);
  if (!res.ok) {
    console.warn('missing', cc, res.status);
    continue;
  }
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  n++;
}
console.log(codes.length, 'codes,', n, 'downloaded');
