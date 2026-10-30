import { describe, expect, it } from 'vitest';
import {
  PENALTY,
  PIT_WINDOW,
  RACE_CONTROL,
  RaceControl,
  RaceTracker,
  driveThroughCostMs,
  finishGraceMs,
  parseClientMsg,
  pitWindowLaps,
  safetyCarAt,
  safetyCarPath,
  safetyCarReaches,
  type RaceEvent,
} from '../src';
import { ovalPos, ovalTrack } from './helpers';

const R = 200;
const L = 2 * Math.PI * R;
/** The oval with a pit lane: in at 1100 m, out at 150 m, 25 m inside the circuit (as in race.ts's own tests). */
const track = { ...ovalTrack(R, 12), pitEntryS: 1100, pitExitS: 150, pitLaneM: 300 };

/** Drive along the oval from fromS to toS at `speed` (m/s), a sample every 50 ms. Returns the time reached. */
function drive(tr: RaceTracker, id: string, t0: number, fromS: number, toS: number, speed: number, lateral = 0, out: RaceEvent[] = []): number {
  let t = t0;
  for (let s = fromS; s <= toS; s += speed * 0.05) {
    const [x, y, z] = ovalPos(R, s, lateral);
    tr.ingest(id, t, x, y, z, false, out);
    t += 50;
  }
  return t;
}

/** Stand still at lap distance s for `ms`. */
function stand(tr: RaceTracker, id: string, t0: number, s: number, ms: number, lateral = 0, out: RaceEvent[] = []): number {
  const [x, y, z] = ovalPos(R, s, lateral);
  let t = t0;
  for (; t < t0 + ms; t += 50) tr.ingest(id, t, x, y, z, false, out);
  return t;
}

/** A race lap through the pit lane: in at 1100 m, `stopMs` standing in the box, out at 150 m of the next lap. */
function pitLap(tr: RaceTracker, id: string, t0: number, lapBase: number, stopMs: number, out: RaceEvent[], from = lapBase + 1): number {
  let t = drive(tr, id, t0, from, lapBase + 1100, 50, 0, out);
  tr.pitIn(id, t, out);
  t = drive(tr, id, t, lapBase + 1100, lapBase + L - 20, 15, -25, out);
  if (stopMs > 0) t = stand(tr, id, t, lapBase + L - 20, stopMs, -25, out);
  t = drive(tr, id, t, lapBase + L - 20, lapBase + L + 150, 15, -25, out);
  tr.pitOut(id, 150, t, out);
  return t;
}

describe('pit window (mandatory stop with a driver change)', () => {
  it('opens around mid-race and never on the last lap', () => {
    expect(pitWindowLaps(3)).toEqual({ open: 1, close: 2 });
    expect(pitWindowLaps(5)).toEqual({ open: 2, close: 3 });
    expect(pitWindowLaps(10)).toEqual({ open: 4, close: 6 });
    expect(pitWindowLaps(15)).toEqual({ open: 6, close: 9 });
  });

  it('counts a stop in the window that stands long enough; no stop costs PENALTY.missedStopMs', () => {
    const tr = new RaceTracker(track, 0, { raceLaps: 5, pitWindow: true });
    tr.addPlayer('stop');
    tr.addPlayer('short');
    tr.addPlayer('none');
    const ev: RaceEvent[] = [];
    for (const id of ['stop', 'short', 'none']) {
      let t = drive(tr, id, 0, -10, L + 1, 50, 0, ev); // lap 1
      // lap 2 is in the window: a full driver change, a stop too short for one, or no stop
      if (id === 'none') t = drive(tr, id, t, L + 1, 2 * L + 150, 50, 0, ev);
      // (exactly the driver change's 20 s: the car rolling in and the 50 ms samples make it measure a bit less)
      else t = pitLap(tr, id, t, L, id === 'stop' ? PIT_WINDOW.minStopMs : PIT_WINDOW.minStopMs - 5000, ev);
      // the stop lap still counts (the lane runs past the line)
      expect(tr.players.get(id)?.laps).toBe(2);
      drive(tr, id, t, 2 * L + 150, 5 * L + 6, 50, 0, ev);
    }
    expect(ev.filter((e) => e.type === 'served' && e.what === 'stop').map((e) => (e as { playerId: string }).playerId)).toEqual(['stop']);
    const pen = (id: string) => tr.players.get(id)?.penaltyMs;
    expect(pen('stop')).toBe(0);
    expect(pen('short')).toBe(PENALTY.missedStopMs);
    expect(pen('none')).toBe(PENALTY.missedStopMs);
  });
});

