/**
 * Track limits from the painted white edge lines (the real rule: the white line is the edge of the track; a car
 * is off when all four wheels are beyond it). For every centreline point and side: the white line nearest to
 * where the traced road edge suggests (stored width + ~0.5 m), from the map's `lines_*` meshes; where nothing is
 * painted, the stored width + 0.5 m. A running median over ±40 m removes isolated narrow readings (a painted
 * pit-exit or grid line taken for the edge), and the result is never inside the stored width.
 *
 * Writes `limitL` / `limitR` (m from the centreline) into each track JSON.
 */
const LINE_RE = /^lines(?!_yellow)/i;

/** @param doc raw (world-space) map_track glTF document */
export function trackLimitsFromLines(doc, base) {
  const cl = base.centerline;
  const n = cl.length / 3;
  const C = 20;
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.floor(cl[i * 3] / C) * 100000 + Math.floor(cl[i * 3 + 2] / C);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const nearest = (x, z) => {
    let b = -1;
    let bd = 1e9;
    const gx = Math.floor(x / C);
    const gz = Math.floor(z / C);
    for (let a = -2; a <= 2; a++)
      for (let c = -2; c <= 2; c++)
        for (const i of grid.get((gx + a) * 100000 + gz + c) ?? []) {
          const d = (cl[i * 3] - x) ** 2 + (cl[i * 3 + 2] - z) ** 2;
          if (d < bd) {
            bd = d;
            b = i;
          }
        }
    return b;
  };
  const lines = Array.from({ length: n }, () => ({ L: [], R: [] }));
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      if (!LINE_RE.test(p.getMaterial()?.getName() ?? '') || !p.getIndices()) continue;
      const P = p.getAttribute('POSITION').getArray();
      const I = p.getIndices().getArray();
      for (let k = 0; k < I.length; k += 3) {
        const x = (P[I[k] * 3] + P[I[k + 1] * 3] + P[I[k + 2] * 3]) / 3;
        const y = (P[I[k] * 3 + 1] + P[I[k + 1] * 3 + 1] + P[I[k + 2] * 3 + 1]) / 3;
        const z = (P[I[k] * 3 + 2] + P[I[k + 1] * 3 + 2] + P[I[k + 2] * 3 + 2]) / 3;
        const i = nearest(x, z);
        if (i < 0 || Math.abs(y - cl[i * 3 + 1]) > 3) continue;
        const j = (i + 1) % n;
        let tx = cl[j * 3] - cl[i * 3];
        let tz = cl[j * 3 + 2] - cl[i * 3 + 2];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        const lat = (x - cl[i * 3]) * tz - (z - cl[i * 3 + 2]) * tx;
        if (lat >= 0) lines[i].L.push(lat);
        else lines[i].R.push(-lat);
      }
    }
  const out = { limitL: new Array(n), limitR: new Array(n), painted: 0 };
  for (const side of ['L', 'R']) {
    const w = side === 'L' ? base.widthL : base.widthR;
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const cand = lines[i][side].filter((v) => v > w[i] - 1.5 && v < w[i] + 4);
      if (cand.length) {
        raw[i] = cand.reduce((b, v) => (Math.abs(v - (w[i] + 0.5)) < Math.abs(b - (w[i] + 0.5)) ? v : b), cand[0]) + 0.1;
        out.painted++;
      } else raw[i] = w[i] + 0.5;
    }
    // running median over about ±40 m of centreline points
    const step = base.length / n;
    const h = Math.max(2, Math.round(40 / step));
    const res = side === 'L' ? out.limitL : out.limitR;
    for (let i = 0; i < n; i++) {
      const win = [];
      for (let k = -h; k <= h; k++) win.push(raw[(i + k + n) % n]);
      win.sort((a, b) => a - b);
      res[i] = Math.round(Math.max(w[i], win[win.length >> 1], raw[i] > win[win.length >> 1] ? raw[i] : 0) * 100) / 100;
    }
  }
  return out;
}
