import type { TrackRaceData } from '@apex/shared';

/**
 * Walls that cross the layout's own lap line are taken out of its collision. Layouts share one map's collision mesh,
 * and the map closes the roads the GP lap doesn't use: on the short Nürburgring layout the link road it runs through
 * is shut by a barrier where it meets the GP road, and every car drove into it at full speed (the bots never finished
 * a lap). A wall never belongs across the racing line: any wall triangle whose footprint from above crosses a
 * centreline segment, within 4 m of the road's height there, is dropped.
 *
 * Returns the kept triangle indices (the same array when nothing is cut).
 */
export function cutWallsAcrossLine(positions: Float32Array, indices: Uint32Array, track: TrackRaceData): Uint32Array {
  const cl = track.centerline;
  const n = cl.length / 3;
  // centreline segments by 10 m cell
  const C = 10;
  const grid = new Map<number, number[]>();
  const key = (x: number, z: number) => Math.floor(x / C) * 100003 + Math.floor(z / C);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xa = Math.min(cl[i * 3], cl[j * 3]);
    const xb = Math.max(cl[i * 3], cl[j * 3]);
    const za = Math.min(cl[i * 3 + 2], cl[j * 3 + 2]);
    const zb = Math.max(cl[i * 3 + 2], cl[j * 3 + 2]);
    for (let x = Math.floor(xa / C); x <= Math.floor(xb / C); x++)
      for (let z = Math.floor(za / C); z <= Math.floor(zb / C); z++) {
        const k = x * 100003 + z;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
  }
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean => {
    const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
    const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  const keep: number[] = [];
  let cut = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const tri = [a, b, c];
    let hit = false;
    const seen = new Set<number>();
    for (const v of tri) {
      const list = grid.get(key(positions[v], positions[v + 2]));
      if (!list) continue;
      for (const i of list) {
        if (seen.has(i)) continue;
        seen.add(i);
        const j = (i + 1) % n;
        const y = cl[i * 3 + 1];
        const ylo = Math.min(positions[a + 1], positions[b + 1], positions[c + 1]);
        const yhi = Math.max(positions[a + 1], positions[b + 1], positions[c + 1]);
        if (yhi < y - 4 || ylo > y + 4) continue;
        for (let e = 0; e < 3 && !hit; e++) {
          const p = tri[e];
          const q = tri[(e + 1) % 3];
          hit = cross(positions[p], positions[p + 2], positions[q], positions[q + 2], cl[i * 3], cl[i * 3 + 2], cl[j * 3], cl[j * 3 + 2]);
        }
        if (hit) break;
      }
      if (hit) break;
    }
    if (hit) cut++;
    else keep.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return cut ? Uint32Array.from(keep) : indices;
}
