#!/usr/bin/env node
/**
 * The game's own name on the circuits' invented boards, in the Godot app's copies of the maps (godot/assets/maps): the
 * game was Apex Ghost until 2026-11-17, CorsaGhost until 2026-11-18, and is GridCorsa now. The sign rules of tools/asset-pipeline/maps/<map>.json
 * that put the old name on a board are drawn again with it replaced (the boards' other invented sponsors stay as they
 * are). The web game's maps are not touched. (The Nürburgring GP circuit is godot/assets/track.)
 *
 *   node tools/godot/rename-signage.mjs [--preview out/dir]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySignage } from '../asset-pipeline/signage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const args = process.argv.slice(2);
const preview = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null;
const OLD = /APEX GHOST/g;
// (a thin space each side: the sign tool sizes a label by its letters, and GRIDCORSA's are wider than APEX GHOST's;
// unpadded, its first letter went off the board)
const NEW = '\u2009GRIDCORSA\u2009';
// map rules -> the Godot app's folder of that map
const MAPS = { nurburgring: 'track' };
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const [map, folder] of Object.entries(MAPS)) {
  const cfg = JSON.parse(readFileSync(path.join(root, 'tools/asset-pipeline/maps', `${map}.json`), 'utf8'));
  const rules = (cfg.signage ?? [])
    .filter((r) => JSON.stringify(r).match(OLD))
    .map((r) => JSON.parse(JSON.stringify(r).replace(OLD, NEW)));
  const dir = path.join(root, 'godot/assets', folder);
  if (!rules.length || !existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
    const file = path.join(dir, f);
    const doc = await io.read(file);
    const done = await applySignage(doc, rules, { preview });
    if (!done.length) continue;
    await io.write(file, doc);
    console.log(`[rename-signage] ${folder}/${f}: ${done.join(', ')}`);
  }
}
