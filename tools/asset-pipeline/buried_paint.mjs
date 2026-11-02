/**
 * Paint under the road.
 *
 * Some source maps keep the paint of an older layout on the base asphalt and cover it with the newer surface a few
 * centimetres above (Spa: two lines down the middle of the Kemmel straight, under the resurfaced racing groove). In
 * the source that paint is hidden; the game draws paint 3.5 cm higher so the real lines do not flicker
 * (game/track.ts DECAL_LAYERS), which brought the covered lines up through the surface: white lines in the middle
 * of the road, read as track edges by the analysis too (the AI's line was pinched between them).
 *
 * dropBuriedPaint() deletes the paint lying more than BURIED under the racing surface (the map's analysis.traceRoad
 * materials) where that surface reaches at least `inside` metres beyond it all round (INSIDE, or the map's
 * analysis.buriedPaintInside where the racing surface is narrower than the road and the real edge lines never run
 * under it), on lines longer than LONG metres, in ~1 m pieces; with the map's buriedPaintWholeLine, all of a line on
 * the racing surface when most of that is covered. Paint on top of the road, level with the surface it is painted
 * on, short marks, or along the racing surface's edges is kept. track_analysis.py leaves the same paint out of the
 * track edges.
 *
 *   node tools/asset-pipeline/buried_paint.mjs <map_track.glb> <racing surface regexp> [inside m] [whole]   (counts only)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { pathToFileURL } from 'node:url';

export const BURIED = 0.012;
export const INSIDE = 1.0;
export const LONG = 10;
const PIECE = 1.0;
const CELL = 4;
export const PAINT_RE = /^(lines|redline)/i;

/** World-space triangles of the primitives whose material matches `re`. */
function trianglesOf(doc, re) {
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (!re.test(prim.getMaterial()?.getName() ?? '')) continue;
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos) continue;
      const n = pos.getCount();
      const w = new Float64Array(n * 3);
      const p = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pos.getElement(i, p);
        w[i * 3] = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
        w[i * 3 + 1] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
        w[i * 3 + 2] = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
      }
      const ix = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
      out.push({ prim, w, ix });
    }
  }
  return out;
}

/** Highest road surface over (x, z), or -Infinity. */
function makeTop(roads) {
  const grid = new Map();
  for (const r of roads)
    for (let t = 0; t < r.ix.length; t += 3) {
      const a = r.ix[t] * 3;
      const b = r.ix[t + 1] * 3;
      const c = r.ix[t + 2] * 3;
      const x0 = Math.floor(Math.min(r.w[a], r.w[b], r.w[c]) / CELL);
      const x1 = Math.floor(Math.max(r.w[a], r.w[b], r.w[c]) / CELL);
      const z0 = Math.floor(Math.min(r.w[a + 2], r.w[b + 2], r.w[c + 2]) / CELL);
      const z1 = Math.floor(Math.max(r.w[a + 2], r.w[b + 2], r.w[c + 2]) / CELL);
      for (let gx = x0; gx <= x1; gx++)
        for (let gz = z0; gz <= z1; gz++) {
          const k = `${gx},${gz}`;
          let l = grid.get(k);
          if (!l) grid.set(k, (l = []));
          l.push(r.w[a], r.w[a + 1], r.w[a + 2], r.w[b], r.w[b + 1], r.w[b + 2], r.w[c], r.w[c + 1], r.w[c + 2]);
        }
    }
  return (x, z) => {
    const l = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    let top = -Infinity;
    if (!l) return top;
    for (let i = 0; i < l.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = l.slice(i, i + 9);
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      top = Math.max(top, u * ay + v * by + (1 - u - v) * cy);
    }
    return top;
  };
}

/** The connected pieces of a paint primitive (vertices at the same place are one: the paint is not always welded): a
 * component id per triangle, and which components are long lines (over LONG metres). Only long lines go: the racing
 * surface is a see-through rubber layer (alpha blended), so short marks under it, the pit-exit dashes and the grid
 * boxes, show through as the map's author meant; the long lines under it are an older layout's. */
