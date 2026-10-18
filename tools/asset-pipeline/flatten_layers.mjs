/**
 * Stacked ground layers in the collision mesh.
 *
 * The source map lays painted lines, grid-box bars, patches and repairs as separate meshes a little above the
 * surface they belong to (up to 7 cm on the start/finish straight: every grid-box bar was a 6.7 cm ledge, so the
 * cars hopped as they left the grid and every 16 m down the straight). In the render that is what keeps paint
 * from z-fighting; in the collision it is a step under a wheel ray.
 *
 * snapStackedLayers() moves every vertex of a ground surface that lies 3 mm…15 cm above another triangle of the
 * same surface straight down onto it, and drops triangles that still float over one (slivers whose corners are on
 * the road), so the wheels see one continuous surface. Only same-surface layers are
 * touched (a kerb on asphalt or the road over the hole fill keep their real step), and a vertex with nothing
 * underneath stays where it is (lines bridging gaps in the asphalt still carry the wheel there).
 */

const MIN_GAP = 0.003;
const MAX_GAP = 0.15;
const CELL = 4;
// points inside a triangle (barycentric): centre, towards each corner, towards each edge midpoint
const SAMPLES = [
  [1 / 3, 1 / 3, 1 / 3],
  [0.6, 0.2, 0.2],
  [0.2, 0.6, 0.2],
  [0.2, 0.2, 0.6],
  [0.45, 0.45, 0.1],
  [0.1, 0.45, 0.45],
  [0.45, 0.1, 0.45],
];
const AROUND = Array.from({ length: 8 }, (_, k) => [0.02 * Math.cos((k * Math.PI) / 4), 0.02 * Math.sin((k * Math.PI) / 4)]);

/**
 * @param {{ pos: Float32Array, idx: Uint32Array }} part one surface's mesh (welded); positions are changed in place
 * @returns {{ snapped: number, maxGap: number, dropped: number, idx: Uint32Array }} idx: the triangles kept
 */
export function snapStackedLayers(part) {
  const { pos, idx } = part;
  const nt = idx.length / 3;
  const hash = new Map();
  const key = (ix, iz) => ix * 73856093 + iz * 19349663;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const x0 = Math.floor(Math.min(pos[a], pos[b], pos[c]) / CELL);
    const x1 = Math.floor(Math.max(pos[a], pos[b], pos[c]) / CELL);
    const z0 = Math.floor(Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) / CELL);
    const z1 = Math.floor(Math.max(pos[a + 2], pos[b + 2], pos[c + 2]) / CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) continue; // huge terrain triangles: never a thin layer
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let l = hash.get(k);
        if (!l) hash.set(k, (l = []));
        l.push(t);
      }
  }
  // the highest same-surface triangle (not using vertex v) under (x, z), 3 mm … 15 cm below y (null: none)
  const lowerAt = (x, y, z, v) => {
    const l = hash.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!l) return null;
    let best = null;
    for (const t of l) {
      const ia = idx[t * 3];
      const ib = idx[t * 3 + 1];
      const ic = idx[t * 3 + 2];
      if (ia === v || ib === v || ic === v) continue;
      const a = ia * 3;
      const b = ib * 3;
      const c = ic * 3;
      const d = (pos[b + 2] - pos[c + 2]) * (pos[a] - pos[c]) + (pos[c] - pos[b]) * (pos[a + 2] - pos[c + 2]);
      if (Math.abs(d) < 1e-9) continue;
      const w0 = ((pos[b + 2] - pos[c + 2]) * (x - pos[c]) + (pos[c] - pos[b]) * (z - pos[c + 2])) / d;
      const w1 = ((pos[c + 2] - pos[a + 2]) * (x - pos[c]) + (pos[a] - pos[c]) * (z - pos[c + 2])) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
      const h = w0 * pos[a + 1] + w1 * pos[b + 1] + w2 * pos[c + 1];
      const gap = y - h;
      if (gap > MIN_GAP && gap <= MAX_GAP && (best === null || h > best)) best = h;
    }
    return best;
  };
  // a vertex is snapped only if the lower layer also runs on 2 cm around it (6 of 8 directions, so a hairline
  // crack in it doesn't matter): the top of a real step (a raised pavement edge with a vertical side) has the
  // lower surface on one side only and is left alone
  const below = (v) => {
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    const h = lowerAt(x, y, z, v);
    if (h === null) return null;
    let open = 0;
    for (const [ox, oz] of AROUND) if (lowerAt(x + ox, y, z + oz, v) === null && ++open > 2) return null;
    return h;
  };
  // decide on the original heights first, then move (a moved vertex must not become someone's "ground")
  const nv = pos.length / 3;
  const target = new Float32Array(nv).fill(NaN);
  let snapped = 0;
  let maxGap = 0;
  for (let v = 0; v < nv; v++) {
    const h = below(v);
    if (h === null) continue;
    target[v] = h;
  }
  for (let v = 0; v < nv; v++) {
    if (Number.isNaN(target[v])) continue;
    maxGap = Math.max(maxGap, pos[v * 3 + 1] - target[v]);
    pos[v * 3 + 1] = target[v];
    snapped++;
  }
  // Long slivers (a painted line crossing a crest at an angle) have their corners on the road but float above it
  // in between: drop a triangle when most of it lies 3 mm … 15 cm above another triangle of the same surface.
  const keep = [];
  let dropped = 0;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    let over = 0;
    for (const [wa, wb, wc] of SAMPLES) {
      const x = wa * pos[a] + wb * pos[b] + wc * pos[c];
      const y = wa * pos[a + 1] + wb * pos[b + 1] + wc * pos[c + 1];
      const z = wa * pos[a + 2] + wb * pos[b + 2] + wc * pos[c + 2];
      if (lowerAt(x, y, z, -1) !== null) over++;
    }
    if (over >= SAMPLES.length - 2) dropped++;
    else keep.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  }
  return { snapped, maxGap, dropped, idx: dropped ? new Uint32Array(keep) : idx };
}
