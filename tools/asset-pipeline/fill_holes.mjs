/**
 * Ground hole filler. The 2022-layout source model has places with no ground at all (the old track was cut out
 * and never refilled): the sky shows through as white patches beside the track, and a car driving there falls
 * through the world (tools/sim/holes.ts found 4627–4653 m and 4678–4848 m, left side).
 *
 * Every drivable collision surface is rasterised onto a 2 m lattice around the circuit and the pit lane. Lattice
 * nodes no surface covers are holes; their heights are filled smoothly from the covered nodes around them
 * (Jacobi relaxation, seeded with the nearest centreline height). Every cell with an uncovered corner becomes a
 * grass quad, a few centimetres below any existing surface it overlaps, so it never covers real road or kerbs.
 * The quads go into the collision (as grass) and into a visible mesh (map_fill.glb, the track's own grass texture).
 */
import { Document, NodeIO } from '@gltf-transform/core';

const STEP = 2; // lattice spacing (m)
const RADIUS = 450; // fill this far from the centreline (m): beyond the drivable area too, the holes show from the track
const DRIVE = 70; // within this distance, only ground near track level counts (bridges, tunnels)
const PIT_RADIUS = 25;
const SINK = 0.12; // below existing surfaces where a fill quad overlaps them
const NEAR = 8; // a surface further than this above/below the nearest centreline point is not this ground

/**
 * @param parts collision batches [{ si, pos: Float32Array, idx: Uint32Array }]
 * @param surfaces surface name per si
 * @param centerline flat [x,y,z,...]
 * @param pitPoints flat [x,y,z,...] (may be empty)
 * @returns {{ pos: Float32Array, idx: Uint32Array, cells: number }}
 */