function lines(w, ix) {
  const n = w.length / 3;
  const key = new Map();
  const par = new Int32Array(n).map((_, i) => i);
  const find = (a) => {
    while (par[a] !== a) a = par[a] = par[par[a]];
    return a;
  };
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(w[i * 3] * 200)},${Math.round(w[i * 3 + 1] * 200)},${Math.round(w[i * 3 + 2] * 200)}`;
    const j = key.get(k);
    if (j === undefined) key.set(k, i);
    else par[find(i)] = find(j);
  }
  for (let t = 0; t < ix.length; t += 3) {
    par[find(ix[t + 1])] = find(ix[t]);
    par[find(ix[t + 2])] = find(ix[t]);
  }
  const box = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const b = box.get(r) ?? [Infinity, Infinity, -Infinity, -Infinity];
    b[0] = Math.min(b[0], w[i * 3]);
    b[1] = Math.min(b[1], w[i * 3 + 2]);
    b[2] = Math.max(b[2], w[i * 3]);
    b[3] = Math.max(b[3], w[i * 3 + 2]);
    box.set(r, b);
  }
  const comp = new Int32Array(ix.length / 3);
  const long = new Set();
  for (const [r, b] of box) if (Math.hypot(b[2] - b[0], b[3] - b[1]) > LONG) long.add(r);
  for (let t = 0; t < ix.length; t += 3) comp[t / 3] = find(ix[t]);
  return { comp, long };
}

/** A triangle cut into n x n pieces (n from its longest edge, ~PIECE metres): each piece's corners as barycentric weights. */
function pieces(w, a, b, c) {
  const e = (p, q) => Math.hypot(w[p] - w[q], w[p + 1] - w[q + 1], w[p + 2] - w[q + 2]);
  const n = Math.max(1, Math.ceil(Math.max(e(a, b), e(b, c), e(c, a)) / PIECE));
  const P = (i, j) => [1 - (i + j) / n, i / n, j / n];
  const out = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n - i; j++) {
      out.push([P(i, j), P(i + 1, j), P(i, j + 1)]);
      if (i + j + 1 < n) out.push([P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
    }
  return out;
}

/**
 * Deletes the paint covered by the racing surface `road` (or counts it with dry): the long lines' triangles are cut
 * into ~1 m pieces (they are long thin strips, partly on the surface and partly off it) and the covered pieces go.
 * `wholeLine`: when most of what a line has on the racing surface is covered, all of that goes (an older layout's
 * line rises level with the surface where it leaves it). Returns [pieces dropped, triangles].
 */
export function dropBuriedPaint(doc, road, { paint = PAINT_RE, inside = INSIDE, wholeLine = false, dry = false, seen = null } = {}) {
  const top = makeTop(trianglesOf(doc, road));
  let dropped = 0;
  let total = 0;
  for (const { prim, w, ix } of trianglesOf(doc, paint)) {
    const { comp, long } = lines(w, ix);
    // every piece of every long line: on the racing surface, covered by it
    const tris = [];
    const onBy = new Map();
    const burBy = new Map();
    for (let t = 0; t < ix.length; t += 3) {
      total++;
      if (!long.has(comp[t / 3])) {
        tris.push(null);
        continue;
      }
      const a = ix[t] * 3;
      const b = ix[t + 1] * 3;
      const c = ix[t + 2] * 3;
      const ps = pieces(w, a, b, c).map((bary) => {
        const cen = [0, 1, 2].map(
          (k) =>
            ((bary[0][0] + bary[1][0] + bary[2][0]) / 3) * w[a + k] +
            ((bary[0][1] + bary[1][1] + bary[2][1]) / 3) * w[b + k] +
            ((bary[0][2] + bary[1][2] + bary[2][2]) / 3) * w[c + k],
        );
        const [x, y, z] = cen;
        const h = top(x, z);
        const on = h > -Infinity;
        // deep enough under the surface right there, and the surface all round it (the road's crossfall makes the
        // height a metre away a few cm different: only its presence counts)
        const bur = on && h > y + BURIED && [top(x + inside, z), top(x - inside, z), top(x, z + inside), top(x, z - inside)].every((v) => v > -Infinity);
        return { bary, x, z, on, bur };
      });
      const id = comp[t / 3];
      onBy.set(id, (onBy.get(id) ?? 0) + ps.filter((p) => p.on).length);
      burBy.set(id, (burBy.get(id) ?? 0) + ps.filter((p) => p.bur).length);
      tris.push(ps);
    }
    const old = (id) => wholeLine && (onBy.get(id) ?? 0) > 0 && (burBy.get(id) ?? 0) > 0.5 * onBy.get(id);
    // the kept triangles, whole where nothing of them goes, else their kept pieces as new triangles
    const keep = [];
    const added = [];
    for (let t = 0; t < ix.length; t += 3) {
      const ps = tris[t / 3];
      if (!ps) {
        keep.push(ix[t], ix[t + 1], ix[t + 2]);
        continue;
      }
      const isOld = old(comp[t / 3]);
      const gone = ps.map((p) => p.bur || (isOld && p.on));
      for (let k = 0; k < ps.length; k++) seen?.push(ps[k].x, ps[k].z, gone[k] ? 1 : 0);
      const nGone = gone.filter(Boolean).length;
      dropped += nGone;
      if (nGone === 0) keep.push(ix[t], ix[t + 1], ix[t + 2]);
      else if (nGone < ps.length) for (let k = 0; k < ps.length; k++) if (!gone[k]) added.push([ix[t], ix[t + 1], ix[t + 2], ps[k].bary]);
    }
    if (dry || (keep.length === ix.length && !added.length)) continue;
    // the new pieces' vertices: every attribute interpolated from the triangle's corners
    let next = prim.getAttribute('POSITION').getCount();
    for (const attr of prim.listAttributes()) {
      const size = attr.getElementSize();
      const src = attr.getArray();
      const out = new src.constructor(src.length + added.length * 3 * size);
      out.set(src);
      let o = src.length;
      for (const [i0, i1, i2, bary] of added)
        for (const [u0, u1, u2] of bary) {
          for (let k = 0; k < size; k++) out[o + k] = u0 * src[i0 * size + k] + u1 * src[i1 * size + k] + u2 * src[i2 * size + k];
          o += size;
        }
      attr.setArray(out);
    }
    for (let k = 0; k < added.length * 3; k++) keep.push(next++);
    const idx = prim.getIndices();
    if (idx) idx.setArray(new Uint32Array(keep));
  }
  return [dropped, total];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(process.argv[2]);
  const [d, t] = dropBuriedPaint(doc, new RegExp(process.argv[3], 'i'), {
    dry: true,
    inside: Number(process.argv[4] ?? INSIDE),
    wholeLine: process.argv[5] === 'whole',
  });
  console.log(`${process.argv[2]}: ${d} pieces of paint under the racing surface (${t} paint triangles)`);
}
