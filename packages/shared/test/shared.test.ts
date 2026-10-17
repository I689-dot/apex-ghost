import { describe, expect, it } from 'vitest';
import {
  BIN_SERVER_RELAY,
  CLIENT_HEADER,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  STATE_BYTES,
  RaceTracker,
  type RaceEvent,
  decodeClientStates,
  decodeRelay,
  encodeClientStates,
  estimateOffset,
  generateRoomCode,
  makeCarState,
  makeRelayPacket,
  makeSample,
  mulberry32,
  normalizeRoomCode,
  packQuat,
  parseClientMsg,
  planWeather,
  sanitizeNickname,
  unpackQuat,
  validateClientPacket,
  weatherAt,
} from '../src';
import { ovalPos, ovalTrack } from './helpers';

describe('protocol: binary car state', () => {
  const sample = () => {
    const s = makeCarState();
    s.t = 1_734_000_123_456;
    s.px = 1234.567;
    s.py = -12.345;
    s.pz = -987.654;
    const q = { x: 0.1, y: 0.7, z: -0.2, w: 0.6 };
    const n = Math.hypot(q.x, q.y, q.z, q.w);
    s.qx = q.x / n;
    s.qy = q.y / n;
    s.qz = q.z / n;
    s.qw = q.w / n;
    s.vx = 65.43;
    s.vy = -1.2;
    s.vz = 12.01;
    s.wx = 0.12;
    s.wy = -1.5;
    s.wz = 0.004;
    s.steer = 0.31;
    s.rotF = 2.5;
    s.rotR = 5.9;
    s.susp = [0.02, 0.05, 0.1, 0.0];
    s.flags = 0b1011;
    return s;
  };

  it('round-trips through client encode/decode with bounded quantisation error', () => {
    const a = sample();
    const b = sample();
    b.t += 50;
    b.px += 3;
    const buf = new ArrayBuffer(CLIENT_HEADER + STATE_BYTES * 4);
    const len = encodeClientStates(buf, 777, [a, b], 2);
    expect(len).toBe(CLIENT_HEADER + 2 * STATE_BYTES);
    const out = [makeCarState(), makeCarState()];
    const dec = decodeClientStates(buf.slice(0, len), out, a.t + 20);
    expect(dec?.count).toBe(2);
    expect(dec?.seq).toBe(777);
    const r = out[0];
    expect(r.t).toBe(a.t);
    expect(out[1].t).toBe(b.t);
    expect(Math.abs(r.px - a.px)).toBeLessThan(0.001);
    expect(Math.abs(r.py - a.py)).toBeLessThan(0.001);
    expect(Math.abs(r.pz - a.pz)).toBeLessThan(0.001);
    expect(Math.abs(r.vx - a.vx)).toBeLessThan(0.006);
    expect(Math.abs(r.wy - a.wy)).toBeLessThan(0.001);
    expect(Math.abs(r.steer - a.steer)).toBeLessThan(0.006);
    expect(Math.abs(r.rotR - a.rotR)).toBeLessThan(0.03);
    expect(Math.abs(r.susp[2] - a.susp[2])).toBeLessThan(0.001);
    expect(r.flags).toBe(a.flags);
    // quaternion: same rotation (q or −q)
    const dot = Math.abs(r.qx * a.qx + r.qy * a.qy + r.qz * a.qz + r.qw * a.qw);
    expect(dot).toBeGreaterThan(0.99999);
  });

  it('compresses quaternions with smallest-three in 32 bits', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      let q = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const n = Math.hypot(...q);
      q = q.map((v) => v / n);
      const p = packQuat(q[0], q[1], q[2], q[3]);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(2 ** 32);
      const o = { qx: 0, qy: 0, qz: 0, qw: 0 };
      unpackQuat(p, o);
      const dot = Math.abs(o.qx * q[0] + o.qy * q[1] + o.qz * q[2] + o.qw * q[3]);
      expect(dot).toBeGreaterThan(0.9999);
    }
  });

  it('wraps for relay and rejects malformed packets', () => {
    const a = sample();
    const buf = new ArrayBuffer(CLIENT_HEADER + STATE_BYTES);
    encodeClientStates(buf, 9, [a], 1);
    expect(validateClientPacket(buf)).toBe(1);
    expect(validateClientPacket(buf.slice(0, 10))).toBe(-1);
    const bad = buf.slice(0);
    new DataView(bad).setUint8(1, 3); // claims 3 samples
    expect(validateClientPacket(bad)).toBe(-1);
    const relay = makeRelayPacket(buf, 7);
    expect(new Uint8Array(relay)[0]).toBe(BIN_SERVER_RELAY);
    const out = [makeCarState()];
    const dec = decodeRelay(relay, out, a.t);
    expect(dec).toEqual({ seq: 9, count: 1, slot: 7 });
    expect(Math.abs(out[0].px - a.px)).toBeLessThan(0.001);
  });

  it('validates untrusted JSON messages strictly', () => {
    expect(parseClientMsg('{"t":"ready","ready":true}')).toEqual({ t: 'ready', ready: true });
    expect(parseClientMsg('{"t":"ready","ready":"yes"}')).toBeNull();
    expect(parseClientMsg('{"t":"selectCar","carId":null}')).toEqual({ t: 'selectCar', carId: null });
    expect(parseClientMsg('{"t":"selectCar","carId":5}')).toBeNull();
    expect(parseClientMsg('{"t":"damage","zones":[0,0,0,0,0,2]}')).toBeNull();
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg('{"t":"hack"}')).toBeNull();
    expect(parseClientMsg(`{"t":"hello","v":3,"nick":"${'x'.repeat(5000)}","session":null}`)).toBeNull();
  });
});

