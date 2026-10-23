#!/usr/bin/env node
/**
 * Road collision from the render meshes, for maps whose collision layers can't be told apart without material
 * names (maps/<id>.json "roadCollisionFromRender").
 *
 * Zandvoort's source stacks its road: the run-off and road base (asph_zv96) under everything, the racing
 * surface, rubbered strips, edge lines and kerbs 1.5–3 cm above it (render offsets against z-fighting), and the
 * banked new asphalt crossing the racing surface ~1 cm apart. The raw collision has one mesh per surface, so
 * flatten_layers.mjs had to guess which layer was paint: it snapped the racing surface down only where the base
 * ran on under it (steps of up to 15 cm) and dropped both layers where they crossed (1.5 m holes in the banking).
 * Here the materials are known: the asphalt and kerb collision is rebuilt from the render chunks, the layers the
 * config names as overlays are laid onto the road under them, and everything else stays exactly as it is drawn.
 *
 *   node tools/asset-pipeline/road_collision.mjs --map zandvoort [--out file.apxc]
 *       rebuilds the shipped collision.apxc in place (grass, gravel, walls and the hole fill are kept) and bumps
 *       its ?v= in the layout JSONs; --out writes elsewhere and leaves the JSONs alone (for comparisons)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapStackedLayers } from './flatten_layers.mjs';

export const SURF = ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'];

export function weldPositions(pos, idx) {
  const map = new Map();
  const outPos = [];
  const remap = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[i * 3] * 500)},${Math.round(pos[i * 3 + 1] * 500)},${Math.round(pos[i * 3 + 2] * 500)}`;
    let j = map.get(k);
    if (j === undefined) {
      j = outPos.length / 3;
      map.set(k, j);
      outPos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    remap[i] = j;
  }
  const outIdx = [];
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]];
    const b = remap[idx[t + 1]];
    const c = remap[idx[t + 2]];
    if (a !== b && b !== c && a !== c) {
      outIdx.push(a, b, c);
      keep.push(t / 3);
    }
  }
  return { pos: new Float32Array(outPos), idx: new Uint32Array(outIdx), keep };
}

/** collision.apxc: gzip of 'APXC' u32 version u32 count, per sub-mesh u32 surface u32 vertexCount u32 indexCount, f32 positions[], u32 indices[] */
export function readApxc(file) {
  const raw = readFileSync(file);
  const buf = raw[0] === 0x1f ? gunzipSync(raw) : raw;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const parts = [];
  let o = 12;
  for (let i = 0, n = dv.getUint32(8, true); i < n; i++) {
    const si = dv.getUint32(o, true);
    const nv = dv.getUint32(o + 4, true);
    const ni = dv.getUint32(o + 8, true);
    o += 12;
    const pos = new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12));
    o += nv * 12;
    const idx = new Uint32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + ni * 4));
    o += ni * 4;
    parts.push({ si, pos, idx });
  }
  return parts;
}

export function writeApxc(file, parts) {
  let size = 12;
  for (const p of parts) size += 12 + p.pos.byteLength + p.idx.byteLength;
  const buf = Buffer.alloc(size);
  buf.write('APXC', 0, 'ascii');
  buf.writeUInt32LE(1, 4);
  buf.writeUInt32LE(parts.length, 8);
  let o = 12;
  for (const p of parts) {
    buf.writeUInt32LE(p.si, o);
    buf.writeUInt32LE(p.pos.length / 3, o + 4);
    buf.writeUInt32LE(p.idx.length, o + 8);
    o += 12;
    Buffer.from(p.pos.buffer, p.pos.byteOffset, p.pos.byteLength).copy(buf, o);
    o += p.pos.byteLength;
    Buffer.from(p.idx.buffer, p.idx.byteOffset, p.idx.byteLength).copy(buf, o);
    o += p.idx.byteLength;
  }
  // gzip ourselves (static hosts do not reliably compress binaries); the client sniffs the gzip magic
  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(file, gz);
  return { raw: size, gz: gz.length };
}

/** Surface of a material by the map's rules ([regex, surface] pairs, first match wins). */
function surfaceOf(name, rules) {
  for (const [re, s] of rules) if (re.test(name)) return s;
  return null;
}

/**
 * Asphalt and kerb collision from render GLBs (world space, quantised or not), with stacked overlays laid onto
 * the road under them. Returns one part per surface ({ si, pos, idx }) and what was done, for the log.
 * @param {import('@gltf-transform/core').PlatformIO} io
 * @param {string[]} files GLBs to read (missing ones are skipped)
 * @param {[string, string][]} surfaceRules maps/<id>.json analysis.surfaceRules
 * @param {string} overlay regex of the overlay materials (paint, decals: snapped / dropped onto the road below)
 */
