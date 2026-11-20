#!/usr/bin/env node
/**
 * A circuit's track file for the Godot app (godot/data/tracks/<id>.json), its entry in godot/data/tracks.json and the
 * game server's entry (packages/shared/src/generated/tracks-race.json: the gates, sectors and pit distances that time
 * online laps; the web game does not list these circuits, so optimize.mjs never writes them). Silverstone's
 * tools/asset-pipeline/silverstone/track.mjs did this first; this one reads the circuit's config
 * (tools/asset-pipeline/circuit/<id>.json: id, name, "turns", and "map" for the folder, default the id).
 *
 * From the track analysis's track_base.json (centreline, widths, gates, sectors, grid, pit lane), the track limits from
 * the painted edge lines (track_limits.mjs on the render's lines_* meshes), the render chunks (spa_godot/
 * build_render.py's chunks.json) and the collision (spa_godot/collision.mjs --config).
 *
 *   node tools/asset-pipeline/circuit/track.mjs <id> <analysis out dir>
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
const [id, out] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(path.join(here, `${id}.json`), 'utf8'));
const map = cfg.map ?? id;
const dir = `assets/maps/${map}`;
const tag = `[${id} track]`;
const base = JSON.parse(readFileSync(path.join(out, 'track_base.json'), 'utf8'));
const ver = (f) => `?v=${Math.round(statSync(path.join(godot, f)).mtimeMs).toString(36)}`;

const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.join(godot, dir, 'map_track.glb'));
const lim = trackLimitsFromLines(doc, base);
// the layout's corners (the Safety Rating's corners a lap)
if (cfg.turns) base.turns = cfg.turns;
base.limitL = lim.limitL;
base.limitR = lim.limitR;
console.log(`${tag} track limits from the edge lines: ${Math.round((lim.painted / (2 * lim.limitL.length)) * 100)} % painted`);

const files = {};
for (const k of ['track', 'scenery', 'trees', 'terrain']) if (existsSync(path.join(godot, dir, `map_${k}.glb`))) files[k] = `${dir}/map_${k}.glb${ver(`${dir}/map_${k}.glb`)}`;
const chunks = JSON.parse(readFileSync(path.join(godot, dir, 'chunks.json'), 'utf8'))
  .filter((c) => files[c.kind])
  .map((c) => ({ file: files[c.kind], node: c.name, center: c.center, radius: c.radius, kind: c.kind }));
base.chunks = chunks;
base.files = files;
base.collision = { file: `${dir}/collision.apxc${ver(`${dir}/collision.apxc`)}`, surfaces: ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'] };
if (existsSync(path.join(godot, dir, 'forest.json')))
  base.forest = { file: `${dir}/forest.bin${ver(`${dir}/forest.json`)}`, meta: `${dir}/forest.json${ver(`${dir}/forest.json`)}` };
writeFileSync(path.join(godot, `data/tracks/${id}.json`), JSON.stringify(base));
console.log(`${tag} godot/data/tracks/${id}.json: ${base.length.toFixed(1)} m, ${chunks.length} chunks, ${base.gates.length} gates`);

const idxFile = path.join(godot, 'data/tracks.json');
const idx = JSON.parse(readFileSync(idxFile, 'utf8'));
const entry = { id, name: cfg.name, length: Math.round(base.length * 100) / 100, turns: cfg.turns ?? null, file: `assets/tracks/${id}.json${ver(`data/tracks/${id}.json`)}`, default: false, map };
idx.tracks = idx.tracks.filter((t) => t.id !== id).concat([entry]);
writeFileSync(idxFile, JSON.stringify(idx));
console.log(`${tag} godot/data/tracks.json: ${cfg.name} added`);

const racesFile = path.join(root, 'packages/shared/src/generated/tracks-race.json');
const races = JSON.parse(readFileSync(racesFile, 'utf8'));
races[id] = {
  id,
  name: cfg.name,
  length: base.length,
  centerline: base.centerline,
  cumS: base.cumS,
  gates: base.gates,
  sectorGates: base.sectorGates,
  firstGate: base.firstGate,
  minLapMs: base.minLapMs,
  pitExitS: base.pitLane ? base.pitLane.exitS : null,
  pitEntryS: base.pitLane ? base.pitLane.entryS : null,
  pitLaneM: base.pitLane ? Math.round(base.pitLane.length * 10) / 10 : null,
  turns: base.turns ?? null,
};
writeFileSync(racesFile, JSON.stringify(races));
console.log(`${tag} the game server's entry: packages/shared/src/generated/tracks-race.json`);