describe('room codes', () => {
  it('generates 5-character codes from the unambiguous alphabet', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 2000; i++) {
      const c = generateRoomCode(rand);
      expect(c).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of c) expect(ROOM_CODE_ALPHABET).toContain(ch);
      expect(c).not.toMatch(/[01OIL]/);
    }
  });
  it('normalises user input', () => {
    expect(normalizeRoomCode(' ab-c d e ')).toBe('ABCDE');
    expect(normalizeRoomCode('abcd')).toBeNull();
    expect(normalizeRoomCode('ABCD0')).toBeNull(); // zero is not in the alphabet
    expect(normalizeRoomCode('ABCDO')).toBeNull(); // letter O neither
  });
});

describe('nicknames', () => {
  it('trims, collapses whitespace and enforces 2-16 characters', () => {
    expect(sanitizeNickname('  Max   Power ')).toEqual({ ok: true, nick: 'Max Power' });
    expect(sanitizeNickname('a').ok).toBe(false);
    expect(sanitizeNickname('x'.repeat(17)).ok).toBe(false);
    expect(sanitizeNickname('x'.repeat(16)).ok).toBe(true);
    expect(sanitizeNickname(42).ok).toBe(false);
  });
  it('strips markup and invisible characters', () => {
    expect(sanitizeNickname('<b>Ana</b>')).toEqual({ ok: true, nick: 'bAna/b' });
    expect(sanitizeNickname('Jo​se\u0007')).toEqual({ ok: true, nick: 'Jose' });
    expect(sanitizeNickname('‮abc').ok).toBe(true);
    expect((sanitizeNickname('‮abc') as { nick: string }).nick).toBe('abc');
  });
});

describe('clock sync', () => {
  it('computes offset and rtt from one exchange', () => {
    // client sends at 1000, server (ahead by 5000) answers at 6060, client receives at 1100
    expect(makeSample(1000, 6060, 1100)).toEqual({ offset: 5010, rtt: 100 });
  });
  it('uses the median of the lowest-rtt half (robust to queueing spikes)', () => {
    const samples = [
      makeSample(0, 5050, 100), // rtt 100, offset 5000
      makeSample(0, 5025, 50), // rtt 50, offset 5000
      makeSample(0, 5410, 900), // rtt 900 (spike), offset 4960
      makeSample(0, 5031, 60), // rtt 60, offset 5001
      makeSample(0, 6000, 400), // rtt 400, offset 5800 (asymmetric)
      makeSample(0, 5029, 55), // rtt 55, offset 5001.5
    ];
    const est = estimateOffset(samples);
    expect(est.offset).toBeCloseTo(5001, 0);
    expect(est.rtt).toBeLessThanOrEqual(60);
  });
  it('handles empty input', () => {
    expect(estimateOffset([])).toEqual({ offset: 0, rtt: 0 });
  });
});

