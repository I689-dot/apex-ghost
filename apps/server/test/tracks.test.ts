import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RaceTracker, type TrackRaceData } from '@apex/shared';
import tracksRace from '@apex/shared/generated/tracks-race.json';

const TRACKS = tracksRace as unknown as Record<string, TrackRaceData>;
const index = JSON.parse(readFileSync(new URL('../../client/public/assets/tracks.json', import.meta.url), 'utf8')).tracks as { id: string }[];

/** Position on the centreline at lap distance s (wraps). */
function at(track: TrackRaceData, s: number): [number, number, number] {
  const L = track.length;
  const sm = ((s % L) + L) % L;
  const cl = track.centerline;
  const n = cl.length / 3;
  let i = 0;
  while (i < n - 1 && track.cumS[i + 1] <= sm) i++;
  const j = (i + 1) % n;
  const seg = (j === 0 ? L : track.cumS[j]) - track.cumS[i] || 1;
  const f = (sm - track.cumS[i]) / seg;
  return [cl[i * 3] + (cl[j * 3] - cl[i * 3]) * f, cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * f, cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * f];
}

describe('track validation data', () => {
  it('lists every layout of the index, Zandvoort included', () => {
    expect(Object.keys(TRACKS).sort()).toEqual(index.map((t) => t.id).sort());
    expect(TRACKS.zandvoort?.name).toBe('Circuit Zandvoort');
  });

  for (const [id, track] of Object.entries(TRACKS)) {
    it(`${id}: a lap along the lap line is validated by the server's tracker`, () => {
      expect(track.gates[0].s).toBe(0);
      expect(track.sectorGates[0]).toBeLessThan(track.sectorGates[1]);
      expect(track.sectorGates[1]).toBeLessThan(track.gates.length);
      const tr = new RaceTracker(track, 0, 3);
      tr.addPlayer('a');
      // from the grid (behind the first gate the cars must cross) to just past the line, at 50 m/s
      const from = track.firstGate === 0 ? -30 : track.gates[track.firstGate].s - 30;
      const v = 50;
      let t = 0;
      for (let s = from; s <= track.length + 10; s += v * 0.05) {
        tr.ingest('a', t, ...at(track, s), false);
        t += 50;
      }
      const p = tr.players.get('a');
      expect(p?.laps).toBe(1);
      expect(p?.lastLapMs).toBeGreaterThan(track.minLapMs);
    });
  }
});
