import { describe, expect, it } from 'vitest';
import { COINS, coinsForResult, newInviteCode, normaliseCode, ratingDelta } from '../src/economy';

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
});
