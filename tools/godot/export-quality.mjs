// Writes the QUALITY presets and GRAPHICS_GROUPS of apps/client/src/settings.ts as JSON (godot/data/quality.json).
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('apps/client/src/settings.ts', 'utf8');
function literal(name) {
  const i = src.indexOf(`export const ${name}`);
  const open = src.indexOf('{', src.indexOf('=', i));
  let depth = 0;
  let j = open;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) break;
  }
  return src.slice(open, j + 1);
}
const quality = new Function(`return (${literal('QUALITY')})`)();
const groups = new Function(`return (${literal('GRAPHICS_GROUPS')})`)();
writeFileSync('godot/data/quality.json', JSON.stringify({ quality, groups }, null, 1));
console.log(Object.keys(quality), Object.keys(groups));
