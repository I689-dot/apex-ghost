import type { TrackGate, TrackRaceData } from '../src/track';

/** A circular test track (radius r), counter-clockwise seen from above, n gates. */
export function ovalTrack(r = 200, gates = 12, firstGate = 0): TrackRaceData {
  const pts = 400;
  const centerline: number[] = [];
  const cumS: number[] = [];
  const L = 2 * Math.PI * r;
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    centerline.push(r * Math.sin(a), 0, -r * Math.cos(a) + r);
    cumS.push((i / pts) * L);
  }
  const gs: TrackGate[] = [];
  for (let g = 0; g < gates; g++) {
    const a = (g / gates) * Math.PI * 2;
    gs.push({ s: (g / gates) * L, p: [r * Math.sin(a), 0, -r * Math.cos(a) + r], d: [Math.cos(a), 0, Math.sin(a)], hw: 15 });
  }
  return {
    id: 'oval',
    name: 'Oval',
    length: L,
    centerline,
    cumS,
    gates: gs,
    sectorGates: [Math.round(gates / 3), Math.round((2 * gates) / 3)],
    firstGate,
    minLapMs: 10_000,
  };
}

/** Position on the oval at distance s (with a lateral offset). */
export function ovalPos(r: number, s: number, lateral = 0): [number, number, number] {
  const a = s / r;
  const rr = r - lateral;
  return [rr * Math.sin(a), 0, -rr * Math.cos(a) + r];
}
