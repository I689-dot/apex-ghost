/**
 * Kerbs the wheels can ride.
 *
 * Some source kerbs are modelled as ramps or sit in a step: at Spa's Les Combes the exit kerb rose to 11 cm above
 * the road edge across 0.8 m, and an inside kerb lay 5 cm below the road with a vertical edge. A car touching them
 * was thrown up (the wheel rays meet the ramp as a wall at speed). Real GT3 circuit kerbs are a few cm high and
 * meet the road flush; the sausage kerbs that are higher are separate objects (walls here, not kerbs).
 *
 * conformKerbs() keeps every kerb vertex within KERB_ABOVE above and KERB_BELOW under the road surface beside it
 * (the top asphalt under the vertex, or the nearest found on rings of 0.6 / 1.2 / 2 m round it). Collision only:
 * the render keeps its kerbs (a few cm of difference under a tyre is not visible).
 */
export const KERB_ABOVE = 0.04;
export const KERB_BELOW = 0.015;
const CELL = 2;
/** Road further than this above or below a kerb vertex is another level. */
const SAME_LEVEL = 0.3;
/** Ground behind a lowered kerb follows it down over this distance (no step where the kerb ends). */
const BLEND = 1.5;

function topOf(parts) {
  const grid = new Map();
  for (const { pos, idx } of parts)
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      const tri = [pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]];
      for (let gx = Math.floor(Math.min(tri[0], tri[3], tri[6]) / CELL); gx <= Math.floor(Math.max(tri[0], tri[3], tri[6]) / CELL); gx++)
        for (let gz = Math.floor(Math.min(tri[2], tri[5], tri[8]) / CELL); gz <= Math.floor(Math.max(tri[2], tri[5], tri[8]) / CELL); gz++) {
          const k = `${gx},${gz}`;
          let l = grid.get(k);
          if (!l) grid.set(k, (l = []));
          l.push(tri);
        }
    }
  /** The top road surface over (x, z) within SAME_LEVEL of y (another level, a bridge or a road under one, is not it). */
  return (x, z, y) => {
    let top = -Infinity;
    for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const h = u * ay + v * by + (1 - u - v) * cy;
      // the top road surface within reach (where the road is stacked, a base layer lies a few cm under the one the tyres run on)
      if (Math.abs(h - y) < SAME_LEVEL) top = Math.max(top, h);
    }
    return top;
  };
}

/**
 * Moves the kerb parts' vertices in place, and the ground parts' (grass, gravel) behind a lowered kerb with them,
 * fading over BLEND metres. Returns how many kerb vertices moved and the largest move (m).
 */
export function conformKerbs(asphaltParts, kerbParts, groundParts = []) {
  const road = topOf(asphaltParts);
  let moved = 0;
  let maxMove = 0;
  const drops = new Map();
  for (const { pos } of kerbParts)
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const z = pos[i + 2];
      const y0 = pos[i + 1];
      let ref = road(x, z, y0);
      // no road under it: the nearest beside it, ring by ring
      for (const r of [0.6, 1.2, 2]) {
        if (ref > -Infinity) break;
        const hs = [];
        for (let k = 0; k < 12; k++) {
          const h = road(x + r * Math.cos((k * Math.PI) / 6), z + r * Math.sin((k * Math.PI) / 6), y0);
          if (h > -Infinity) hs.push(h);
        }
        if (hs.length) ref = hs.reduce((s, h) => s + h, 0) / hs.length;
      }
      if (ref === -Infinity) continue;
      const y = Math.min(ref + KERB_ABOVE, Math.max(ref - KERB_BELOW, y0));
      if (y !== y0) {
        maxMove = Math.max(maxMove, Math.abs(y - y0));
        pos[i + 1] = y;
        moved++;
        if (y < y0) {
          const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
          let l = drops.get(k);
          if (!l) drops.set(k, (l = []));
          l.push(x, y0, z, y0 - y);
        }
      }
    }
  // the ground behind: down by the nearest lowered kerb vertex's drop, less with distance (only ground at the
  // kerb's old height or above: not a ditch beside it)
  let ground = 0;
  for (const { pos } of groundParts)
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const z = pos[i + 2];
      let best = 0;
      for (let gx = Math.floor((x - BLEND) / CELL); gx <= Math.floor((x + BLEND) / CELL); gx++)
        for (let gz = Math.floor((z - BLEND) / CELL); gz <= Math.floor((z + BLEND) / CELL); gz++)
          for (const [kx, ky, kz, drop] of chunk4(drops.get(`${gx},${gz}`))) {
            const d = Math.hypot(kx - x, kz - z);
            if (d >= BLEND || pos[i + 1] < ky - 0.03 || pos[i + 1] > ky + SAME_LEVEL) continue;
            best = Math.max(best, drop * (1 - d / BLEND));
          }
      if (best > 0) {
        pos[i + 1] -= best;
        ground++;
      }
    }
  return { moved, maxMove, ground };
}

function* chunk4(l) {
  if (!l) return;
  for (let i = 0; i < l.length; i += 4) yield [l[i], l[i + 1], l[i + 2], l[i + 3]];
}
