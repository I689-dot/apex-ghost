import { describe, expect, it } from 'vitest';
import { COINS, SR_START, coinsForResult, licenceAfter, newInviteCode, normaliseCode, ratingDelta, srDelta } from '../src/economy';

describe('economy', () => {
  it('pays a finished online race by its place', () => {
    expect(coinsForResult(1, 8, false).coins).toBe(COINS.finish + COINS.win);
    expect(coinsForResult(3, 8, false).coins).toBe(COINS.finish + COINS.podium);
    expect(coinsForResult(7, 8, false).coins).toBe(COINS.finish);
    expect(coinsForResult(7, 8, true).coins).toBe(COINS.finish + COINS.firstOfDay);
    expect(coinsForResult(1, 1, true).coins).toBe(0);
  });
  it('moves the Driver Rating: the winner up, the last down, the middle level', () => {
    expect(ratingDelta(1, 9)).toBeGreaterThan(0);
    expect(ratingDelta(9, 9)).toBe(-ratingDelta(1, 9));
    expect(ratingDelta(5, 9)).toBe(0);
    expect(ratingDelta(1, 12)).toBeGreaterThan(ratingDelta(1, 4));
    expect(ratingDelta(1, 1)).toBe(0);
  });
  it('makes invite codes without look-alike letters and reads codes however they are typed', () => {
    const c = newInviteCode((n) => new Uint8Array(n).map((_, i) => i * 37));
    expect(c).toMatch(/^CG-[A-HJ-NP-Z2-9]{5}$/);
    expect(normaliseCode(' welcome 500 ')).toBe('WELCOME500');
  });
  it('rates safety as the offline career: clean corners up slowly, incidents down, the licence classes', () => {
    // (no incidents counts as half a point, as offline: 240 corners a point)
    expect(srDelta(120, 0)).toBeCloseTo(0.0758, 3);
    expect(srDelta(100, 1)).toBeCloseTo(0, 5);
    expect(srDelta(120, 12)).toBeLessThan(-0.1);
    expect(srDelta(0, 4)).toBe(0);
    // Rookie to Class D at 3.00, at the cost of 1.00
    expect(licenceAfter('R', 2.95, 240, 0)).toEqual({ licence: 'D', sr: 2.07 });
    // a class down below 1.00, back at the start
    expect(licenceAfter('C', 1.05, 120, 40)).toEqual({ licence: 'D', sr: SR_START });
    // Rookie is the floor, Pro the top
    expect(licenceAfter('R', 0.1, 120, 40).licence).toBe('R');
    expect(licenceAfter('P', 4.98, 240, 0)).toEqual({ licence: 'P', sr: 4.99 });
    // an unknown licence reads as Rookie
    expect(licenceAfter('?', SR_START, 0, 0)).toEqual({ licence: 'R', sr: SR_START });
  });
});