export async function roadPartsFromGlbs(io, files, surfaceRules, overlay) {
  const rules = surfaceRules.map(([re, s]) => [new RegExp(re, 'i'), s]);
  const overlayRe = new RegExp(overlay, 'i');
  /** material → its triangles in world space (all chunks) */
  const mats = new Map();
  const v = [0, 0, 0];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const doc = await io.read(file);
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const w = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const name = prim.getMaterial()?.getName() ?? '';
        const surface = surfaceOf(name, rules);
        if ((surface !== 'asphalt' && surface !== 'curb') || !prim.getIndices()) continue;
        let m = mats.get(name);
        if (!m) mats.set(name, (m = { surface, pos: [], idx: [] }));
        const attr = prim.getAttribute('POSITION');
        const base = m.pos.length / 3;
        for (let i = 0; i < attr.getCount(); i++) {
          attr.getElement(i, v);
          m.pos.push(
            w[0] * v[0] + w[4] * v[1] + w[8] * v[2] + w[12],
            w[1] * v[0] + w[5] * v[1] + w[9] * v[2] + w[13],
            w[2] * v[0] + w[6] * v[1] + w[10] * v[2] + w[14],
          );
        }
        const ix = prim.getIndices().getArray();
        for (let k = 0; k < ix.length; k++) m.idx.push(base + ix[k]);
      }
    }
  }
  // 1. pieces of one material overlapping a few cm (seams of the source: a 2 cm lip where two banked asphalt
  //    pieces overlap, kerbs laid over themselves) become one surface; different materials don't touch here
  const acc = { asphalt: { pos: [], idx: [], over: [] }, curb: { pos: [], idx: [], over: [] } };
  let seamSnapped = 0;
  let seamDropped = 0;
  for (const [name, m] of mats) {
    const welded = weldPositions(new Float32Array(m.pos), new Uint32Array(m.idx));
    const r = snapStackedLayers(welded);
    seamSnapped += r.snapped;
    seamDropped += r.dropped;
    const a = acc[m.surface];
    const base = a.pos.length / 3;
    for (const x of welded.pos) a.pos.push(x);
    for (const i of r.idx) a.idx.push(base + i);
    const over = overlayRe.test(name) ? 1 : 0;
    for (let t = 0; t < r.idx.length / 3; t++) a.over.push(over);
  }
  // 2. overlays (paint, decals, the racing surface's skin) onto the road under them
  const parts = [];
  const notes = [`seams within one material: ${seamSnapped} vertices snapped, ${seamDropped} triangles dropped`];
  for (const [s, a] of Object.entries(acc)) {
    if (!a.idx.length) continue;
    const { pos, idx, keep } = weldPositions(new Float32Array(a.pos), new Uint32Array(a.idx));
    const over = Uint8Array.from(keep, (t) => a.over[t]);
    const r = snapStackedLayers({ pos, idx }, over);
    parts.push({ si: SURF.indexOf(s), pos, idx: r.idx });
    notes.push(
      `${s}: ${idx.length / 3} tris (${over.reduce((n, o) => n + o, 0)} overlay), ${r.snapped} overlay vertices laid onto the road (up to ${(r.maxGap * 100).toFixed(1)} cm), ${r.dropped} dropped`,
    );
  }
  return { parts, notes };
}

/* ------------------------------------------------------- CLI: shipped collision, in place --- */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
  const MAP = JSON.parse(readFileSync(path.join(here, 'maps', `${opt('map', 'zandvoort')}.json`), 'utf8'));
  const cfg = MAP.roadCollisionFromRender;
  if (!cfg) throw new Error(`maps/${MAP.id}.json has no "roadCollisionFromRender"`);
  const pubRoot = path.join(here, '../../apps/client/public');
  const dir = path.join(pubRoot, 'assets', MAP.assets);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const road = await roadPartsFromGlbs(
    io,
    ['track', 'scenery'].map((k) => path.join(dir, `map_${k}.glb`)),
    MAP.analysis.surfaceRules,
    opt('overlay', cfg.overlay),
  );
  for (const n of road.notes) console.log(`[road-collision] ${n}`);
  // grass, gravel, sand, walls and the hole fill stay as they are
  const kept = readApxc(path.join(dir, 'collision.apxc')).filter((p) => SURF[p.si] !== 'asphalt' && SURF[p.si] !== 'curb');
  const parts = [...road.parts, ...kept];
  const out = opt('out', path.join(dir, 'collision.apxc'));
  const size = writeApxc(out, parts);
  const tris = parts.reduce((n, p) => n + p.idx.length / 3, 0);
  console.log(
    `[road-collision] ${path.relative(process.cwd(), out)}: ${tris} tris, ${(size.raw / 1e6).toFixed(2)} MB raw, ${(size.gz / 1e6).toFixed(2)} MB gzipped`,
  );
  if (!args.includes('--out')) {
    // new file version for every layout that uses this collision (immutable caching on the website, the app's cache)
    const v = `?v=${Date.now().toString(36)}`;
    const rel = `assets/${MAP.assets}/collision.apxc`;
    const layouts = [
      path.join(pubRoot, 'assets/track.json'),
      ...readdirSync(path.join(pubRoot, 'assets/tracks')).map((f) => path.join(pubRoot, 'assets/tracks', f)),
    ];
    for (const f of layouts) {
      const text = readFileSync(f, 'utf8');
      const next = text.replace(new RegExp(`${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?v=[0-9a-z]+`, 'g'), `${rel}${v}`);
      if (next !== text) {
        writeFileSync(f, next);
        console.log(`[road-collision] ${path.relative(process.cwd(), f)}: ${rel}${v}`);
      }
    }
  }
}