describe('pit lane messages', () => {
  it('only count where the lane really is: in / out spam gives no laps', () => {
    const tr = new RaceTracker(track, 0, { raceLaps: 10 });
    tr.addPlayer('a');
    const ev: RaceEvent[] = [];
    const t = drive(tr, 'a', 0, -10, 500, 50, 0, ev);
    for (let k = 0; k < 5; k++) {
      tr.pitIn('a', t + k, ev);
      tr.pitOut('a', 150, t + k, ev);
    }
    expect(tr.players.get('a')?.laps).toBe(0);
    expect(tr.players.get('a')?.pitStops).toBe(0);
  });
});

describe('the end of a race', () => {
  it('gives the others the lap they are on after the winner, a minute at least', () => {
    // 3 laps of 2:17: the rest get ~3 min (a car a pit stop behind still finishes)
    expect(finishGraceMs(411_000, 3)).toBe(178_100);
    expect(finishGraceMs(90_000, 3)).toBe(60_000);
  });
});

describe('drive-through penalties', () => {
  it('is served by driving through the pit lane without stopping, not by a stop', () => {
    const tr = new RaceTracker(track, 0, { raceLaps: 10 });
    tr.addPlayer('a');
    const ev: RaceEvent[] = [];
    let t = drive(tr, 'a', 0, -10, L + 1, 50, 0, ev);
    tr.addDriveThrough('a', 'overtake-fcy', ev);
    expect(ev.some((e) => e.type === 'penalty' && e.driveThrough)).toBe(true);
    expect(tr.standings()[0].driveThroughs).toBe(1);
    // a stop in the box does not serve it
    t = pitLap(tr, 'a', t, L, 10_000, ev);
    expect(tr.players.get('a')?.driveThroughs.length).toBe(1);
    // straight through does (from the last pit exit)
    pitLap(tr, 'a', t, 2 * L, 0, ev, 2 * L + 150);
    expect(tr.players.get('a')?.driveThroughs.length).toBe(0);
    expect(ev.some((e) => e.type === 'served' && e.what === 'drive-through')).toBe(true);
    expect(tr.players.get('a')?.penaltyMs).toBe(0);
  });

  it('becomes time when not served within PENALTY.serveLaps laps, or when given too late to serve', () => {
    const tr = new RaceTracker(track, 0, { raceLaps: 10 });
    tr.addPlayer('a');
    tr.addPlayer('b');
    const ev: RaceEvent[] = [];
    let t = drive(tr, 'a', 0, -10, L + 1, 50, 0, ev);
    tr.addDriveThrough('a', 'blue-flags', ev);
    drive(tr, 'a', t, L + 1, (1 + PENALTY.serveLaps) * L + 6, 50, 0, ev);
    const cost = driveThroughCostMs(track);
    expect(tr.players.get('a')?.penaltyMs).toBe(cost + PENALTY.unservedExtraMs);
    // b gets one with three laps to go: time at once
    t = drive(tr, 'b', 0, -10, 7 * L + 6, 50, 0, ev);
    tr.addDriveThrough('b', 'overtake-sc', ev);
    expect(tr.players.get('b')?.penaltyMs).toBe(cost);
    expect(tr.players.get('b')?.driveThroughs.length).toBe(0);
  });

  it('costs what driving the lane at the limiter loses (Nürburgring-sized lane: ~33 s)', () => {
    expect(driveThroughCostMs({ ...track, pitLaneM: 769.5 })).toBe(33_000);
    expect(driveThroughCostMs({ ...track, pitLaneM: null })).toBe(30_000);
  });
});

