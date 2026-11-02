/**
 * The Nürburgring GP pit entry, rebuilt from (lap s, lateral) pairs: used by optimize.mjs when the map is built, and
 * standalone to rebuild it in the shipped layouts (and the server's validation data) without rebuilding the map:
 *
 *   node tools/asset-pipeline/pit_entry.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The traced pit entry wandered off into the paddock (up to 89 m from the lane, so the minimap and the pit-lane
 * markings were wrong there). The real lane, measured from the collision surfaces (tools/sim/pitlat.mjs):
 * it leaves the track through the gap between the end of the circuit's barrier (lap 4943 m, 7 m left) and the start
 * of the wall between the lane and the circuit (4971 m, 9 m left), runs 13–16 m left of the centreline behind that
 * wall, crosses the apron and reaches the garages ~20 m left by ~5190 m, where the trace was right again. (It used to
 * leave at 4975 m and crossed the start of that wall: bots scraped it and climbed it.) Rebuilt as
 * (lap s, lateral) pairs on the GP centreline; the service box is moved in front of the garages
 * (5190 m … 60 m, across the start line). Other layouts sharing the lane get the same points.
 */
const PIT_ENTRY = [
  [4930, -2.5],
  [4945, -4.5],
  [4955, -8.5],
  [4962, -11.5],
  [4972, -13.3],
  [4990, -13.5],
  [5000, -13],
  [5060, -13],
  [5100, -14],
  [5150, -16],
  [5190, -19.5],
];
const PIT_BOX = [5, 300]; // the whole garage row (lap m), one box per garage painted by the client