describe('weather', () => {
  it('is fully determined by the seed', () => {
    for (const seed of [1, 42, 123456789, 0xffffffff]) {
      expect(planWeather(seed)).toEqual(planWeather(seed));
      for (const t of [0, 30.5, 200, 600]) expect(weatherAt(planWeather(seed), t)).toEqual(weatherAt(planWeather(seed), t));
    }
  });
  it('produces varied conditions and times across seeds', () => {
    const kinds = new Set<string>();
    const hours = new Set<number>();
    for (let s = 0; s < 400; s++) {
      const p = planWeather(s * 7919);
      kinds.add(p.kind);
      hours.add(Math.floor(p.startHour));
      expect(p.startHour).toBeGreaterThanOrEqual(5.5);
      expect(p.startHour).toBeLessThanOrEqual(23.5);
    }
    expect(kinds.size).toBe(6);
    expect(hours.size).toBeGreaterThan(14);
  });
  it('rain reduces grip, dry track keeps full grip', () => {
    let wet: number | null = null;
    let dry: number | null = null;
    for (let s = 0; s < 500 && (wet === null || dry === null); s++) {
      const p = planWeather(s);
      if (p.kind === 'heavy_rain' && !p.change) wet = weatherAt(p, 60).grip;
      if (p.kind === 'clear' && !p.change) dry = weatherAt(p, 60).grip;
    }
    expect(dry).toBe(1);
    expect(wet).toBeLessThan(0.75);
  });
});

describe('host-chosen conditions', () => {
  it('honours the weather, time and change choices, and stays deterministic', () => {
    for (let seed = 1; seed < 40; seed++) {
      const p = planWeather(seed, { weather: 'heavy_rain', time: 'night', changes: 'off' });
      expect(p.kind).toBe('heavy_rain');
      expect(p.startHour).toBe(22.5);
      expect(p.change).toBeNull();
      expect(p.initialWetness).toBeGreaterThan(0.9);
      expect(planWeather(seed, { changes: 'on' }).change).not.toBeNull();
      expect(planWeather(seed, { weather: 'heavy_rain', time: 'night', changes: 'off' })).toEqual(p);
    }
    // 'random' everywhere equals the old behaviour
    expect(planWeather(7, { weather: 'random', time: 'random', changes: 'random' })).toEqual(planWeather(7));
  });
});