describe('race control', () => {
  it('no yellow flag for a car that has not got going (still on the grid, the bots leave it one by one)', () => {
    const tr = new RaceTracker(track, 0, { raceLaps: 10 });
    tr.addPlayer('a');
    tr.addPlayer('b');
    const rc = new RaceControl(tr, true);
    // b sits on the grid for 20 s after the start while a drives off
    let ta = 0;
    let tb = 0;
    while (tb < 20_000) {
      tb = stand(tr, 'b', tb, L - 30, 500);
      ta = drive(tr, 'a', ta, (ta / 1000) * 50 - 10, ((ta + 500) / 1000) * 50 - 10, 50);
      rc.update(Math.max(ta, tb));
    }
    expect(rc.state.yellows).toEqual([]);
    expect(rc.state.course).toBe('green');
  });

  it('yellow flag, then full-course yellow for a car that stays stopped, then green when the track is clear', () => {
    const tr = new RaceTracker(track, 0, { raceLaps: 10 });
    tr.addPlayer('a');
    tr.addPlayer('b');
    const rc = new RaceControl(tr, true);
    // both moving, then b stops at 600 m while a keeps lapping
    let ta = drive(tr, 'a', 0, -10, 300, 50);
    let tb = drive(tr, 'b', 0, -12, 600, 50);
    const step = (until: number) => {
      while (tb < until) {
        tb = stand(tr, 'b', tb, 600, 500);
        ta = drive(tr, 'a', ta, (ta / 1000) * 50 - 10, ((ta + 500) / 1000) * 50 - 10, 50);
        rc.update(Math.max(ta, tb));
      }
    };
    step(tb + RACE_CONTROL.yellowAfterMs + 600);
    expect(rc.state.course).toBe('green');
    expect(rc.state.yellows.length).toBe(1);
    expect(rc.state.yellows[0][0]).toBeCloseTo(600 - RACE_CONTROL.yellowBeforeM, -1);
    step(tb + RACE_CONTROL.fcyAfterMs);
    expect(rc.state.course).toBe('fcy');
    expect(rc.state.limitAt).toBe(rc.state.since + RACE_CONTROL.fcyWarningMs);
    // b drives off: green once the track has been clear for a while and the FCY has run its minimum
    const fcyAt = rc.state.since;
    let t = tb;
    for (let s = 600; t < fcyAt + RACE_CONTROL.fcyMinMs + RACE_CONTROL.clearForMs + 2000; s += 25) {
      t = drive(tr, 'b', t, s, s + 25, 50);
      ta = drive(tr, 'a', ta, (ta / 1000) * 50 - 10, ((ta + 500) / 1000) * 50 - 10, 50);
      rc.update(Math.max(t, ta));
    }
    expect(rc.state.course).toBe('green');
    expect(rc.state.yellows).toEqual([]);
  });

  it('sends the safety car out when two cars are stopped; it joins ahead of the leader', () => {
    const tr = new RaceTracker(track, 0, { raceLaps: 10 });
    for (const id of ['a', 'b', 'c']) tr.addPlayer(id);
    const rc = new RaceControl(tr, true);
    // b and c stop at 400 and 500 m; a drives on to 900 m (all samples on one clock, as the server sees them)
    let t = 0;
    for (; t < 18_000; t += 50) {
      for (const [id, s] of [
        ['a', Math.min(900, -10 + t * 0.05)],
        ['b', Math.min(400, -12 + t * 0.05)],
        ['c', Math.min(500, -14 + t * 0.05)],
      ] as [string, number][]) {
        const [x, y, z] = ovalPos(R, s, 0);
        tr.ingest(id, t, x, y, z, false);
      }
      rc.update(t);
    }
    for (; t < 40_000 && rc.state.course !== 'sc'; t += 500) {
      for (const [id, s] of [
        ['a', 900],
        ['b', 400],
        ['c', 500],
      ] as [string, number][])
        stand(tr, id, t, s, 500);
      rc.update(t + 450);
    }
    // two (then three) cars stopped: the safety car
    expect(rc.state.course).toBe('sc');
    expect(rc.state.sc?.s0).toBeGreaterThan(tr.players.get('a')?.progressS ?? 0);
  });

  it('a pass under the full-course yellow is a drive-through unless the place is given back', () => {
    const tr = new RaceTracker(track, 0, { raceLaps: 10 });
    for (const id of ['a', 'b', 'x']) tr.addPlayer(id);
    const rc = new RaceControl(tr, true);
    rc.state = { ...rc.state, course: 'fcy', since: 0, limitAt: 10_000 };
    const ev: RaceEvent[] = [];
    // from a grid behind the line: b ahead at 22 m/s, a catches it at 30 m/s after 4.4 s and stays ahead; x stays behind
    let t = 0;
    for (let k = 0; k < 800; k++) {
      const sa = -40 + 30 * (t / 1000);
      const sb = -5 + 22 * (t / 1000);
      for (const [id, s] of [
        ['a', sa],
        ['b', sb],
        ['x', -60 + 22 * (t / 1000)],
      ] as [string, number][]) {
        const [x, y, z] = ovalPos(R, s, 0);
        tr.ingest(id, t, x, y, z, false, ev);
      }
      rc.update(t, ev);
      t += 50;
    }
    const dt = ev.filter((e) => e.type === 'penalty' && e.driveThrough) as Extract<RaceEvent, { type: 'penalty' }>[];
    expect(dt.map((e) => [e.playerId, e.reason])).toEqual([['a', 'overtake-fcy']]);
  });
});

describe('safety car path', () => {
  it('goes round at a safety-car pace, deterministically', () => {
    const p = safetyCarPath(track);
    // a 1257 m oval of 200 m radius: limited by the 8 m/s² corner speed (40 m/s), under the 150 km/h cap
    expect(p.lapS).toBeGreaterThan(L / RACE_CONTROL.scMaxSpeed);
    expect(p.lapS).toBeLessThan(L / 35);
    let prev = safetyCarAt(p, 1000, 100, 1000);
    expect(prev).toBeCloseTo(100, 3);
    for (let t = 1100; t < 1000 + p.lapS * 1000 - 200; t += 100) {
      const s = safetyCarAt(p, 1000, 100, t);
      expect((s - prev + L) % L).toBeGreaterThan(0);
      prev = s;
    }
    // back where it started after one lap; reaching a point later in the lap takes the time to it
    expect(safetyCarAt(p, 1000, 100, 1000 + p.lapS * 1000)).toBeCloseTo(100, 0);
    const at = safetyCarReaches(p, 1000, 100, 1000, 600);
    expect(safetyCarAt(p, 1000, 100, at)).toBeCloseTo(600, 0);
  });
});

