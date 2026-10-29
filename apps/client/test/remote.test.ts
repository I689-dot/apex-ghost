import { describe, expect, it } from 'vitest';
import { makeCarState } from '@apex/shared';
import { RemoteCarBuffer } from '../src/net/remote';

const state = (t: number, px: number) => ({ ...makeCarState(), t, px, vx: 10, qw: 1 });

describe('RemoteCarBuffer', () => {
  it('follows the stream again after a packet stamped far in the future (clock jump on a tab switch)', () => {
    const b = new RemoteCarBuffer();
    let seq = 0;
    for (let t = 1000; t <= 2000; t += 50) b.push(state(t, t / 100), seq++);
    // one packet decoded while the clock was ~55 years ahead
    b.push(state(2050 + 1.7e12, 99), seq++);
    for (let t = 2100; t <= 3000; t += 50) b.push(state(t, t / 100), seq++);
    expect(b.newestTime()).toBe(3000);
    const s = b.sample(2900 + 150, 1 / 60);
    expect(s?.extrapolating).toBe(false);
    expect(s?.px).toBeCloseTo(29, 0);
  });

  it('still drops ordinary late and duplicate packets', () => {
    const b = new RemoteCarBuffer();
    b.push(state(1000, 10), 0);
    b.push(state(1100, 11), 1);
    b.push(state(1050, 99), 2);
    b.push(state(1100, 99), 3);
    expect(b.newestTime()).toBe(1100);
  });
});

/** A car on a circle of radius r at speed v (counter-clockwise seen from above: yaw rate +v/r), braking at `brake`. */
function circle(t: number, r: number, v0: number, brake = 0) {
  const tt = t / 1000;
  const v = v0 - brake * tt;
  const ang = (v0 * tt - 0.5 * brake * tt * tt) / r;
  const s = makeCarState();
  s.t = t;
  // heading +Z at ang 0, turning towards +X (positive yaw rate)
  s.px = r * (1 - Math.cos(ang));
  s.pz = r * Math.sin(ang);
  s.vx = v * Math.sin(ang);
  s.vz = v * Math.cos(ang);
  s.wy = v / r;
  s.qy = Math.sin(ang / 2);
  s.qw = Math.cos(ang / 2);
  return s;
}

describe('remote cars in the present (dead reckoning)', () => {
  it('follows a corner within centimetres where a straight line is off by most of a metre', () => {
    const buf = new RemoteCarBuffer();
    for (let t = 0; t <= 1000; t += 50) buf.push(circle(t, 100, 55), t / 50);
    const out = buf.sample(1200, 1 / 60, 0);
    const truth = circle(1200, 100, 55);
    const err = Math.hypot((out?.px ?? 0) - truth.px, (out?.pz ?? 0) - truth.pz);
    // a straight line from the newest sample
    const n = circle(1000, 100, 55);
    const line = Math.hypot(n.px + n.vx * 0.2 - truth.px, n.pz + n.vz * 0.2 - truth.pz);
    expect(err).toBeLessThan(0.1);
    expect(line).toBeGreaterThan(0.5);
  });

  it('carries braking forward', () => {
    const buf = new RemoteCarBuffer();
    for (let t = 0; t <= 1000; t += 50) buf.push(circle(t, 400, 70, 25), t / 50);
    const out = buf.sample(1200, 1 / 60, 0);
    const truth = circle(1200, 400, 70, 25);
    expect(Math.hypot((out?.px ?? 0) - truth.px, (out?.pz ?? 0) - truth.pz)).toBeLessThan(0.2);
  });

  it('watching still draws the past, between samples', () => {
    const buf = new RemoteCarBuffer();
    for (let t = 0; t <= 1000; t += 50) buf.push(circle(t, 100, 55), t / 50);
    const out = buf.sample(1000, 1 / 60);
    const truth = circle(850, 100, 55);
    expect(out?.extrapolating).toBe(false);
    expect(Math.hypot((out?.px ?? 0) - truth.px, (out?.pz ?? 0) - truth.pz)).toBeLessThan(0.05);
  });
});
