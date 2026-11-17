#!/usr/bin/env node
/**
 * Takes the makers' badges that are modelled (raised rings, stars, crests, horses: separate small pieces of the body)
 * off the cars; debrand.mjs paints over the ones inside textures. tools/godot/debrand-mesh.json lists, per car, the
 * badges as a material and a box in the car's frame (+Z forward, +Y up, metres): every separate piece of that
 * material lying wholly inside the box goes (pieces are found by shared corners; nothing is cut, so a panel the box
 * only touches stays). Two more kinds of entry:
 *   "cut": a badge joined to a bigger part (the AMGs' grille star, one piece with the whole grille): the triangles of
 *          that material within `radius` of `centre` [x, y] and between `z` [z0, z1], taken only from pieces larger
 *          than `minPiece` m (the slats in front of and behind it are pieces of their own and stay)
 *   "flatten": a badge's recess pressed into a panel (the Porsche's bonnet): the panel's corners inside `box` moved
 *          onto the plane of the panel round it, so the panel runs smooth over where the badge was
 * Runs again without change.
 *
 *   node tools/godot/debrand-mesh.mjs <car id> <file.glb> [more.glb ...]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [carId, ...files] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'debrand-mesh.json'), 'utf8'))[carId] ?? [];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
// a material by its name with or without the lamp prefixes tail-lights.mjs adds
const bare = (n) => n.replace(/^LIGHT_(HEAD|TAIL)_/, '');

/** "flatten": the corners inside each box onto the least-squares plane of the corners in a band round it (in the car's
 * frame, back into the mesh's), their normals the plane's. Returns how many corners moved. */
function flatten(prim, m, flats) {
  const pos = prim.getAttribute('POSITION');
  const nrm = prim.getAttribute('NORMAL');
  const inv = invert(m);
  let moved = 0;
  for (const f of flats) {
    const b = f.box;
    const band = f.band ?? 0.04;
    const isIn = (q) => q[0] >= b[0] && q[1] >= b[1] && q[2] >= b[2] && q[0] <= b[3] && q[1] <= b[4] && q[2] <= b[5];
    const nearBy = (q) => q[0] >= b[0] - band && q[1] >= b[1] - band && q[2] >= b[2] - band && q[0] <= b[3] + band && q[1] <= b[4] + band && q[2] <= b[5] + band;
    const ring = [];
    const inner = [];
    for (let i = 0; i < pos.getCount(); i++) {
      const q = apply(m, pos.getElement(i, []));
      if (isIn(q)) inner.push([i, q]);
      else if (nearBy(q)) ring.push(q);
    }
    if (ring.length < 3 || !inner.length) continue;
    // the plane: through the ring's centroid, normal = the smallest axis of its covariance (power iteration on the
    // inverse is overkill: the panel faces mostly one way, so fit n = (a, b, 1)-style by least squares on the axis
    // the panel faces most)
    const c = [0, 1, 2].map((k) => ring.reduce((s, q) => s + q[k], 0) / ring.length);
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const q of ring) for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) cov[r][s] += (q[r] - c[r]) * (q[s] - c[s]);
    const n = smallestEigen(cov);
    for (const [i, q] of inner) {
      const d = (q[0] - c[0]) * n[0] + (q[1] - c[1]) * n[1] + (q[2] - c[2]) * n[2];
      const p = [q[0] - n[0] * d, q[1] - n[1] * d, q[2] - n[2] * d];
      pos.setElement(i, apply(inv, p));
      if (nrm) {
        const old = nrm.getElement(i, []);
        // the plane's normal in the mesh's frame, the way the old one faced
        const ln = normalize(applyDir(inv, n));
        const s = old[0] * ln[0] + old[1] * ln[1] + old[2] * ln[2] < 0 ? -1 : 1;
        nrm.setElement(i, ln.map((v) => v * s));
      }
      moved++;
    }
  }
  return moved;
}

const applyDir = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
const normalize = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};

function smallestEigen(a) {
  // inverse power iteration on a + eps I
  const e = 1e-9;
  const m = a.map((r, i) => r.map((v, j) => v + (i === j ? e : 0)));
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const inv = [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det],
  ];
  let v = normalize([0.3, 0.9, 0.3]);
  for (let k = 0; k < 60; k++) v = normalize([0, 1, 2].map((r) => inv[r][0] * v[0] + inv[r][1] * v[1] + inv[r][2] * v[2]));
  return v;
}