describe('rules messages', () => {
  it('parses the host rules and bot pit messages strictly', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'setRules', rules: { contact: true, fuel: false } }))).toEqual({
      t: 'setRules',
      rules: { contact: true, fuel: false },
    });
    expect(parseClientMsg(JSON.stringify({ t: 'setRules', rules: { contact: 'yes' } }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'setRules', rules: { nitro: true } }))).toEqual({ t: 'setRules', rules: {} });
    expect(parseClientMsg(JSON.stringify({ t: 'pit', in: true, id: 'botabc' }))).toEqual({ t: 'pit', in: true, id: 'botabc' });
    expect(parseClientMsg(JSON.stringify({ t: 'pit', in: true }))).toEqual({ t: 'pit', in: true });
    expect(parseClientMsg(JSON.stringify({ t: 'pit', in: true, id: 5 }))).toBeNull();
  });
});

describe('timed race (GT3 style)', () => {
  /** Cars driving at the same time at their own speeds (m/s), from just behind the line, a sample every 50 ms. */
  function run(tr: RaceTracker, speeds: Record<string, number>, untilMs: number, ev: RaceEvent[]): void {
    const s: Record<string, number> = {};
    for (const id of Object.keys(speeds)) s[id] = -10;
    for (let t = 0; t <= untilMs; t += 50)
      for (const [id, v] of Object.entries(speeds)) {
        const [x, y, z] = ovalPos(R, s[id]);
        tr.ingest(id, t, x, y, z, false, ev);
        s[id] += v * 0.05;
      }
  }

  it('flags the leader on the first crossing after the time is up; the others finish the lap they are on', () => {
    const tr = new RaceTracker(track, 0, { raceMs: 110_000 });
    tr.addPlayer('fast');
    tr.addPlayer('slow');
    const ev: RaceEvent[] = [];
    // laps of 25.1 s and 27.9 s: the slow car crosses at 111.9 s, after the time is up but not leading, so it goes
    // on; the leader crosses at 125.9 s and gets the flag; the slow car's next crossing (139.8 s) ends its race
    run(tr, { fast: 50, slow: 45 }, 200_000, ev);
    const fast = tr.players.get('fast');
    const slow = tr.players.get('slow');
    expect(fast?.finishedMs).toBeGreaterThan(125_000);
    expect(fast?.finishedMs).toBeLessThan(127_000);
    expect(fast?.laps).toBe(5);
    expect(slow?.laps).toBe(5);
    expect(slow?.finishedMs).toBeGreaterThan(139_000);
    expect(tr.standings().map((x) => x.id)).toEqual(['fast', 'slow']);
  });

  it('counts the mandatory stop only when the pit entry is crossed inside the window (25–35 min of 60)', () => {
    const tr = new RaceTracker(track, 0, { raceMs: 12 * 60_000, pitWindow: true });
    expect(tr.pitWindowMs).toEqual({ open: 300_000, close: 420_000 });
    tr.addPlayer('early');
    tr.addPlayer('inside');
    const ev: RaceEvent[] = [];
    for (const [id, pitAt] of [
      ['early', 4],
      ['inside', 13],
    ] as const) {
      // laps of 25 s at 50 m/s: lap 4 starts at ~75 s (too early), lap 13 at ~300 s (in the window)
      let t = drive(tr, id, 0, -10, (pitAt - 1) * L + 1, 50, 0, ev);
      t = pitLap(tr, id, t, (pitAt - 1) * L, PIT_WINDOW.minStopMs, ev);
      expect(tr.players.get(id)?.pitInMs).toBeGreaterThan(0);
    }
    expect(ev.filter((e) => e.type === 'served' && e.what === 'stop').map((e) => (e as { playerId: string }).playerId)).toEqual(['inside']);
  });

  it('is a timed race message the server accepts', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'setRaceMinutes', minutes: 30 }))).toEqual({ t: 'setRaceMinutes', minutes: 30 });
    expect(parseClientMsg(JSON.stringify({ t: 'setPractice', minutes: 20 }))).toEqual({ t: 'setPractice', minutes: 20 });
    expect(parseClientMsg(JSON.stringify({ t: 'setRaceMinutes', minutes: 7 }))).toBeNull();
  });
});
