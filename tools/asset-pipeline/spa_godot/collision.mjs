#!/usr/bin/env node
/**
 * Spa-Francorchamps collision for the Godot app, from the new source model (RESOURCES/CIRCUIT-MODELS/...zip, source/spa.glb).
 *
 * The new model is the same geometry as the one the web game's Spa was built from (3DMODELS/...usdz): fitted on rigid
 * props it matches it within 1 cm after one similarity transform (config.json "toGameFrame", found by
 * ~/apex-ghost-sources/survey-tools/exactfit.py). It is built in the game's existing frame, not at 1:1, so the shared
 * server's Spa centreline, gates, sectors and pit distances (packages/shared/src/generated/tracks-race.json, which time
 * online laps) stay valid with no server change. That frame is 1.01 % larger than the source's metres, as before.
 *
 * Differences from the web pipeline's collision (optimize.mjs collision(), which this reuses piece by piece):
 *  - the rubber layers and paint (groove*, line, doted_line) are left out of the collision: they float up to 26 cm
 *    over the asphalt at T9 and 11 cm at Fagnes (the old "seam"), which snapStackedLayers could not reach (15 cm);
 *    99 % of them lie over base asphalt, the rest over kerbs, astroturf or gravel that have their own collision;
 *  - so no smoothRoad patch is needed.
 * Kept: per-surface welding and seam snapping, simplification, kerb subdivision and kerbSkirts; kerbs levelled by
 * kerb_level.mjs (conformKerbs left steps at kerbs away from the road and between two road levels).
 *
 *   node tools/asset-pipeline/spa_godot/collision.mjs [--glb <spa.glb>] [--out <collision.apxc>]
 *     default --glb: $SPA_GLB, else ~/apex-ghost-sources/spa/source/spa.glb
 *     default --out: godot/assets/maps/spa/collision.apxc (the Godot copy only: the web game's file is not touched);
 *     with the default --out the ?v= of the collision in godot/data/tracks/spa.json is bumped
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { snapStackedLayers } from '../flatten_layers.mjs';
import { conformKerbs, kerbSkirts, subdivide } from '../kerb_conform.mjs';
import { levelKerbs } from './kerb_level.mjs';
import { SURF, weldPositions, writeApxc } from '../road_collision.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const CFG = JSON.parse(readFileSync(path.join(here, 'config.json'), 'utf8'));
const glbFile = opt('glb', process.env.SPA_GLB ?? path.join(homedir(), 'apex-ghost-sources/spa/source/spa.glb'));
const defaultOut = path.join(root, 'godot/assets/maps/spa/collision.apxc');
const outFile = opt('out', defaultOut);

// same as optimize.mjs (SIMPLIFY_ERR, SIMPLIFY_MAX_M)
const SIMPLIFY_ERR = { asphalt: 0, curb: 0, grass: 0.00004, gravel: 0, sand: 0.00004, wall: 0.00012 };
const SIMPLIFY_MAX_M = { grass: 0.08, sand: 0.08 };

const log = (...a) => console.log('[spa collision]', ...a);
const rules = CFG.surfaceRules.map(([re, s]) => [new RegExp(re, 'i'), s]);
const surfaceOf = (name) => {
  for (const [re, s] of rules) if (re.test(name)) return s;
  return null;
};

/** The source's triangles per surface, in the game frame. */
async function readSurfaces(file) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(file);
  const { s, R, t } = CFG.toGameFrame;
  const acc = Object.fromEntries(SURF.map((k) => [k, { pos: [], idx: [] }]));
  const skipped = new Map();
  const v = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const w = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      const surf = surfaceOf(name);
      if (!surf) {
        skipped.set(name, (skipped.get(name) ?? 0) + (prim.getIndices()?.getCount() ?? 0) / 3);
        continue;
      }
      const a = acc[surf];
      const attr = prim.getAttribute('POSITION');
      const base = a.pos.length / 3;
      for (let i = 0; i < attr.getCount(); i++) {
        attr.getElement(i, v);
        // glTF world, then the similarity into the game frame
        const x = w[0] * v[0] + w[4] * v[1] + w[8] * v[2] + w[12];
        const y = w[1] * v[0] + w[5] * v[1] + w[9] * v[2] + w[13];
        const z = w[2] * v[0] + w[6] * v[1] + w[10] * v[2] + w[14];
        a.pos.push(s * (R[0][0] * x + R[0][1] * y + R[0][2] * z) + t[0], s * (R[1][0] * x + R[1][1] * y + R[1][2] * z) + t[1], s * (R[2][0] * x + R[2][1] * y + R[2][2] * z) + t[2]);
      }
      const ix = prim.getIndices().getArray();
      for (let k = 0; k < ix.length; k++) a.idx.push(base + ix[k]);
    }
  }
  return { acc, skipped };
}