export function fillHoles(parts, surfaces, centerline, pitPoints, visualParts = null) {
  const ref = [];
  for (let i = 0; i < centerline.length; i += 3) ref.push([centerline[i], centerline[i + 1], centerline[i + 2], RADIUS]);
  for (let i = 0; i < pitPoints.length; i += 3) ref.push([pitPoints[i], pitPoints[i + 1], pitPoints[i + 2], PIT_RADIUS]);
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, , z, r] of ref) {
    x0 = Math.min(x0, x - r);
    z0 = Math.min(z0, z - r);
    x1 = Math.max(x1, x + r);
    z1 = Math.max(z1, z + r);
  }
  x0 = Math.floor(x0 / STEP) * STEP;
  z0 = Math.floor(z0 / STEP) * STEP;
  const nx = Math.ceil((x1 - x0) / STEP) + 1;
  const nz = Math.ceil((z1 - z0) / STEP) + 1;
  const N = nx * nz;
  // nearest reference point per node (region mask + reference height): spread from the reference points
  const refH = new Float32Array(N).fill(NaN);
  const inRegion = new Uint8Array(N);
  for (const [x, y, z, r] of ref) {
    const ia = Math.max(0, Math.floor((x - r - x0) / STEP));
    const ib = Math.min(nx - 1, Math.ceil((x + r - x0) / STEP));
    const ja = Math.max(0, Math.floor((z - r - z0) / STEP));
    const jb = Math.min(nz - 1, Math.ceil((z + r - z0) / STEP));
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const dx = x0 + i * STEP - x;
        const dz = z0 + j * STEP - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const k = j * nx + i;
        // keep the height of the closest reference point
        if (!inRegion[k] || d2 < refDist(k)) {
          inRegion[k] = 1;
          refH[k] = y;
          setRefDist(k, d2);
        }
      }
    }
  }
  // ground height per lattice point: the surface closest to the reference height (bridges and tunnels have two
  // levels). Also sampled at the cell centres and edge midpoints, which catches cracks narrower than a cell.
  const ground = new Set(['asphalt', 'curb', 'grass', 'gravel', 'sand']);
  const raster = (ox, oz, src = parts) => {
    const out = new Float32Array(N).fill(NaN);
    for (const p of src) {
      if (src === parts && !ground.has(surfaces[p.si])) continue;
      const P = p.pos;
      const I = p.idx;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3;
        const b = I[t + 1] * 3;
        const c = I[t + 2] * 3;
        const ax = P[a];
        const az = P[a + 2];
        const bx = P[b];
        const bz = P[b + 2];
        const cx = P[c];
        const cz = P[c + 2];
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-9) continue;
        const ia = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / STEP - ox));
        const ib = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / STEP - ox));
        const ja = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) / STEP - oz));
        const jb = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / STEP - oz));
        for (let j = ja; j <= jb; j++) {
          const z = z0 + (j + oz) * STEP;
          for (let i = ia; i <= ib; i++) {
            const k = j * nx + i;
            if (!inRegion[k]) continue;
            const x = x0 + (i + ox) * STEP;
            const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
            const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
            const l3 = 1 - l1 - l2;
            const e = -1e-4;
            if (l1 < e || l2 < e || l3 < e) continue;
            const y = l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
            if (Math.abs(y - refH[k]) > NEAR && refDist(k) < DRIVE * DRIVE) continue;
            if (Number.isNaN(out[k]) || Math.abs(y - refH[k]) < Math.abs(out[k] - refH[k])) out[k] = y;
          }
        }
      }
    }
    return out;
  };
  // covered = solid (collision) AND drawn (the visible ground meshes, when given): the source has spots with one
  // and not the other, and either way the player sees the sky or falls through
  const both = (ox, oz) => {
    const c = raster(ox, oz);
    if (!visualParts) return c;
    const v = raster(ox, oz, visualParts);
    for (let k = 0; k < N; k++) if (Number.isNaN(v[k])) c[k] = NaN;
    return c;
  };
  const h = both(0, 0);
  const mid = [both(0.5, 0.5), both(0.5, 0), both(0, 0.5)];
  // fill heights: seed holes with the reference height, relax towards the covered neighbours
  const covered = new Uint8Array(N);
  const f = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (!inRegion[k]) continue;
    if (!Number.isNaN(h[k])) {
      covered[k] = 1;
      f[k] = h[k];
    } else f[k] = refH[k] - 0.3;
  }
  for (let it = 0; it < 300; it++) {
    for (let j = 1; j < nz - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (!inRegion[k] || covered[k]) continue;
        let s = 0;
        let n = 0;
        for (const q of [k - 1, k + 1, k - nx, k + nx]) {
          if (!inRegion[q]) continue;
          s += f[q];
          n++;
        }
        if (n) f[k] = s / n;
      }
    }
  }
  // quads for every cell with an uncovered corner
  const pos = [];
  const idx = [];
  const vid = new Int32Array(N).fill(-1);
  const vert = (k) => {
    if (vid[k] >= 0) return vid[k];
    const i = k % nx;
    const j = (k - i) / nx;
    vid[k] = pos.length / 3;
    pos.push(x0 + i * STEP, f[k] - SINK, z0 + j * STEP);
    return vid[k];
  };
  let cells = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const q = [k, k + 1, k + nx + 1, k + nx];
      if (!q.every((v) => inRegion[v])) continue;
      if (q.every((v) => covered[v]) && mid.every((m) => !Number.isNaN(m[k]))) continue;
      cells++;
      const [a, b, c, d] = q.map(vert);
      // y up: counter-clockwise seen from above
      idx.push(a, d, c, a, c, b);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), cells };

  // squared distance to the reference point that set a node's height (lazily allocated)
  function refDist(k) {
    return refDist.d ? refDist.d[k] : Infinity;
  }
  function setRefDist(k, v) {
    if (!refDist.d) refDist.d = new Float32Array(N).fill(Infinity);
    refDist.d[k] = v;
  }
}

/**
 * The fill as a visible mesh: flat-shaded quads with world-space UVs and the track's own grass texture
 * (taken from map_track.glb), written as map_fill.glb with one node, `chunk_fill`.
 */
