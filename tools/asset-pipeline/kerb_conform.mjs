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
/** Ground within LIFT of a kerb and more than LIFT_FROM under it is raised towards it (to LIFT_FROM under, fading). */
const LIFT = 1.2;
const LIFT_FROM = 0.03;

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
  // the ground behind a kerb that lies well below it rises to meet it (a wheel leaving the kerb's outer edge must not
  // drop into a step: real circuits run the grass or astroturf flush with the kerb's back)
  const kerbAt = new Map();
  for (const { pos } of kerbParts)
    for (let i = 0; i < pos.length; i += 3) {
      const k = `${Math.floor(pos[i] / CELL)},${Math.floor(pos[i + 2] / CELL)}`;
      let l = kerbAt.get(k);
      if (!l) kerbAt.set(k, (l = []));
      l.push(pos[i], pos[i + 1], pos[i + 2]);
    }
  let lifted = 0;
  for (const { pos } of groundParts)
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const z = pos[i + 2];
      const y = pos[i + 1];
      let want = y;
      for (let gx = Math.floor((x - LIFT) / CELL); gx <= Math.floor((x + LIFT) / CELL); gx++)
        for (let gz = Math.floor((z - LIFT) / CELL); gz <= Math.floor((z + LIFT) / CELL); gz++) {
          const l = kerbAt.get(`${gx},${gz}`);
          if (!l) continue;
          for (let j = 0; j < l.length; j += 3) {
            const d = Math.hypot(l[j] - x, l[j + 2] - z);
            const ky = l[j + 1];
            if (d >= LIFT || ky - y < LIFT_FROM || ky - y > SAME_LEVEL) continue;
            want = Math.max(want, y + (ky - LIFT_FROM - y) * (1 - d / LIFT));
          }
        }
      if (want > y) {
        pos[i + 1] = want;
        lifted++;
      }
    }
  return { moved, maxMove, ground, lifted };
}

function* chunk4(l) {
  if (!l) return;
  for (let i = 0; i < l.length; i += 4) yield [l[i], l[i + 1], l[i + 2], l[i + 3]];
}

/**
 * Splits a part's triangles until no edge is longer than maxEdge (m, on the ground plane), longest edge first.
 * A source kerb can be one triangle 13 m long: its corners sit on the road, but where the road dips in between the
 * kerb floats above it as a step (Spa, before turn 9). With short edges conformKerbs can follow the road.
 * Returns a new { pos: Float32Array, idx: Int32Array } (shared vertices on split edges are reused).
 */
export function subdivide(pos, idx, maxEdge = 0.75) {
  const P = Array.from(pos);
  const mids = new Map();
  const mid = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    let m = mids.get(k);
    if (m === undefined) {
      m = P.length / 3;
      P.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2);
      mids.set(k, m);
    }
    return m;
  };
  const len = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 2] - P[b * 3 + 2]);
  const out = [];
  const stack = [];
  for (let t = 0; t < idx.length; t += 3) stack.push([idx[t], idx[t + 1], idx[t + 2]]);
  while (stack.length) {
    const [a, b, c] = stack.pop();
    const e = [len(a, b), len(b, c), len(c, a)];
    const m = Math.max(...e);
    if (m <= maxEdge) {
      out.push(a, b, c);
      continue;
    }
    // split the longest edge, keeping the winding
    if (e[0] === m) {
      const d = mid(a, b);
      stack.push([a, d, c], [d, b, c]);
    } else if (e[1] === m) {
      const d = mid(b, c);
      stack.push([a, b, d], [a, d, c]);
    } else {
      const d = mid(c, a);
      stack.push([a, b, d], [d, b, c]);
    }
  }
  return { pos: new Float32Array(P), idx: new Int32Array(out) };
}

/**
 * A skirt along every kerb's free outer edge: a strip SKIRT m wide from the kerb's edge down (or up) to the ground
 * beside it. Source models leave gaps of a hand's width between a kerb and the grass; a wheel ray falls through
 * one and the car drops a corner off the kerb (Spa, turn 9). Under existing ground the skirt is never the top surface.
 * Returns { pos, idx } for a ground (grass) part.
 */
export function kerbSkirts(asphaltParts, kerbParts, groundParts, width = 0.45) {
  const road = topOf(asphaltParts);
  const ground = topOf(groundParts);
  const pos = [];
  const idx = [];
  for (const p of kerbParts) {
    // free edges: used by one triangle only
    const use = new Map();
    for (let t = 0; t < p.idx.length; t += 3)
      for (const [a, b] of [[p.idx[t], p.idx[t + 1]], [p.idx[t + 1], p.idx[t + 2]], [p.idx[t + 2], p.idx[t]]]) {
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        const e = use.get(k);
        if (e) e.n++;
        else use.set(k, { a, b, n: 1 });
      }
    for (const { a, b, n } of use.values()) {
      if (n !== 1) continue;
      const ax = p.pos[a * 3], ay = p.pos[a * 3 + 1], az = p.pos[a * 3 + 2];
      const bx = p.pos[b * 3], by = p.pos[b * 3 + 1], bz = p.pos[b * 3 + 2];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-4) continue;
      // the side away from the road (the kerb's back); an edge with road on both sides or neither is skipped
      let nx = -(bz - az) / len;
      let nz = (bx - ax) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ay + by) / 2;
      const roadL = road(mx + nx * 0.3, mz + nz * 0.3, my) > -Infinity;
      const roadR = road(mx - nx * 0.3, mz - nz * 0.3, my) > -Infinity;
      if (roadL === roadR) continue;
      if (roadL) {
        nx = -nx;
        nz = -nz;
      }
      const out = (x, y, z) => {
        const ox = x + nx * width, oz = z + nz * width;
        const g = ground(ox, oz, y);
        return [ox, g > -Infinity ? g : y - 0.06, oz];
      };
      const a2 = out(ax, ay, az);
      const b2 = out(bx, by, bz);
      const i = pos.length / 3;
      // a little under the kerb's edge, so the kerb stays the top surface where they meet
      pos.push(ax, ay - 0.005, az, bx, by - 0.005, bz, ...a2, ...b2);
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  return { pos: new Float32Array(pos), idx: new Int32Array(idx) };
}