export function fixPitEntry(bases, log = console.log) {
  const gp = bases[0];
  const pl = gp.pitLane;
  if (!pl) return;
  const cl = gp.centerline;
  const cs = gp.cumS;
  const n = cl.length / 3;
  const L = gp.length;
  const frame = (sLap) => {
    const sm = ((sLap % L) + L) % L;
    let i = 0;
    while (i < n - 1 && cs[i + 1] <= sm) i++;
    const j = (i + 1) % n;
    const seg = (j === 0 ? L : cs[j]) - cs[i] || 1;
    const f = Math.min(1, Math.max(0, (sm - cs[i]) / seg));
    let tx = cl[j * 3] - cl[i * 3];
    let tz = cl[j * 3 + 2] - cl[i * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    return { x: cl[i * 3] + (cl[j * 3] - cl[i * 3]) * f, y: cl[i * 3 + 1], z: cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * f, tx, tz };
  };
  const project = (p) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (cl[i * 3] - p[0]) ** 2 + (cl[i * 3 + 2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const j = (best + 1) % n;
    let tx = cl[j * 3] - cl[best * 3];
    let tz = cl[j * 3 + 2] - cl[best * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    return { s: cs[best], lat: (p[0] - cl[best * 3]) * tz - (p[2] - cl[best * 3 + 2]) * tx };
  };
  const old = pl.points;
  // first old point back on the real lane (in front of the garages)
  const join = old.findIndex((p) => {
    const q = project(p);
    return q.s >= PIT_ENTRY[PIT_ENTRY.length - 1][0] && q.s < L - 2 && q.lat < -17 && q.lat > -25;
  });
  if (join < 0) return;
  const sJoin = project(old[join]).s;
  const latAt = (sl) => {
    const P = [...PIT_ENTRY, [sJoin, project(old[join]).lat]];
    for (let k = 0; k < P.length - 1; k++) if (sl <= P[k + 1][0]) return P[k][1] + ((P[k + 1][1] - P[k][1]) * (sl - P[k][0])) / (P[k + 1][0] - P[k][0] || 1);
    return P[P.length - 1][1];
  };
  const pts = [];
  for (let sl = PIT_ENTRY[0][0]; sl < sJoin - 1; sl += 2.5) {
    const f = frame(sl);
    const lat = latAt(sl);
    // + lateral = left of travel: left of (tx, tz) is (tz, -tx)
    pts.push([round3(f.x + f.tz * lat), f.y, round3(f.z - f.tx * lat)]);
  }
  const points = [...pts, ...old.slice(join)];
  let len = 0;
  for (let k = 1; k < points.length; k++) len += Math.hypot(points[k][0] - points[k - 1][0], points[k][2] - points[k - 1][2]);
  const lapS = points.map((p) => project(p).s);
  const inBox = (sl) => (PIT_BOX[0] > PIT_BOX[1] ? sl >= PIT_BOX[0] || sl <= PIT_BOX[1] : sl >= PIT_BOX[0] && sl <= PIT_BOX[1]);
  const boxFrom = lapS.findIndex((sl, k) => k > pts.length / 2 && inBox(sl));
  let boxTo = boxFrom;
  while (boxTo + 1 < points.length && inBox(lapS[boxTo + 1])) boxTo++;
  const before = old.length;
  const fixed = { ...pl, points, length: Math.round(len * 10) / 10, entryS: PIT_ENTRY[0][0], boxFrom, boxTo };
  for (const b of bases) {
    if (!b.pitLane) continue;
    const mid = b.pitLane.points[Math.floor(b.pitLane.points.length / 2)];
    const same = old.some((p) => Math.hypot(p[0] - mid[0], p[2] - mid[2]) < 5);
    if (!same) continue;
    b.pitLane = b === gp ? fixed : { ...b.pitLane, points: points.map((p) => p.slice()), length: fixed.length, boxFrom, boxTo };
  }
  log(`pit entry rebuilt: ${before} → ${points.length} points, ${Math.round(len)} m, service box ${boxFrom}–${boxTo}`);
}

const round3 = (v) => Math.round(v * 1000) / 1000;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const pub = path.join(root, 'apps/client/public');
  const index = JSON.parse(readFileSync(path.join(pub, 'assets/tracks.json'), 'utf8')).tracks.filter((t) => t.id !== 'zandvoort');
  const files = index.map((t) => path.join(pub, t.file.replace(/\?.*$/, '')));
  // the GP layout first: it is the one the pairs are measured on
  const bases = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const gp = bases.findIndex((b) => b.id === 'nurburgring_gp_2022');
  if (gp < 0) throw new Error('no Nürburgring GP layout');
  const order = [gp, ...bases.map((_, i) => i).filter((i) => i !== gp)];
  const before = bases.map((b) => b.pitLane?.entryS);
  fixPitEntry(order.map((i) => bases[i]));
  // the entry moved along the GP lap; the layouts sharing the lane have it at their own lap distance: moved alike
  const moved = bases[gp].pitLane.entryS - before[gp];
  const lane = JSON.stringify(bases[gp].pitLane.points);
  bases.forEach((b, i) => {
    if (i !== gp && b.pitLane && before[i] !== undefined && JSON.stringify(b.pitLane.points) === lane)
      b.pitLane.entryS = Math.round((before[i] + moved) * 10) / 10;
  });
  for (const i of order) writeFileSync(files[i], JSON.stringify(bases[i]));
  // the server's copy (race rules near the lane): only the number changes, the files keep their formatting
  const gen = path.join(root, 'packages/shared/src/generated');
  for (const f of ['track-race.json', 'tracks-race.json']) {
    const file = path.join(gen, f);
    let text = readFileSync(file, 'utf8');
    bases.forEach((b, i) => {
      if (!b.pitLane || before[i] === undefined || JSON.stringify(b.pitLane.points) !== lane || before[i] === b.pitLane.entryS) return;
      const at = text.indexOf(`"id":"${b.id}"`);
      if (at < 0) return;
      const key = `"pitEntryS":${before[i]}`;
      const k = text.indexOf(key, at);
      const next = text.indexOf('"id":"', at + 6);
      if (k < 0 || (next >= 0 && k > next)) return;
      text = text.slice(0, k) + `"pitEntryS":${b.pitLane.entryS}` + text.slice(k + key.length);
    });
    writeFileSync(file, text);
  }
  console.log(`pit entry: ${bases.map((b) => `${b.id} ${b.pitLane?.entryS}`).join(', ')}`);
}
