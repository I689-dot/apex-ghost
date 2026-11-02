/**
 * Corner cutting on a real layout, judged by the lap logic (RaceTracker) as the server judges it: a car follows the
 * centreline, and at every corner where a straight line through the grass skips at least 10 m of track it takes
 * that line instead (slower: 25 m/s off the track, 40 m/s on it). Each cut must be penalised: a time penalty in the
 * race, the lap deleted in qualifying. Running wide on the outside (the same length, nothing gained) must only be a
 * warning. A clean lap must draw nothing.
 *
 *   pnpm tsx tools/sim/cutcheck.ts [--track <layout id>]
 */
import { RaceTracker, type RaceEvent, type TrackData } from '../../packages/shared/src/index.ts';
import { loadTrack, trackArg } from './trackfile.mjs';

const track = loadTrack(trackArg(process.argv)).track as TrackData;
const cl = track.centerline;
const n = cl.length / 3;
const L = track.length;
const cum = track.cumS;
const limit = (i: number, left: boolean) => (left ? track.limitL : track.limitR)?.[i] ?? (left ? track.widthL[i] : track.widthR[i]) + 0.5;
const at = (s: number): [number, number, number, number] => {
  s = ((s % L) + L) % L;
  let i = 0;
  while (i < n - 1 && cum[i + 1] <= s) i++;
  const j = (i + 1) % n;
  const seg = (i + 1 < n ? cum[i + 1] : L) - cum[i];
  const f = seg > 0 ? (s - cum[i]) / seg : 0;
  return [cl[i * 3] + (cl[j * 3] - cl[i * 3]) * f, cl[i * 3 + 1], cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * f, i];
};
/** Beyond the limits with a car 1.9 m wide (all four wheels out): the nearest centreline point decides. */
const offAt = (x: number, z: number, hint: number): boolean => {
  let best = hint;
  let bd = Infinity;
  for (let k = -40; k <= 40; k++) {
    const i = (((hint + k) % n) + n) % n;
    const d = (cl[i * 3] - x) ** 2 + (cl[i * 3 + 2] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const j = (best + 1) % n;
  const tx = cl[j * 3] - cl[best * 3];
  const tz = cl[j * 3 + 2] - cl[best * 3 + 2];
  const tl = Math.hypot(tx, tz) || 1;
  const lat = ((x - cl[best * 3]) * tz - (z - cl[best * 3 + 2]) * tx) / tl;
  return Math.abs(lat) - 0.95 > limit(best, lat >= 0) + 0.5;
};

interface Run {
  events: RaceEvent[];
}
/** One lap from the line, with a detour on [s0, s1]: 'cut' a chord, 'wide' 6 m beyond the outside edge. */
function lap(race: boolean, detour: { s0: number; s1: number; kind: 'cut' | 'wide' } | null): Run {
  const tr = new RaceTracker(track, 0, race ? { raceLaps: 5 } : 5);
  tr.addPlayer('x');
  const events: RaceEvent[] = [];
  let t = 0;
  let hold = 0;
  const feed = (x: number, y: number, z: number, i: number, dt: number) => {
    hold = offAt(x, z, i) ? hold + dt : 0;
    tr.ingest('x', t, x, y, z, false, events, hold >= 0.4);
    t += dt * 1000;
  };
  // the out lap from just behind the line, then a timed lap with the detour
  const start = race ? -30 : -30;
  const lapStart = race ? 0 : L;
  const end = lapStart + L + 30;
  let s = start;
  while (s < end) {
    if (detour && s >= lapStart + detour.s0 && s < lapStart + detour.s1) {
      const a = at(detour.s0);
      const b = at(detour.s1);
      if (detour.kind === 'cut') {
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        for (let d = 0; d < len; d += 25 * 0.05) {
          const f = d / len;
          const i = Math.round(a[3] + (b[3] - a[3] + (b[3] < a[3] ? n : 0)) * f) % n;
          feed(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, i, 0.05);
        }
      } else {
        // the outside of the corner: the side whose offset path is longer
        const mid = at((detour.s0 + detour.s1) / 2);
        const chordMid = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2];
        const jm = (mid[3] + 1) % n;
        const side = (mid[0] - chordMid[0]) * (cl[jm * 3 + 2] - cl[mid[3] * 3 + 2]) - (mid[2] - chordMid[1]) * (cl[jm * 3] - cl[mid[3] * 3]) >= 0 ? 1 : -1;
        for (let ss = detour.s0; ss < detour.s1; ss += 40 * 0.05) {
          const p = at(ss);
          const j = (p[3] + 1) % n;
          const tx = cl[j * 3] - cl[p[3] * 3];
          const tz = cl[j * 3 + 2] - cl[p[3] * 3 + 2];
          const tl = Math.hypot(tx, tz) || 1;
          // out past the edge on the outside (and eased in and out)
          const k = Math.sin((Math.PI * (ss - detour.s0)) / (detour.s1 - detour.s0));
          const off = side * (limit(p[3], side > 0) + 6) * k;
          feed(p[0] + (tz / tl) * off, p[1], p[2] - (tx / tl) * off, p[3], 0.05);
        }
      }
      s = lapStart + detour.s1;
      continue;
    }
    const p = at(s);
    feed(p[0], p[1], p[2], p[3], 0.05);
    s += 40 * 0.05;
  }
  return { events };
}

const verdict = (r: Run) => {
  const p = r.events.filter((e) => e.type === 'penalty') as Extract<RaceEvent, { type: 'penalty' }>[];
  return p
    .map(
      (e) =>
        `${e.reason}${e.noAdvantage ? ' (lost time, no strike)' : ''}${e.contact ? ' (contact)' : ''}${e.invalidated ? ' lap deleted' : ''}${e.warning ? ` warning ${e.warning}` : ''}${e.gainMs !== undefined ? ` cut (gained ${(e.gainMs / 1000).toFixed(1)} s)` : ''}${e.ms ? ` +${e.ms / 1000} s` : ''}`,
    )
    .join(', ');
};

console.log(`▶ ${track.name} (${L.toFixed(0)} m)`);
console.log(`  clean lap: race "${verdict(lap(true, null))}" · qualifying "${verdict(lap(false, null))}"`);
// candidate cuts: chords that leave the track, stay within 45 m of it and skip ≥ 10 m
const cuts: { s0: number; s1: number; skip: number }[] = [];
for (let s0 = 100; s0 < L - 400; s0 += 10) {
  let best: { s0: number; s1: number; skip: number } | null = null;
  for (let s1 = s0 + 40; s1 <= s0 + 300; s1 += 10) {
    const a = at(s0);
    const b = at(s1);
    const chord = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const skip = s1 - s0 - chord;
    if (skip < 10) continue;
    let leaves = false;
    let far = false;
    for (let f = 0.1; f < 1; f += 0.1) {
      const x = a[0] + (b[0] - a[0]) * f;
      const z = a[2] + (b[2] - a[2]) * f;
      const i = Math.round(a[3] + (b[3] - a[3]) * f);
      if (offAt(x, z, i)) leaves = true;
      const p = at(s0 + (s1 - s0) * f);
      if (Math.hypot(p[0] - x, p[2] - z) > 45) far = true;
    }
    if (leaves && !far && (!best || skip > best.skip)) best = { s0, s1, skip };
  }
  if (best && !cuts.some((c) => Math.abs(c.s0 - best.s0) < 120)) cuts.push(best);
}
let missed = 0;
for (const c of cuts) {
  const race = verdict(lap(true, { ...c, kind: 'cut' }));
  const quali = verdict(lap(false, { ...c, kind: 'cut' }));
  const ok = /cut|shortcut/.test(race) && /lap deleted/.test(quali);
  if (!ok) missed++;
  console.log(`  ${ok ? 'ok  ' : 'MISS'} cut ${c.s0}–${c.s1} m (skips ${c.skip.toFixed(0)} m): race "${race}" · qualifying "${quali}"`);
}
let wrong = 0;
for (const s0 of [600, 1500, 2500]) {
  if (s0 + 120 > L - 100) continue;
  const race = verdict(lap(true, { s0, s1: s0 + 120, kind: 'wide' }));
  const ok = /warning 1/.test(race) && !/cut|\+/.test(race);
  if (!ok) wrong++;
  console.log(`  ${ok ? 'ok  ' : 'WRONG'} running wide ${s0}–${s0 + 120} m: race "${race}"`);
}
console.log(`  ${cuts.length} cuts, ${missed} not penalised; ${wrong} wide runs judged wrong`);
if (missed || wrong) process.exitCode = 1;