export async function writeFillGlb(io, fill, trackGlb, out, terrainFill = null, grassRe = /^grass/i) {
  const src = await io.read(trackGlb);
  const grass = src
    .getRoot()
    .listMaterials()
    .find((m) => grassRe.test(m.getName()) && m.getBaseColorTexture());
  const doc = new Document();
  const buffer = doc.createBuffer();
  const n = fill.pos.length / 3;
  const normal = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    normal[i * 3 + 1] = 1;
    uv[i * 2] = fill.pos[i * 3] / 8;
    uv[i * 2 + 1] = fill.pos[i * 3 + 2] / 8;
  }
  const mat = doc.createMaterial('grass_fill').setRoughnessFactor(1).setMetallicFactor(0);
  if (grass) {
    const tex = grass.getBaseColorTexture();
    const t = doc.createTexture('grass_fill').setImage(tex.getImage()).setMimeType(tex.getMimeType());
    mat.setBaseColorTexture(t).setBaseColorFactor(grass.getBaseColorFactor());
    mat.getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);
  } else mat.setBaseColorFactor([0.24, 0.32, 0.16, 1]);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(fill.pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normal).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(fill.idx).setBuffer(buffer))
    .setMaterial(mat);
  const mesh = doc.createMesh('chunk_fill').addPrimitive(prim);
  const node = doc.createNode('chunk_fill').setMesh(mesh);
  if (terrainFill && terrainFill.cells) {
    const tn = new Float32Array(terrainFill.pos.length);
    for (let i = 1; i < tn.length; i += 3) tn[i] = 1;
    const tmat = doc
      .createMaterial('terrain_fill')
      .setRoughnessFactor(1)
      .setMetallicFactor(0)
      .setBaseColorTexture(doc.createTexture('terrain_fill').setImage(terrainFill.image).setMimeType(terrainFill.mime));
    const tprim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(terrainFill.pos).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(tn).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(terrainFill.uv).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(terrainFill.idx).setBuffer(buffer))
      .setMaterial(tmat);
    node.addChild(doc.createNode('terrain_fill').setMesh(doc.createMesh('terrain_fill').addPrimitive(tprim)));
  }
  doc.createScene().addChild(node);
  await new NodeIO().write(out, doc);
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], fill.pos[i * 3 + a]);
      hi[a] = Math.max(hi[a], fill.pos[i * 3 + a]);
    }
  const center = lo.map((v, a) => (v + hi[a]) / 2);
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
  return { center, radius };
}

/**
 * Holes in the satellite terrain itself (a channel along the Nordschleife, which isn't modelled, shows as white
 * snakes from the aerial shots). Terrain triangles (and every collision surface, so the circuit's own footprint
 * counts as ground) are rasterised onto a 20 m lattice over the whole terrain. Uncovered nodes that cannot be
 * reached from the lattice border are holes; heights and texture coordinates are relaxed in from the terrain
 * around them, so the patch continues the satellite photo seamlessly. Covered corners sit below the terrain.
 */
