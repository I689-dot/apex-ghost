#!/usr/bin/env node
// Packs the forest (assets/**/forest.bin + forest.json: 8 bytes per tree, sorted in 128 m cells) into what the Godot
// client can hand straight to a MultiMesh: 16 floats a tree (3x4 transform rows + colour), trees of a cell sorted by a
// per-tree hash so that "the first n of a cell" is a random thinning. Writes forest_pack.bin / forest_pack.json beside it.
//   transform: yaw, scale s, crown slimness; colour: brightness tint (rgb), alpha = species (0..2 spruce variants, 3 broadleaf)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? fileURLToPath(new URL('../../godot/assets', import.meta.url));
const SPRUCES = 3;

function* find(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* find(p);
    else if (f === 'forest.json') yield p;
  }
}

for (const metaPath of find(root)) {
  const binPath = join(dirname(metaPath), 'forest.bin');
  if (!existsSync(binPath)) continue;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const raw = readFileSync(binPath);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = meta.count;
  const out = new Float32Array(n * 16);
  const cells = [];
  let written = 0;
  for (const [cell, first, count] of meta.cells) {
    const trees = [];
    for (let i = first; i < first + count; i++) {
      const o = i * 8;
      const x = meta.version >= 2 ? meta.origin[0] + dv.getUint16(o, true) / 5 : dv.getInt16(o, true) / 10;
      const z = meta.version >= 2 ? meta.origin[1] + dv.getUint16(o + 2, true) / 5 : dv.getInt16(o + 2, true) / 10;
      const y = dv.getInt16(o + 4, true) / 20;
      const s = dv.getUint8(o + 6) / 100;
      const ty = dv.getUint8(o + 7);
      const type = ty >> 7;
      const yaw = ((ty & 127) / 127) * Math.PI * 2;
      let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      const keep = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      const tint = 0.8 + 0.4 * (((h >>> 8) & 255) / 255);
      const slim = 0.78 + 0.4 * (((h >>> 20) & 255) / 255);
      const kind = type ? SPRUCES : Math.floor(keep * 7919) % SPRUCES;
      trees.push({ x, y, z, s, yaw, type, keep, tint, slim, kind });
    }
    trees.sort((a, b) => a.keep - b.keep);
    for (const t of trees) {
      const w = t.s * t.slim;
      const c = Math.cos(t.yaw) * w;
      const sn = Math.sin(t.yaw) * w;
      const o = written * 16;
      // rows of the basis, then the origin (a MultiMesh's buffer layout); the base sinks 0.4 m into slopes
      out.set([c, 0, sn, t.x, 0, t.s, 0, t.y - 0.4, -sn, 0, c, t.z], o);
      out.set([t.tint * (t.type ? 1.03 : 0.97), t.tint, t.tint * 0.95, t.kind], o + 12);
      written++;
    }
    cells.push([cell, written - count, count, Math.min(...trees.map((t) => t.y)), Math.max(...trees.map((t) => t.y + t.s * 25))]);
  }
  writeFileSync(join(dirname(metaPath), 'forest_pack.bin'), Buffer.from(out.buffer, 0, written * 64));
  writeFileSync(join(dirname(metaPath), 'forest_pack.json'), JSON.stringify({ cell: meta.cell, origin: meta.origin, nx: meta.nx, nz: meta.nz, count: written, cells }));
  console.log(`${metaPath}: ${written} trees -> forest_pack (${((written * 64) / 1048576).toFixed(1)} MB)`);
}
