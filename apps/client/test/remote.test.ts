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