function invert(m) {
  // an affine 4x4 (column-major): the 3x3 inverted, the translation taken back
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[3] * (a[1] * a[8] - a[2] * a[7]) + a[6] * (a[1] * a[5] - a[2] * a[4]);
  const i = [
    (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  const t = [m[12], m[13], m[14]];
  const it = [0, 1, 2].map((r) => -(i[r] * t[0] + i[r + 3] * t[1] + i[r + 6] * t[2]));
  return [i[0], i[1], i[2], 0, i[3], i[4], i[5], 0, i[6], i[7], i[8], 0, it[0], it[1], it[2], 1];
}

for (const file of files) {
  if (!cfg.length) break;
  const doc = await io.read(file);
  let gone = 0;
  let moved = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const name = bare(prim.getMaterial()?.getName() ?? '');
      const mine = cfg.filter((b) => b.mat === name);
      const boxes = mine.filter((b) => !b.kind).map((b) => b.box);
      const cuts = mine.filter((b) => b.kind === 'cut');
      const flats = mine.filter((b) => b.kind === 'flatten');
      const idx = prim.getIndices();
      if (!mine.length || !idx) continue;
      if (flats.length) moved += flatten(prim, m, flats);
      if (!boxes.length && !cuts.length) continue;
      const pos = prim.getAttribute('POSITION');
      const nv = pos.getCount();
      // pieces: corners joined by the triangles, and corners at the same place (split normals, UV seams)
      const par = new Int32Array(nv);
      for (let i = 0; i < nv; i++) par[i] = i;
      const find = (a) => {
        while (par[a] !== a) a = par[a] = par[par[a]];
        return a;
      };
      const join = (a, b) => {
        a = find(a);
        b = find(b);
        if (a !== b) par[b] = a;
      };
      const seen = new Map();
      const t = [];
      for (let i = 0; i < nv; i++) {
        const k = pos.getElement(i, t).map((v) => Math.round(v * 2000)).join(',');
        if (seen.has(k)) join(seen.get(k), i);
        else seen.set(k, i);
      }
      for (let i = 0; i < idx.getCount(); i += 3) {
        join(idx.getScalar(i), idx.getScalar(i + 1));
        join(idx.getScalar(i), idx.getScalar(i + 2));
      }
      // each piece's extent in the car's frame
      const ext = new Map();
      for (let i = 0; i < nv; i++) {
        const r = find(i);
        const q = apply(m, pos.getElement(i, t));
        const e = ext.get(r);
        if (!e) ext.set(r, [q.slice(), q.slice()]);
        else for (let k = 0; k < 3; k++) (e[0][k] = Math.min(e[0][k], q[k])), (e[1][k] = Math.max(e[1][k], q[k]));
      }
      const inside = ([lo, hi], b) => lo[0] >= b[0] && lo[1] >= b[1] && lo[2] >= b[2] && hi[0] <= b[3] && hi[1] <= b[4] && hi[2] <= b[5];
      const drop = new Set();
      for (const [r, e] of ext) if (boxes.some((b) => inside(e, b))) drop.add(r);
      const big = new Set();
      for (const [r, [lo, hi]] of ext) if (Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) > Math.min(...cuts.map((c) => c.minPiece ?? 0.5), 99)) big.add(r);
      const inCut = (i0) => {
        if (!cuts.length || !big.has(find(idx.getScalar(i0)))) return false;
        const q = [0, 1, 2].map((k) => apply(m, pos.getElement(idx.getScalar(i0 + k), [])));
        return cuts.some((c) => q.every((v) => Math.hypot(v[0] - c.centre[0], v[1] - c.centre[1]) <= c.radius && v[2] >= c.z[0] && v[2] <= c.z[1]));
      };
      const keep = [];
      for (let i = 0; i < idx.getCount(); i += 3) {
        const a = idx.getScalar(i);
        if (drop.has(find(a)) || inCut(i)) {
          gone++;
          continue;
        }
        keep.push(a, idx.getScalar(i + 1), idx.getScalar(i + 2));
      }
      if (keep.length === idx.getCount()) continue;
      if (keep.length === 0) prim.dispose();
      else prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new (idx.getArray().constructor)(keep)).setBuffer(idx.getBuffer()));
    }
  }
  if (gone || moved) {
    await doc.transform(prune());
    await io.write(file, doc);
  }
  console.log(`[debrand-mesh] ${carId} ${path.basename(file)}: ${gone} badge triangles removed, ${moved} recess corners levelled`);
}
