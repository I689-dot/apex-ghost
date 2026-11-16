#!/usr/bin/env node
/**
 * The parts a heavy hit can tear off a car (the user, 2026-11-16: bumpers flying off in crashes): the models' bodies
 * are one piece, so the parts are cut out of the "body" node by where they are, the same way for every car:
 *   part_bumper_front  the outer half of the front overhang, below 62 % of the body's height (bumper, splitter)
 *   part_bumper_rear   the same at the back (bumper, diffuser)
 *   part_wing          above 82 % of the height, behind the rear axle (the rear wing)
 * Each triangle goes by its centre; the glass and the interior stay on the body. The parts become nodes of their own
 * beside the body (CarVisual finds them by name and CarVisual.detach throws one off). Runs again without change (a
 * file with parts is left alone).
 *
 *   node tools/godot/car-parts.mjs <file.glb> [more.glb ...]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import path from 'node:path';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const KEEP = /glass|window|windscreen|^INT_|interior|cockpit|seat|steer|dash|belt|display|LIGHT_HEAD/i;

function apply(m, p) {
  const [x, y, z] = p;
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  if (root.listNodes().some((n) => n.getName().startsWith('part_'))) {
    // (an earlier run could leave a primitive with no triangles: glTF and Godot refuse them)
    let gone = 0;
    for (const mesh of root.listMeshes())
      for (const p of mesh.listPrimitives())
        if (p.getIndices() && p.getIndices().getCount() === 0) {
          p.dispose();
          gone++;
        }
    if (gone) await io.write(file, doc);
    console.log(`[parts] ${path.basename(file)}: already cut${gone ? `, ${gone} empty primitives dropped` : ''}`);
    continue;
  }
  const body = root.listNodes().find((n) => n.getName() === 'body' && n.getMesh());
  const wheel = (k) => root.listNodes().find((n) => n.getName() === `wheel_${k}`);
  if (!body || !wheel('FL') || !wheel('RL')) {
    console.log(`[parts] ${path.basename(file)}: no body or wheels, left alone`);
    continue;
  }
  const fz = wheel('FL').getWorldTranslation()[2];
  const rz = wheel('RL').getWorldTranslation()[2];
  const m = body.getWorldMatrix();
  // the body's extent in the car's frame (+Z forward, +Y up)
  // (heights from the 0.5th to the 99.5th percentile: a thin roof antenna or a stray point does not set the top)
  let minZ = Infinity, maxZ = -Infinity;
  const ys = [];
  const tmp = [];
  for (const prim of body.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      const p = apply(m, pos.getElement(i, tmp));
      ys.push(p[1]);
      minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
    }
  }
  ys.sort((x, y) => x - y);
  const minY = ys[Math.floor(ys.length * 0.005)];
  const maxY = ys[Math.floor(ys.length * 0.995)];
  const h = maxY - minY;
  const region = (c) => {
    const yf = (c[1] - minY) / h;
    if (c[2] > fz + (maxZ - fz) * 0.45 && yf < 0.62) return 'part_bumper_front';
    if (c[2] < rz - (rz - minZ) * 0.45 && yf < 0.62) return 'part_bumper_rear';
    if (yf > 0.82 && c[2] < rz + 0.25) return 'part_wing';
    return null;
  };
  const parts = {};
  const counts = {};
  const emptied = [];
  for (const prim of body.getMesh().listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? '';
    if (KEEP.test(name)) continue;
    // a plain triangle list (the far model's simplification writes them): indices 0, 1, 2, ... first
    if (!prim.getIndices()) {
      const n = prim.getAttribute('POSITION').getCount();
      const seq = new Uint32Array(n);
      for (let i = 0; i < n; i++) seq[i] = i;
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(seq).setBuffer(prim.getAttribute('POSITION').getBuffer()));
    }
    const idx = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    const keep = [];
    const out = {};
    const a = [], b = [], c = [];
    for (let t = 0; t < idx.getCount(); t += 3) {
      const i0 = idx.getScalar(t), i1 = idx.getScalar(t + 1), i2 = idx.getScalar(t + 2);
      const p0 = apply(m, pos.getElement(i0, a)), p1 = apply(m, pos.getElement(i1, b)), p2 = apply(m, pos.getElement(i2, c));
      const r = region([(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3]);
      if (r) (out[r] ??= []).push(i0, i1, i2);
      else keep.push(i0, i1, i2);
    }
    if (Object.keys(out).length === 0) continue;
    const Arr = idx.getArray().constructor;
    idx.setArray(new Arr(keep));
    // every triangle went to the parts: the primitive goes (a glTF accessor cannot be empty)
    if (keep.length === 0) emptied.push(prim);
    for (const [r, list] of Object.entries(out)) {
      const p = prim.clone();
      p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Arr(list)).setBuffer(idx.getBuffer()));
      (parts[r] ??= doc.createMesh(r)).addPrimitive(p);
      counts[r] = (counts[r] ?? 0) + list.length / 3;
    }
  }
  for (const p of emptied) p.dispose();
  // a part's node beside the body, in the body's frame
  const parent = root.listScenes()[0].listChildren().includes(body) ? null : root.listNodes().find((n) => n.listChildren().includes(body));
  for (const [r, mesh] of Object.entries(parts)) {
    const n = doc.createNode(r).setMesh(mesh).setMatrix(body.getMatrix());
    if (parent) parent.addChild(n);
    else root.listScenes()[0].addChild(n);
  }
  await doc.transform(prune());
  await io.write(file, doc);
  console.log(`[parts] ${path.basename(file)}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
}