export async function fillTerrain(io, terrainGlb, parts, surfaces) {
  const doc = await io.read(terrainGlb);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray();
  const U = prim.getAttribute('TEXCOORD_0').getArray();
  const I = prim.getIndices().getArray();
  const tex = prim.getMaterial().getBaseColorTexture();
  const G = 20;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    x0 = Math.min(x0, P[i]);
    x1 = Math.max(x1, P[i]);
    z0 = Math.min(z0, P[i + 2]);
    z1 = Math.max(z1, P[i + 2]);
  }
  const nx = Math.floor((x1 - x0) / G) + 1;
  const nz = Math.floor((z1 - z0) / G) + 1;
  const N = nx * nz;
  const y = new Float32Array(N);
  const u = new Float32Array(N);
  const v = new Float32Array(N);
  const cov = new Uint8Array(N); // 1 terrain, 2 other ground
  const raster = (Pp, Ii, Uu, mark) => {
    for (let t = 0; t < Ii.length; t += 3) {
      const a = Ii[t] * 3;
      const b = Ii[t + 1] * 3;
      const c = Ii[t + 2] * 3;
      const det = (Pp[b + 2] - Pp[c + 2]) * (Pp[a] - Pp[c]) + (Pp[c] - Pp[b]) * (Pp[a + 2] - Pp[c + 2]);
      if (Math.abs(det) < 1e-9) continue;
      const ia = Math.max(0, Math.ceil((Math.min(Pp[a], Pp[b], Pp[c]) - x0) / G));
      const ib = Math.min(nx - 1, Math.floor((Math.max(Pp[a], Pp[b], Pp[c]) - x0) / G));
      const ja = Math.max(0, Math.ceil((Math.min(Pp[a + 2], Pp[b + 2], Pp[c + 2]) - z0) / G));
      const jb = Math.min(nz - 1, Math.floor((Math.max(Pp[a + 2], Pp[b + 2], Pp[c + 2]) - z0) / G));
      for (let j = ja; j <= jb; j++) {
        const z = z0 + j * G;
        for (let i = ia; i <= ib; i++) {
          const x = x0 + i * G;
          const l1 = ((Pp[b + 2] - Pp[c + 2]) * (x - Pp[c]) + (Pp[c] - Pp[b]) * (z - Pp[c + 2])) / det;
          const l2 = ((Pp[c + 2] - Pp[a + 2]) * (x - Pp[c]) + (Pp[a] - Pp[c]) * (z - Pp[c + 2])) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
          const k = j * nx + i;
          if (mark === 1) {
            const ta = (a / 3) * 2;
            const tb = (b / 3) * 2;
            const tc = (c / 3) * 2;
            y[k] = l1 * Pp[a + 1] + l2 * Pp[b + 1] + l3 * Pp[c + 1];
            u[k] = l1 * Uu[ta] + l2 * Uu[tb] + l3 * Uu[tc];
            v[k] = l1 * Uu[ta + 1] + l2 * Uu[tb + 1] + l3 * Uu[tc + 1];
            cov[k] = 1;
          } else if (!cov[k]) cov[k] = 2;
        }
      }
    }
  };
  raster(P, I, U, 1);
  for (const p of parts) if (surfaces[p.si] !== 'wall') raster(p.pos, p.idx, null, 2);
  // holes: uncovered and not connected to the border through uncovered nodes
  const outside = new Uint8Array(N);
  const stack = [];
  for (let i = 0; i < nx; i++) stack.push(i, (nz - 1) * nx + i);
  for (let j = 0; j < nz; j++) stack.push(j * nx, j * nx + nx - 1);
  while (stack.length) {
    const k = stack.pop();
    if (outside[k] || cov[k]) continue;
    outside[k] = 1;
    const i = k % nx;
    if (i > 0) stack.push(k - 1);
    if (i < nx - 1) stack.push(k + 1);
    if (k >= nx) stack.push(k - nx);
    if (k < N - nx) stack.push(k + nx);
  }
  const hole = (k) => !cov[k] && !outside[k];
  // relax heights and UVs into the holes (seed: mean of the terrain)
  let my = 0;
  let mu = 0;
  let mv = 0;
  let mc = 0;
  for (let k = 0; k < N; k++)
    if (cov[k] === 1) {
      my += y[k];
      mu += u[k];
      mv += v[k];
      mc++;
    }
  for (let k = 0; k < N; k++)
    if (hole(k)) {
      y[k] = my / mc;
      u[k] = mu / mc;
      v[k] = mv / mc;
    }
  const holes = [];
  for (let k = 0; k < N; k++) if (hole(k)) holes.push(k);
  for (let it = 0; it < 400; it++) {
    for (const k of holes) {
      let sy = 0;
      let su = 0;
      let sv = 0;
      let n = 0;
      for (const q of [k - 1, k + 1, k - nx, k + nx]) {
        if (q < 0 || q >= N || outside[q] || cov[q] === 2) continue;
        sy += y[q];
        su += u[q];
        sv += v[q];
        n++;
      }
      if (n) {
        y[k] = sy / n;
        u[k] = su / n;
        v[k] = sv / n;
      }
    }
  }
  const pos = [];
  const uv = [];
  const idx = [];
  const vid = new Int32Array(N).fill(-1);
  const vert = (k) => {
    if (vid[k] >= 0) return vid[k];
    const i = k % nx;
    const j = (k - i) / nx;
    vid[k] = pos.length / 3;
    pos.push(x0 + i * G, y[k] - (hole(k) ? 0 : 0.5), z0 + j * G);
    uv.push(u[k], v[k]);
    return vid[k];
  };
  let cells = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const q = [k, k + 1, k + nx + 1, k + nx];
      if (!q.some(hole)) continue;
      // a corner on other ground (the circuit) has no terrain UV/height of its own: skip those cells
      if (q.some((c) => cov[c] === 2 || outside[c])) continue;
      cells++;
      const [a, b, c, d] = q.map(vert);
      idx.push(a, d, c, a, c, b);
    }
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint32Array(idx), cells, image: tex.getImage(), mime: tex.getMimeType() };
}

/** Visible ground primitives of a raw (untransformed, world-space) map GLB, as raster parts. */
export async function groundPartsFromGlb(io, file, re) {
  const doc = await io.read(file);
  const out = [];
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const name = p.getMaterial()?.getName() ?? '';
      if (!re.test(name) || !p.getIndices()) continue;
      out.push({ si: -1, pos: p.getAttribute('POSITION').getArray(), idx: p.getIndices().getArray() });
    }
  return out;
}
