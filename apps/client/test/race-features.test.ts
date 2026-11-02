import { describe, expect, it } from 'vitest';
import { newChampionship, scoreRace, standings } from '../src/championship';
import { DamageState } from '../src/physics/damage';
import { steeringLockDeg } from '../src/physics/steeringLock';

describe('championship', () => {
  it('scores F1 points, the fastest lap in the top ten, once per race', () => {
    const c = newChampionship(['a', 'b'], 5, 10, 3);
    const order = ['Ana', 'Bo', 'Cy', 'Di'].map((nick) => ({ nick, carId: null, classified: nick !== 'Di' }));
    scoreRace(c, 'r1', order, 'Bo');
    scoreRace(c, 'r1', order, 'Bo');
    expect(c.done).toBe(1);
    expect(c.drivers.Ana.points).toBe(25);
    expect(c.drivers.Bo.points).toBe(19);
    expect(c.drivers.Di.points).toBe(0);
    expect(c.drivers.Di.results[0]).toBe(0);
    scoreRace(c, 'r2', [...order].reverse(), null);
    expect(standings(c).map((d) => d.nick)).toEqual(['Ana', 'Bo', 'Cy', 'Di']);
  });
});

describe('damage', () => {
  const m = 1400;
  it('a nose hit costs front downforce and pulls the steering; a rear hit the rear downforce', () => {
    const d = new DamageState();
    d.impact(m * 9, 0.4, 1, m);
    expect(d.downforceFront()).toBeLessThan(1);
    expect(d.downforceRear()).toBe(1);
    expect(d.alignment).not.toBe(0);
    const r = new DamageState();
    r.impact(m * 8, 0, -1, m);
    expect(r.downforceRear()).toBeLessThan(1);
  });
  it('a hard wheel hit punctures that tyre; new tyres and repairs clear everything', () => {
    const d = new DamageState();
    d.impact(m * 12, 1, 0.6, m);
    expect(d.punctured[0]).toBe(true);
    expect(d.gripScale('FL')).toBeLessThan(0.5);
    d.tyresChanged();
    d.repair({ body: true, suspension: true, engine: true });
    expect(d.punctured.some(Boolean)).toBe(false);
    expect(d.gripScale('FL')).toBe(1);
  });
  it('light scrapes do nothing', () => {
    const d = new DamageState();
    expect(d.impact(m * 1, 1, 0, m)).toBeNull();
  });
});

describe('steering locks', () => {
  it('uses the real cars’ locks', () => {
    expect(steeringLockDeg('2024_porsche_992_gt3_r')).toBe(800);
    expect(steeringLockDeg('2025_bmw_m4_gt3_evo_g82')).toBe(516);
    expect(steeringLockDeg('mclaren_720s_lmgt3_evo')).toBe(480);
  });
});

describe('career', () => {
  it('levels by XP and moves the Safety Rating with corners per incident', async () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const { addSession, levelOf, srDelta, loadCareer } = await import('../src/career');
    expect(levelOf(0)).toEqual({ level: 1, into: 0, need: 500 });
    expect(levelOf(1250).level).toBe(3);
    expect(srDelta(240, 0)).toBeGreaterThan(0);
    expect(srDelta(240, 12)).toBeLessThan(0);
    expect(Math.abs(srDelta(100, 1))).toBeLessThan(1e-9);
    const g = addSession({ kind: 'race', km: 40, laps: 6, cleanLaps: 6, corners: 1000, incidents: 0, personalBests: 1, position: 1, field: 8, start: 4 });
    // distance 200, clean laps 120, a best 50, P1 of 8 200, three places 90, the win 250
    expect(g.xp).toBe(910);
    expect(g.srAfter).toBeGreaterThan(g.srBefore);
    expect(loadCareer().wins).toBe(1);
    // clean enough for long enough: Rookie is promoted at 3.00, the promotion costs a point
    for (let i = 0; i < 10; i++)
      addSession({ kind: 'practice', km: 10, laps: 3, cleanLaps: 3, corners: 1000, incidents: 0, personalBests: 0, position: 0, field: 1, start: 0 });
    expect(loadCareer().licence).toBe('D');
    expect(loadCareer().sr).toBeLessThan(3);
  });
});
