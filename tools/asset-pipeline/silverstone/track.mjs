#!/usr/bin/env node
/**
 * Silverstone's track file for the Godot app (godot/data/tracks/silverstone.json) and its entry in godot/data/tracks.json:
 * the track analysis's track_base.json (centreline, widths, gates, sectors, grid, pit lane; the analysis run on the
 * prepared model, prep.py), the track limits from the edge lines (track_limits.mjs on the render's lines_ss), the
 * render chunks (spa_godot/build_render.py's chunks.json) and the collision (spa_godot/collision.mjs --config).
 *
 *   node tools/asset-pipeline/silverstone/track.mjs <analysis out dir>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackLimitsFromLines } from '../track_limits.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const godot = path.join(root, 'godot');
const dir = 'assets/maps/silverstone';
const out = process.argv[2];
const base = JSON.parse(readFileSync(path.join(out, 'track_base.json'), 'utf8'));
const ver = (f) => `?v=${Math.round(statSync(path.join(godot, f)).mtimeMs).toString(36)}`;

const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.join(godot, dir, 'map_track.glb'));
const lim = trackLimitsFromLines(doc, base);
base.limitL = lim.limitL;
base.limitR = lim.limitR;
console.log(`[ss track] track limits from the edge lines: ${Math.round((lim.painted / (2 * lim.limitL.length)) * 100)} % painted`);

const files = {};
for (const k of ['track', 'scenery', 'trees', 'terrain']) files[k] = `${dir}/map_${k}.glb${ver(`${dir}/map_${k}.glb`)}`;
const chunks = JSON.parse(readFileSync(path.join(godot, dir, 'chunks.json'), 'utf8')).map((c) => ({
  file: files[c.kind],
  node: c.name,
  center: c.center,
  radius: c.radius,
  kind: c.kind,
}));
base.chunks = chunks;
base.files = files;
base.collision = { file: `${dir}/collision.apxc${ver(`${dir}/collision.apxc`)}`, surfaces: ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'] };
if (existsSync(path.join(godot, dir, 'forest.json')))
  base.forest = { file: `${dir}/forest.bin${ver(`${dir}/forest.json`)}`, meta: `${dir}/forest.json${ver(`${dir}/forest.json`)}` };
writeFileSync(path.join(godot, 'data/tracks/silverstone.json'), JSON.stringify(base));
console.log(`[ss track] godot/data/tracks/silverstone.json: ${base.length.toFixed(1)} m, ${chunks.length} chunks, ${base.gates.length} gates`);

const idxFile = path.join(godot, 'data/tracks.json');
const idx = JSON.parse(readFileSync(idxFile, 'utf8'));
const entry = { id: 'silverstone', name: 'Silverstone Circuit', length: Math.round(base.length * 100) / 100, turns: 18, file: `assets/tracks/silverstone.json${ver('data/tracks/silverstone.json')}`, default: false, map: 'silverstone' };
idx.tracks = idx.tracks.filter((t) => t.id !== 'silverstone').concat([entry]);
writeFileSync(idxFile, JSON.stringify(idx));
console.log('[ss track] godot/data/tracks.json: Silverstone added');