function compact(pos, idx) {
  const used = new Int32Array(pos.length / 3).fill(-1);
  const cp = [];
  const ci = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    let v = used[idx[i]];
    if (v < 0) {
      v = used[idx[i]] = cp.length / 3;
      cp.push(pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]);
    }
    ci[i] = v;
  }
  return { pos: new Float32Array(cp), idx: ci };
}

async function main() {
  if (!existsSync(glbFile)) throw new Error(`no source model at ${glbFile} (unzip RESOURCES/CIRCUIT-MODELS/circuit-de-spa-francorchamps-2022-layout.zip, or pass --glb)`);
  await MeshoptSimplifier.ready;
  const { acc, skipped } = await readSurfaces(glbFile);
  const overlays = [...skipped].filter(([n]) => new RegExp(CFG.overlay, 'i').test(n));
  log(`overlays left out: ${overlays.map(([n, c]) => `${n} ${c}`).join(', ')}`);
  const parts = [];
  for (const [si, s] of SURF.entries()) {
    const a = acc[s];
    if (!a.idx.length) continue;
    let { pos, idx } = weldPositions(new Float32Array(a.pos), new Uint32Array(a.idx));
    const before = idx.length / 3;
    if (s !== 'wall') {
      const r = snapStackedLayers({ pos, idx });
      idx = r.idx;
      log(`${s}: stacked layers: ${r.snapped} vertices snapped down (up to ${(r.maxGap * 100).toFixed(1)} cm), ${r.dropped} triangles dropped`);
    }
    if (SIMPLIFY_ERR[s] > 0) {
      let ext = 0;
      for (let c = 0; c < 3; c++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = c; i < pos.length; i += 3) {
          lo = Math.min(lo, pos[i]);
          hi = Math.max(hi, pos[i]);
        }
        ext = Math.max(ext, hi - lo);
      }
      const err = Math.min(SIMPLIFY_ERR[s], (SIMPLIFY_MAX_M[s] ?? Infinity) / ext);
      [idx] = MeshoptSimplifier.simplify(idx, pos, 3, 0, err, ['LockBorder']);
    }
    const c = compact(pos, idx);
    parts.push({ si, ...c });
    log(`${s}: ${before} -> ${c.idx.length / 3} tris`);
  }
  // kerbs level with the surfaces beside them (kerb_level.mjs; NO_CONFORM=1: raw, for checks)
  if (!process.env.NO_CONFORM) {
    for (const p of parts) if (SURF[p.si] === 'curb') Object.assign(p, subdivide(p.pos, p.idx));
    const ground = parts.filter((p) => ['grass', 'gravel', 'sand'].includes(SURF[p.si]));
    const asph = parts.filter((p) => SURF[p.si] === 'asphalt');
    const kerbs = parts.filter((p) => SURF[p.si] === 'curb');
    const mode = process.env.KERB_MODE ?? 'level';
    if (mode === 'hybrid') conformKerbs(asph, kerbs, ground);
    const k = levelKerbs(asph, kerbs, ground, { floorOnly: mode === 'hybrid' });
    const skirt = kerbSkirts(asph, kerbs, ground);
    parts.push({ si: SURF.indexOf('grass'), ...skirt });
    log(`curb: ${k.raised} vertices raised, ${k.lowered} lowered, ${k.humps} humps (up to ${(k.maxMove * 100).toFixed(1)} cm), ${k.lifted} ground vertices lifted to meet a kerb, ${skirt.idx.length / 6} kerb edges skirted`);
  }
  const w = writeApxc(outFile, parts);
  log(`${outFile}: ${parts.reduce((n, p) => n + p.idx.length / 3, 0)} tris, ${(w.raw / 1e6).toFixed(2)} MB raw, ${(w.gz / 1e6).toFixed(2)} MB gzipped`);
  if (outFile === defaultOut) {
    const tf = path.join(root, 'godot/data/tracks/spa.json');
    const td = JSON.parse(readFileSync(tf, 'utf8'));
    td.collision.file = `assets/maps/spa/collision.apxc?v=g${Date.now().toString(36)}`;
    delete td.smoothRoad;
    writeFileSync(tf, JSON.stringify(td));
    log(`${tf}: collision ${td.collision.file}, smoothRoad removed`);
  }
}
await main();
