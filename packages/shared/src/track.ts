export type Vec3 = [number, number, number];

export const SURFACES = ['asphalt', 'curb', 'grass', 'gravel', 'sand', 'wall'] as const;
export type Surface = (typeof SURFACES)[number];

export interface TrackGate {
  /** Distance along the centreline from the start/finish line (m). */
  s: number;
  /** Centre point of the gate. */
  p: Vec3;
  /** Unit horizontal forward direction (racing direction). */
  d: Vec3;
  /** Half width of the gate including run-off (m). */
  hw: number;
}

/** The subset of track data the server needs for race validation. */
export interface TrackRaceData {
  id: string;
  name: string;
  /** Lap length (m). */
  length: number;
  /** Closed centreline, flat [x, y, z, …], first point on the start/finish line. */
  centerline: number[];
  /** Cumulative distance at each centreline point. */
  cumS: number[];
  /** Ordered checkpoint gates. Gate 0 is the start/finish line. */
  gates: TrackGate[];
  /** Gate indices that end sector 1 and sector 2 (sector 3 ends at gate 0). */
  sectorGates: [number, number];
  /** First gate a car on the grid must cross (0 when the grid is behind the line). */
  firstGate: number;
  /** Lap distance where the pit lane rejoins the circuit (null: no pit lane). */
  pitExitS?: number | null;
  /** Lap distance where the pit lane leaves the circuit, and its length (m): the safety car's way in, drive-throughs. */
  pitEntryS?: number | null;
  pitLaneM?: number | null;
  /** Fastest plausible lap (ms). */
  minLapMs: number;
}

export interface GridSlot {
  p: Vec3;
  /** Heading in radians, rotation about +Y; 0 means facing +Z. */
  yaw: number;
}

export interface TrackData extends TrackRaceData {
  version: number;
  grid: GridSlot[];
  /** Half road width left/right of the centreline at each centreline point. */
  widthL: number[];
  widthR: number[];
  /** Track limits: the painted white edge line, m from the centreline per point (track_limits.mjs). */
  limitL?: number[];
  limitR?: number[];
  /** Render chunks to load. */
  chunks: { file: string; node: string; center: Vec3; radius: number; kind: 'track' | 'scenery' | 'trees' | 'terrain' }[];
  /** Collision mesh file and the surface type of each sub-mesh in it. */
  collision: { file: string; surfaces: Surface[]; /** more collision files (a base map's), same surface list */ extra?: string[] };
  /** Static light sources found in the map. */
  lights: { p: Vec3; color: [number, number, number] }[];
  bounds: { min: Vec3; max: Vec3 };
  /** Start lights gantry (for the countdown) */
  startLine: { p: Vec3; d: Vec3; hw: number };
  /** Pit lane: from the entry (inside of the last corner) to the exit (before Turn 1). */
  pitLane: PitLane | null;
  /** Stretches [fromS, toS] (m) where the map's collision is rough: the wheels ride a smoothed surface there
   * (client game/roadPatches.ts). */
  smoothRoad?: [number, number][];
  /** Number of corners (from the track index, for the TV intro); null/absent = not stated. */
  turns?: number | null;
  /** Map the layout belongs to (from the track index): its climate and altitude (shared weather code). */
  map?: string;
  /** Procedural forest instances (tools/asset-pipeline/forest_scatter.mjs); absent = no forest. */
  forest?: { file: string; meta: string };
}

export interface PitLane {
  /** Centre line every 2.5 m, entry → exit. */
  points: Vec3[];
  length: number;
  /** Lap distance where it leaves / rejoins the circuit. */
  entryS: number;
  exitS: number;
  /** Indices into `points` of the service zone (the garages). */
  boxFrom: number;
  boxTo: number;
  speedLimitKmh: number;
}

/** Horizontal side vector (pointing to the driver's left when facing `d`). */
export function gateSide(d: Vec3): Vec3 {
  return [d[2], 0, -d[0]];
}

export interface GateCrossing {
  /** 0..1 along the segment where the plane was crossed. */
  f: number;
}

/**
 * Segment a→b crosses gate g (from behind to in front, within its width)?
 * Pure arithmetic, no allocation.
 */
export function crossesGate(g: TrackGate, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const da = (ax - g.p[0]) * g.d[0] + (az - g.p[2]) * g.d[2];
  const db = (bx - g.p[0]) * g.d[0] + (bz - g.p[2]) * g.d[2];
  if (!(da < 0 && db >= 0)) return -1;
  const f = da / (da - db);
  const x = ax + (bx - ax) * f;
  const y = ay + (by - ay) * f;
  const z = az + (bz - az) * f;
  const lateral = Math.abs((x - g.p[0]) * g.d[2] - (z - g.p[2]) * g.d[0]);
  if (lateral > g.hw) return -1;
  if (Math.abs(y - g.p[1]) > 12) return -1;
  return f;
}

/**
 * Nearest centreline point index to (x, z). Searches ±window around `hint`
 * (or the whole loop when hint < 0).
 */
export function nearestCenterlineIndex(track: TrackRaceData, x: number, y: number, z: number, hint: number, window = 40): number {
  const cl = track.centerline;
  const n = cl.length / 3;
  let best = -1;
  let bestD = Infinity;
  const full = hint < 0;
  const count = full ? n : Math.min(n, window * 2 + 1);
  const start = full ? 0 : hint - window;
  for (let k = 0; k < count; k++) {
    const i = (((start + k) % n) + n) % n;
    const dx = cl[i * 3] - x;
    const dy = (cl[i * 3 + 1] - y) * 2; // vertical separation matters more (bridges)
    const dz = cl[i * 3 + 2] - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Distance along the centreline (0..length) of the projection of (x, z) near index i. */
export function progressAt(track: TrackRaceData, i: number, x: number, z: number): number {
  const cl = track.centerline;
  const n = cl.length / 3;
  const j = (i + 1) % n;
  const ax = cl[i * 3];
  const az = cl[i * 3 + 2];
  const bx = cl[j * 3];
  const bz = cl[j * 3 + 2];
  const sx = bx - ax;
  const sz = bz - az;
  const len2 = sx * sx + sz * sz || 1;
  let t = ((x - ax) * sx + (z - az) * sz) / len2;
  if (t < -0.5) t = -0.5;
  if (t > 1.5) t = 1.5;
  const segLen = j === 0 ? track.length - track.cumS[i] : track.cumS[j] - track.cumS[i];
  let s = track.cumS[i] + t * segLen;
  if (s < 0) s += track.length;
  if (s >= track.length) s -= track.length;
  return s;
}

/** Forward-wrapped distance from s0 to s1 on a loop of length L, mapped into (-L/2, L/2]. */
export function wrapDelta(s0: number, s1: number, L: number): number {
  let d = (s1 - s0) % L;
  if (d > L / 2) d -= L;
  if (d <= -L / 2) d += L;
  return d;
}
