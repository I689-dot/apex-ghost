#!/usr/bin/env node
/**
 * Points the Godot app's Spa layout (godot/data/tracks/spa.json) at the render chunks build_render.py wrote
 * (godot/assets/maps/spa_g/): its "chunks" and "files". Centreline, gates, sectors, pit lane, grid and limits stay (the
 * server's timing data; see collision.mjs). The scattered forest (build_forest.py, packed by tools/godot/pack-forest.mjs)
 * goes in "forest" when it has been built.
 *   node tools/asset-pipeline/spa_godot/layout.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = 'assets/maps/spa_g';
const chunks = JSON.parse(readFileSync(path.join(root, 'godot', dir, 'chunks.json'), 'utf8'));
const tf = path.join(root, 'godot/data/tracks/spa.json');
const td = JSON.parse(readFileSync(tf, 'utf8'));
const V = `?v=g${Date.now().toString(36)}`;
const kinds = [...new Set(chunks.map((c) => c.kind))];
td.files = Object.fromEntries(kinds.map((k) => [k, `${dir}/map_${k}.glb${V}`]));
td.chunks = chunks.map((c) => ({ file: `${dir}/map_${c.kind}.glb${V}`, node: c.name, center: c.center, radius: c.radius, kind: c.kind }));
if (existsSync(path.join(root, 'godot', dir, 'forest_pack.bin'))) td.forest = { file: `${dir}/forest.bin${V}`, meta: `${dir}/forest.json${V}` };
writeFileSync(tf, JSON.stringify(td));
console.log(`[spa layout] ${td.forest ? 'forest, ' : ''}${td.chunks.length} chunks (${kinds.map((k) => `${k} ${chunks.filter((c) => c.kind === k).length}`).join(', ')})`);
