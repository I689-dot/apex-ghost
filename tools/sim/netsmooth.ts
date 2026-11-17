/**
 * How smoothly another car is drawn online (net/remote.ts), headless: a GT3 car's real path (straight at 250 km/h,
 * hard braking, a 150 m-radius corner, back on the power) is sampled at STATE_HZ, sent in packets of
 * STATES_PER_PACKET with latency and jitter (and a 300 ms stall), and drawn in the present at 60 fps. Reports the
 * drawn car's error against where it really is, and its jumps: how far the drawn position moves in one frame beyond
 * what its speed explains (a teleport is a big one).
 *
 *   pnpm tsx tools/sim/netsmooth.ts [--old]   (--old: an older version saved as apps/client/src/net/remote_old.tmp.ts,
 *   e.g. git show <rev>:apps/client/src/net/remote.ts > …; measured 2026-11-17: a 0.7 s hitch jumped 9.2 m before, 0.06 m after)
 */
import { makeCarState, type CarState } from '../../packages/shared/src/index.ts';
import { RemoteCarBuffer as New } from '../../apps/client/src/net/remote.ts';

const old = process.argv.includes('--old');
const { RemoteCarBuffer: Old } = old ? await import('../../apps/client/src/net/remote_old.tmp.ts') : { RemoteCarBuffer: New };
const HZ = 20;
const PER = old ? 2 : 1;
const LAT = 60;
const JIT = 25;

/** The true path at time t (s): x, z, vx, vz, yaw rate. */
function truth(t: number) {
  // phases: 0-4 s straight at 69 m/s; 4-6 s braking at 25 m/s² to 19 m/s; 6-10 s a corner (r 60 m) at 19-30 m/s; then accelerating
  let x = 0;
  let z = 0;
  let h = 0;
  let v = 69;
  const dt = 0.001;
  let wy = 0;
  for (let s = 0; s < t; s += dt) {
    if (s < 4) v = 69;
    else if (s < 6) v = Math.max(19, v - 25 * dt);
    else if (s < 10) v = Math.min(30, v + 3 * dt);
    else v = Math.min(60, v + 6 * dt);
    wy = s >= 6 && s < 10 ? v / 60 : 0;
    h += wy * dt;
    x += Math.sin(h) * v * dt;
    z += Math.cos(h) * v * dt;
  }
  return { x, z, vx: Math.sin(h) * v, vz: Math.cos(h) * v, wy, h };
}

const buf = new (old ? Old : New)();
const T = 14;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// the packets: sample times, and when each packet arrives
const arrivals: { at: number; states: CarState[]; seq: number }[] = [];
let pending: CarState[] = [];
let seq = 0;
for (let t = 0; t <= T; t += 1 / HZ) {
  const p = truth(t);
  const s = makeCarState();
  s.t = t * 1000;
  s.px = p.x;
  s.pz = p.z;
  s.vx = p.vx;
  s.vz = p.vz;
  s.wy = p.wy;
  s.qy = Math.sin(p.h / 2);
  s.qw = Math.cos(p.h / 2);
  // the sender's clock estimate: before, it stepped by up to ±40 ms at every pong (every 2 s); now it eases
  const k = Math.floor(t / 2);
  const step = (((k * 7919) % 81) - 40) / 5;
  if (!process.env.NOCLOCK) s.t += old ? step : step * Math.min(1, (t - k * 2) / 1.3);
  // yaw rate and speed as a real car reports them: noisy over kerbs and bumps
  if (!process.env.NOWY) s.wy += (rnd() - 0.5) * 0.25;
  s.vx *= 1 + (rnd() - 0.5) * 0.02;
  s.vz *= 1 + (rnd() - 0.5) * 0.02;
  pending.push(s);
  if (pending.length >= PER) {
    // bursty delivery: now and then a packet waits for the next one
    let at = t * 1000 + LAT + rnd() * JIT + (!process.env.NOBURST && rnd() < 0.15 ? 1000 / HZ : 0);
    if (t > 8 && t < 8.3) at = 8300 + LAT; // a stall mid-corner
    if (t > 2 && t < 2.7) at = 2700 + LAT; // the other driver's game hitched for 0.7 s at 250 km/h
    arrivals.push({ at, states: pending, seq: seq++ });
    pending = [];
  }
}
arrivals.sort((a, b) => a.at - b.at);
let ai = 0;
let lastX = NaN;
let lastZ = NaN;
let maxErr = 0;
let sumErr = 0;
let n = 0;
let maxJump = 0;
let jumps = 0;
const fdt = 1 / 60;
for (let t = 0.5; t < T; t += fdt) {
  const now = t * 1000;
  while (ai < arrivals.length && arrivals[ai].at <= now) {
    const a = arrivals[ai++];
    a.states.forEach((s, i) => buf.push(s, a.seq * PER + i));
  }
  const s = buf.sample(now, fdt, 0);
  if (!s) continue;
  const p = truth(t);
  const e = Math.hypot(s.px - p.x, s.pz - p.z);
  maxErr = Math.max(maxErr, e);
  sumErr += e;
  n++;
  if (!Number.isNaN(lastX)) {
    // movement beyond what the car's speed explains this frame
    const moved = Math.hypot(s.px - lastX, s.pz - lastZ);
    const extra = Math.abs(moved - Math.hypot(p.vx, p.vz) * fdt);
    maxJump = Math.max(maxJump, extra);
    if (extra > 0.5) jumps++;
  }
  lastX = s.px;
  lastZ = s.pz;
}
console.log(
  `${old ? 'before' : 'after '}: ${HZ} Hz, ${PER} a packet, ${LAT}±${JIT} ms · error avg ${(sumErr / n).toFixed(2)} m, max ${maxErr.toFixed(2)} m · biggest frame jump ${maxJump.toFixed(2)} m, frames jumping >0.5 m: ${jumps}`,
);
