// Writes the Spanish table of apps/client/src/i18n.ts as JSON for the Godot port (godot/data/i18n_es.json).
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('apps/client/src/i18n.ts', 'utf8');
const start = src.indexOf('const ES: Record<string, string> = {');
const body = src.slice(src.indexOf('{', start));
const end = body.lastIndexOf('};');
const table = new Function(`return (${body.slice(0, end + 1)})`)();
writeFileSync('godot/data/i18n_es.json', JSON.stringify(table, null, 1));
console.log(Object.keys(table).length, 'entries');