describe('race logic (server-authoritative laps)', () => {
  const R = 200;
  const L = 2 * Math.PI * R;
  const drive = (
    tr: RaceTracker,
    id: string,
    t0: number,
    fromS: number,
    toS: number,
    speed: number,
    lateral = 0,
    step = 50,
    out: RaceEvent[] = [],
    offTrack: [number, number] | null = null,
  ) => {
    let t = t0;
    for (let s = fromS; s <= toS; s += (speed * step) / 1000) {
      const [x, y, z] = ovalPos(R, s, lateral);
      tr.ingest(id, t, x, y, z, false, out, offTrack !== null && s >= offTrack[0] && s <= offTrack[1]);
      t += step;
    }
    return t;
  };

  it('counts a lap only after all gates in order, with correct lap time', () => {
    const track = ovalTrack(R, 12);
    const tr = new RaceTracker(track, 0, 3);
    tr.addPlayer('a');
    // start just behind the line (grid behind gate 0)
    const t = drive(tr, 'a', 0, -20, 0.5, 50);
    expect(tr.players.get('a')?.laps).toBe(0);
    drive(tr, 'a', t, 0.5, L + 6, 50);
    const p = tr.players.get('a');
    expect(p?.laps).toBe(1);
    // lap time ≈ (L + 20 m) / 50 m/s since the clock starts at the signal
    expect(p?.lastLapMs).toBeGreaterThan(((L + 20) / 50) * 1000 - 120);
    expect(p?.lastLapMs).toBeLessThan(((L + 20) / 50) * 1000 + 120);
  });

  it('rejects shortcuts: skipping a checkpoint means no lap', () => {
    const track = ovalTrack(R, 12);
    const tr = new RaceTracker(track, 0, 3);
    tr.addPlayer('cheat');
    let t = drive(tr, 'cheat', 0, -10, 0.5, 50);
    // drive half a lap, then cut far inside the track past gates 6..8, then continue
    t = drive(tr, 'cheat', t, 0.5, L * 0.45, 50);
    t = drive(tr, 'cheat', t, L * 0.45, L * 0.72, 50, 60); // 60 m inside: outside the gates' width
    drive(tr, 'cheat', t, L * 0.72, L + 8, 50);
    expect(tr.players.get('cheat')?.laps).toBe(0);
  });

  it('gives no gate credit for teleports and flags them', () => {
    const track = ovalTrack(R, 12);
    const tr = new RaceTracker(track, 0, 3);
    tr.addPlayer('tp');
    const t = drive(tr, 'tp', 0, -10, 1, 50);
    // jump 0.9 of a lap ahead in 50 ms (≈120 m straight-line): rejected, no gate credit
    const [x, y, z] = ovalPos(R, L * 0.9);
    const ev = tr.ingest('tp', t + 50, x, y, z, false);
    expect(ev.some((e) => e.type === 'rejected' && e.reason === 'implausible-speed')).toBe(true);
    // then drive legitimately across the line: still no lap, gates 1..10 were never crossed
    drive(tr, 'tp', t + 100, L * 0.9, L + 6, 50);
    expect(tr.players.get('tp')?.laps).toBe(0);
  });

  it('flags impossible lap times', () => {
    const track = { ...ovalTrack(R, 12), minLapMs: 60_000 };
    const tr = new RaceTracker(track, 0, 3);
    tr.addPlayer('fast');
    let t = drive(tr, 'fast', 0, -10, 0.5, 100);
    const events: string[] = [];
    for (let s = 0.5; s <= L + 6; s += 5) {
      const [x, y, z] = ovalPos(R, s);
      for (const e of tr.ingest('fast', t, x, y, z, false)) events.push(e.type === 'rejected' ? e.reason : e.type);
      t += 50;
    }
    expect(events).toContain('lap-too-fast');
  });

  it('qualifying format: the out lap never counts and the best valid lap decides the order', () => {
    const track = ovalTrack(R, 12);
    const tr = new RaceTracker(track, 0, 2);
    for (const id of ['a', 'b', 'c']) tr.addPlayer(id);
    const evA: RaceEvent[] = [];
    // a: slow out lap, then a steady lap and a fast one
    let t = drive(tr, 'a', 0, -10, L + 1, 40, 0, 50, evA);
    t = drive(tr, 'a', t, L + 1, 2 * L + 1, 50, 0, 50, evA);
    drive(tr, 'a', t, 2 * L + 1, 3 * L + 8, 62, 0, 50, evA);
    // b: a very fast out lap (from the front of the grid), then two medium laps; finishes first on the clock
    t = drive(tr, 'b', 0, -10, L + 1, 90);
    drive(tr, 'b', t, L + 1, 3 * L + 8, 56);
    // c: only the out lap
    drive(tr, 'c', 0, -10, L + 6, 50);
    const laps = evA.filter((e) => e.type === 'lap');
    expect(laps).toHaveLength(3);
    expect(laps[0]).toMatchObject({ outLap: true, valid: false, best: false });
    expect(laps[2]).toMatchObject({ outLap: false, valid: true, best: true });
    const st = tr.standings();
    expect(st.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(st[0].bestLapMs).toBeLessThan(st[1].bestLapMs as number);
    expect(st[1].gapMs).toBeGreaterThan(0);
    expect(st[0].finishedMs).not.toBeNull();
    expect(st[1].finishedMs as number).toBeLessThan(st[0].finishedMs as number);
    expect(st[2].bestLapMs).toBeNull();
    expect(st.map((s) => s.position)).toEqual([1, 2, 3]);
  });

  it('track limits and resets invalidate the current lap', () => {
    const track = ovalTrack(R, 12);
    const tr = new RaceTracker(track, 0, 3);
    tr.addPlayer('x');
    const ev: RaceEvent[] = [];
    let t = drive(tr, 'x', 0, -10, L + 1, 50, 0, 50, ev);
    // timed lap 1: all four wheels off for a moment mid-lap
    t = drive(tr, 'x', t, L + 1, 2 * L + 6, 60, 0, 50, ev, [L + 400, L + 410]);
    expect(ev.some((e) => e.type === 'invalid' && e.reason === 'track-limits')).toBe(true);
    let laps = ev.filter((e) => e.type === 'lap');
    expect(laps[1]).toMatchObject({ valid: false, best: false });
    expect(tr.players.get('x')?.bestLapMs).toBeNull();
    // timed lap 2: clean, slower, but it is the only valid one
    t = drive(tr, 'x', t, 2 * L + 6, 3 * L + 6, 50, 0, 50, ev);
    laps = ev.filter((e) => e.type === 'lap');
    expect(laps[2]).toMatchObject({ valid: true, best: true });
    // a reset invalidates the lap in progress
    t = drive(tr, 'x', t, 3 * L + 6, 3 * L + 400, 50, 0, 50, ev);
    const g = track.gates[(tr.players.get('x')?.nextGate ?? 1) - 1];
    tr.ingest('x', t + 50, g.p[0], g.p[1], g.p[2], true, ev);
    expect(ev.some((e) => e.type === 'invalid' && e.reason === 'reset')).toBe(true);
    expect(tr.players.get('x')?.lapInvalid).toBe(true);
  });

  it('orders cars on the same lap by distance along the track', () => {
    const track = ovalTrack(R, 12);
    const tr = new RaceTracker(track, 0, 3);
    for (const id of ['a', 'b', 'c']) tr.addPlayer(id);
    drive(tr, 'a', 0, -10, 300, 50);
    drive(tr, 'b', 0, -10, 500, 50);
    drive(tr, 'c', 0, -10, 120, 50);
    expect(tr.standings().map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('timed session: laps until the chequered flag, the lap in progress at the flag still counts', () => {
    const track = ovalTrack(R, 12);
    const lapS = (L / 50) * 1000; // one lap at 50 m/s
    const tr = new RaceTracker(track, 0, { sessionMs: 2.5 * lapS });
    tr.addPlayer('q');
    const ev: RaceEvent[] = [];
    // out lap, then laps at 50 m/s: the flag falls during the 3rd lap, which still counts; then the session ends
    let t = drive(tr, 'q', 0, -10, L + 1, 50, 0, 50, ev);
    t = drive(tr, 'q', t, L + 1, 4 * L + 8, 50, 0, 50, ev);
    expect(tr.checkFlag(t, ev).some((e) => e.type === 'flag')).toBe(true);
    const laps = ev.filter((e) => e.type === 'lap');
    expect(laps.length).toBeGreaterThanOrEqual(3);
    expect(laps.some((e) => e.type === 'lap' && e.valid && (e as { lapMs: number }).lapMs > 2 * lapS)).toBe(false);
    expect(ev.some((e) => e.type === 'finish')).toBe(true);
    // nothing after the finish
    const n = ev.length;
    drive(tr, 'q', t, 4 * L + 8, 5 * L + 8, 50, 0, 50, ev);
    expect(ev.length).toBe(n);
  });

  it('pit stop: gates are ignored in the pit lane, the lap after the exit is an out lap', () => {
    const track = { ...ovalTrack(R, 12), pitExitS: 150 };
    const tr = new RaceTracker(track, 0, { sessionMs: 3_600_000 });
    tr.addPlayer('p');
    const ev: RaceEvent[] = [];
    let t = drive(tr, 'p', 0, -10, L + 1, 50, 0, 50, ev); // out lap
    t = drive(tr, 'p', t, L + 1, 2 * L - 60, 50, 0, 50, ev); // most of a timed lap
    tr.pitIn('p', t, ev);
    expect(tr.players.get('p')?.lapInvalid).toBe(true);
    // the pit lane runs 25 m inside the circuit past the line to the exit: no gate credit, no lap
    const lapsBefore = tr.players.get('p')?.laps;
    t = drive(tr, 'p', t, 2 * L - 60, 2 * L + 150, 15, -25, 50, ev);
    expect(tr.players.get('p')?.laps).toBe(lapsBefore);
    tr.pitOut('p', 150);
    // back on track: the next completed lap is an out lap, the one after is timed again
    ev.length = 0;
    t = drive(tr, 'p', t, 2 * L + 150, 3 * L + 6, 50, 0, 50, ev);
    t = drive(tr, 'p', t, 3 * L + 6, 4 * L + 6, 50, 0, 50, ev);
    const laps = ev.filter((e) => e.type === 'lap') as Extract<RaceEvent, { type: 'lap' }>[];
    expect(laps[0]).toMatchObject({ outLap: true, valid: false });
    expect(laps[1]).toMatchObject({ outLap: false, valid: true });
    expect(tr.players.get('p')?.pitStops).toBe(1);
  });

  it('only accepts resets near the last checkpoint', () => {
    const track = ovalTrack(R, 12);
    const tr = new RaceTracker(track, 0, 3);
    tr.addPlayer('r');
    const t = drive(tr, 'r', 0, -10, 400, 50);
    const g = track.gates[(tr.players.get('r')?.nextGate ?? 1) - 1];
    tr.ingest('r', t + 50, g.p[0], g.p[1], g.p[2], true);
    expect(tr.players.get('r')?.resets).toBe(1);
    const far = ovalPos(R, 900);
    const ev = tr.ingest('r', t + 300, far[0], far[1], far[2], true);
    expect(ev.some((e) => e.type === 'rejected' && e.reason === 'reset-far-from-checkpoint')).toBe(true);
  });
});
