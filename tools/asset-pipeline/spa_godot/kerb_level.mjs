/**
 * Kerb levelling for the Godot Spa (instead of kerb_conform.mjs's conformKerbs, which the web pipeline keeps).
 *
 * conformKerbs holds each kerb vertex within 4 cm above / 1.5 cm under the road beside it (the road under it, else the
 * mean of the road found on rings round it). On Spa's source that left two kinds of step (tools/godot/kerb_scan.py):
 *  - kerbs set in the grass or gravel, away from the road (Pouhon exit, 3.92-4.02 km): no road within 2 m, so not
 *    touched, and they lie 4-8 cm under the ground on both sides;
 *  - a kerb between two road levels (Paul Frère, 5.13 km: the road 14 cm lower inside than the strip outside): its
 *    inner half was pulled down to the inner road + 4 cm while the outer half stayed, a 7 cm step across the kerb.
 * Here a kerb vertex stays:
 *  - at most KERB_ABOVE over the higher of the highest road within REACH and the ground right beside it (no ramps:
 *    a kerb on run-off that rises away from the road, Malmedy 2.6-2.76 km, follows the ground behind it, while the
 *    chicane's raised element, with flat grass beside it, is held to the road),
 *  - at most KERB_BELOW under the lowest surface on the nearest ring round it, road or ground (no sunk kerbs),
 *  - and no more than HUMP over the median of the kerb within HUMP_R (local raised pieces),
 * so a kerb between two levels keeps its own slope. The ground behind a kerb that lies well under it is lifted to meet
 * it as conformKerbs does.
 */
export const KERB_ABOVE = 0.04;
export const KERB_BELOW = 0.015;
const CELL = 2;
const SAME_LEVEL = 0.3;
const REACH = 2;
const RINGS = [0, 0.3, 0.6, 1.2, 2];
const HUMP = 0.05;
const HUMP_R = 1;
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
  return (x, z, y) => {
    let top = -Infinity;
    for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const h = u * ay + v * by + (1 - u - v) * cy;
      if (Math.abs(h - y) < SAME_LEVEL) top = Math.max(top, h);
    }
    return top;
  };
}

/** Levels the kerb parts' vertices in place; lifts low ground behind them. Returns counts and the largest move (m). */
export function levelKerbs(asphaltParts, kerbParts, groundParts, { floorOnly = false } = {}) {
  const road = topOf(asphaltParts);
  const ground = topOf(groundParts);
  let raised = 0;
  let lowered = 0;
  let maxMove = 0;
  for (const { pos } of kerbParts)
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const z = pos[i + 2];
      const y0 = pos[i + 1];
      let roadMax = -Infinity;
      let groundNear = -Infinity;
      let nearest = -Infinity;
      for (const r of RINGS) {
        const n = r === 0 ? 1 : 12;
        let ringLow = Infinity;
        let groundLow = Infinity;
        for (let k = 0; k < n; k++) {
          const px = x + r * Math.cos((k * Math.PI) / 6);
          const pz = z + r * Math.sin((k * Math.PI) / 6);
          const hr = road(px, pz, y0);
          const hg = ground(px, pz, y0);
          if (hr > -Infinity) roadMax = Math.max(roadMax, hr);
          if (hg > -Infinity) groundLow = Math.min(groundLow, hg);
          // the lowest surface on the nearest ring round the vertex: a kerb is sunk only when it lies under the
          // surfaces on every side (a grass bank rising beside a kerb is no reason to lift it)
          const h = Math.max(hr, hg);
          if (h > -Infinity) ringLow = Math.min(ringLow, h);
        }
        if (r > 0 && nearest === -Infinity && ringLow < Infinity) nearest = ringLow;
        // the ground right beside the kerb (its lowest point on the nearest ring that has ground): where the run-off
        // rises away from the road the kerb may follow it; a raised element with flat grass beside it may not
        if (r > 0 && groundNear === -Infinity && groundLow < Infinity) groundNear = groundLow;
        if (r >= REACH) break;
      }
      const ceil = Math.max(roadMax, groundNear) + KERB_ABOVE;
      const floor = nearest - KERB_BELOW;
      if (!Number.isFinite(ceil) && !Number.isFinite(floor)) continue;
      let y = y0;
      if (Number.isFinite(floor) && y < floor) y = floor;
      if (!floorOnly && Number.isFinite(ceil) && y > ceil) y = ceil;
      if (y !== y0) {
        if (y > y0) raised++;
        else lowered++;
        maxMove = Math.max(maxMove, Math.abs(y - y0));
        pos[i + 1] = y;
      }
    }
  // local humps: a kerb vertex more than HUMP over the median of the kerb within HUMP_R of it comes down to the
  // median + KERB_ABOVE (the chicane's raised element, 7-10 cm over the kerb round it); a kerb rising steadily with the
  // ground stays near its own median
  let humps = 0;
  if (!floorOnly) {
    const near = new Map();
    for (const { pos } of kerbParts)
      for (let i = 0; i < pos.length; i += 3) {
        const k = `${Math.floor(pos[i] / HUMP_R)},${Math.floor(pos[i + 2] / HUMP_R)}`;
        let l = near.get(k);
        if (!l) near.set(k, (l = []));
        l.push(pos[i], pos[i + 1], pos[i + 2]);
      }
    for (const { pos } of kerbParts)
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i];
        const z = pos[i + 2];
        const ys = [];
        for (let gx = Math.floor(x / HUMP_R) - 1; gx <= Math.floor(x / HUMP_R) + 1; gx++)
          for (let gz = Math.floor(z / HUMP_R) - 1; gz <= Math.floor(z / HUMP_R) + 1; gz++)
            for (const l of [near.get(`${gx},${gz}`)])
              if (l) for (let j = 0; j < l.length; j += 3) if (Math.hypot(l[j] - x, l[j + 2] - z) < HUMP_R && Math.abs(l[j + 1] - pos[i + 1]) < SAME_LEVEL) ys.push(l[j + 1]);
        if (ys.length < 6) continue;
        ys.sort((a, b) => a - b);
        const med = ys[ys.length >> 1];
        if (pos[i + 1] > med + HUMP) {
          maxMove = Math.max(maxMove, pos[i + 1] - med - KERB_ABOVE);
          pos[i + 1] = med + KERB_ABOVE;
          humps++;
        }
      }
  }
  // ground well under a kerb within LIFT rises to meet it (as kerb_conform.mjs)
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
  return { raised, lowered, humps, maxMove, lifted };
}
