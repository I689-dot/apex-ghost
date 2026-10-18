import { describe, expect, it } from 'vitest';
import { BRIEFING_MS, PROTOCOL_VERSION, RECONNECT_GRACE_MS, mulberry32, type ServerMsg } from '@apex/shared';
import { RoomCore, type Conn, type PersistedRoom } from '../src/room';
import { ovalTrack } from '../../../packages/shared/test/helpers';

class FakeConn implements Conn {
  inbox: ServerMsg[] = [];
  closed: { code: number; reason: string } | null = null;
  constructor(readonly id: string) {}
  send(d: string | ArrayBuffer): void {
    if (typeof d === 'string') this.inbox.push(JSON.parse(d) as ServerMsg);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].t === t) return this.inbox[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
}

function makeRoom(cars = ['car_a', 'car_b', 'car_c'], autoBrief = true) {
  let now = 1_000_000;
  const persisted: PersistedRoom[] = [];
  const rand = mulberry32(99);
  const room = new RoomCore({
    now: () => now,
    random: rand,
    schedule: () => {},
    persist: (s) => persisted.push(structuredClone(s)),
    track: ovalTrack(),
    carIds: new Set(cars),
  });
  room.init('ABCDE');
  let n = 0;
  const conns: Conn[] = [];
  const join = (nick: string, session: string | null = null) => {
    const c = new FakeConn(`c${n++}`);
    conns.push(c);
    room.onMessage(c, JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, nick, session }));
    const w = c.last('welcome');
    return { conn: c, id: w?.you ?? '', session: w?.session ?? '' };
  };
  // most tests are about what comes after the briefing: everyone finishes it at once
  const send = (c: Conn, msg: object) => {
    room.onMessage(c, JSON.stringify(msg));
    if (autoBrief && (msg as { t: string }).t === 'start' && room.phase === 'briefing')
      for (const x of conns) room.onMessage(x, JSON.stringify({ t: 'briefed' }));
  };
  return { room, join, send, advance: (ms: number) => (now += ms), persisted };
}

describe('car lock (atomic, server-side)', () => {
  it('never gives the same car to two players, even when requests arrive back to back', () => {
    const { room, join, send } = makeRoom();
    const a = join('Ana');
    const b = join('Ben');
    // both "click" at the same moment: the room processes them one at a time
    send(a.conn, { t: 'selectCar', carId: 'car_a' });
    send(b.conn, { t: 'selectCar', carId: 'car_a' });
    expect(a.conn.last('carLock')).toMatchObject({ ok: true, carId: 'car_a' });
    expect(b.conn.last('carLock')).toMatchObject({ ok: false, carId: 'car_a', owner: a.id });
    expect(room.carLocks.get('car_a')).toBe(a.id);
    const owners = [...room.players.values()].filter((p) => p.carId === 'car_a');
    expect(owners).toHaveLength(1);
  });

  it('stays exclusive under many concurrent (shuffled, async) requests', async () => {
    for (let trial = 0; trial < 50; trial++) {
      const { room, join, send } = makeRoom(['x', 'y']);
      const players = Array.from({ length: 12 }, (_, i) => join(`P${i}`));
      const rand = mulberry32(trial + 1);
      const reqs = players.flatMap((p) => [
        () => send(p.conn, { t: 'selectCar', carId: rand() < 0.5 ? 'x' : 'y' }),
        () => send(p.conn, { t: 'selectCar', carId: rand() < 0.5 ? 'x' : 'y' }),
      ]);
      // deliver in random order with random microtask delays
      await Promise.all(reqs.map((r) => new Promise<void>((res) => setTimeout(() => (r(), res()), Math.floor(rand() * 5)))));
      for (const car of ['x', 'y']) {
        const holders = [...room.players.values()].filter((p) => p.carId === car);
        expect(holders.length).toBeLessThanOrEqual(1);
        if (holders.length) expect(room.carLocks.get(car)).toBe(holders[0].id);
      }
      // locks map is consistent with players
      for (const [car, pid] of room.carLocks) expect(room.players.get(pid)?.carId).toBe(car);
    }
  });

  it('releases the previous lock when changing car, and on disconnect timeout', () => {
    const { room, join, send, advance } = makeRoom();
    const a = join('Ana');
    const b = join('Ben');
    send(a.conn, { t: 'selectCar', carId: 'car_a' });
    send(a.conn, { t: 'selectCar', carId: 'car_b' });
    expect(room.carLocks.has('car_a')).toBe(false);
    send(b.conn, { t: 'selectCar', carId: 'car_a' });
    expect(b.conn.last('carLock')?.ok).toBe(true);
    // Ana disconnects: lock is kept during the grace period, released after
    room.onClose(a.conn);
    expect(room.carLocks.get('car_b')).toBe(a.id);
    advance(RECONNECT_GRACE_MS + 1);
    room.tick();
    expect(room.carLocks.has('car_b')).toBe(false);
    expect(room.players.has(a.id)).toBe(false);
  });

  it('rejects unknown car ids', () => {
    const { join, send } = makeRoom();
    const a = join('Ana');
    send(a.conn, { t: 'selectCar', carId: 'nope' });
    expect(a.conn.last('carLock')?.ok).toBe(false);
  });
});

describe('room membership', () => {
  it('enforces unique nicknames (case-insensitive) and the 12-player limit', () => {
    const { join } = makeRoom();
    join('Speedy');
    const dup = join('speedy');
    expect(dup.conn.last('error')).toMatchObject({ code: 'nick_taken', fatal: true });
    for (let i = 0; i < 11; i++) join(`Driver${i}`);
    const late = join('Thirteen');
    expect(late.conn.last('error')).toMatchObject({ code: 'room_full' });
  });

  it('transfers host when the host leaves', () => {
    const { room, join, send } = makeRoom();
    const a = join('Ana');
    const b = join('Ben');
    expect(room.hostId).toBe(a.id);
    send(a.conn, { t: 'leave' });
    expect(room.hostId).toBe(b.id);
    expect(b.conn.last('room')?.room.players.find((p) => p.id === b.id)?.host).toBe(true);
  });

  it('reconnects with the session token and keeps the car', () => {
    const { room, join, send } = makeRoom();
    const a = join('Ana');
    send(a.conn, { t: 'selectCar', carId: 'car_c' });
    room.onClose(a.conn);
    const again = join('whatever', a.session);
    expect(again.id).toBe(a.id);
    expect(room.players.get(a.id)?.carId).toBe('car_c');
    expect(room.players.get(a.id)?.conn).not.toBeNull();
  });

  it('only the host can start, and only when everyone is ready', () => {
    const { room, join, send } = makeRoom();
    const a = join('Ana');
    const b = join('Ben');
    send(a.conn, { t: 'selectCar', carId: 'car_a' });
    send(a.conn, { t: 'ready', ready: true });
    send(a.conn, { t: 'start' });
    expect(room.phase).toBe('lobby');
    expect(a.conn.last('error')?.code).toBe('not_ready');
    send(b.conn, { t: 'selectCar', carId: 'car_b' });
    send(b.conn, { t: 'ready', ready: true });
    send(b.conn, { t: 'start' });
    expect(room.phase).toBe('lobby');
    send(a.conn, { t: 'start' });
    expect(room.phase).toBe('loading');
    const setup = b.conn.last('raceSetup')?.race;
    expect(setup?.grid.sort()).toEqual([a.id, b.id].sort());
    expect(setup?.weather).toBeDefined();
  });

  it('briefing: the start reveals the final conditions; the session loads when all are briefed or time is up', () => {
    const { room, join, send, advance } = makeRoom(['car_a', 'car_b', 'car_c'], false);
    const a = join('Ana');
    const b = join('Ben');
    for (const [p, car] of [
      [a, 'car_a'],
      [b, 'car_b'],
    ] as const) {
      send(p.conn, { t: 'selectCar', carId: car });
      send(p.conn, { t: 'ready', ready: true });
    }
    send(a.conn, { t: 'start' });
    expect(room.phase).toBe('briefing');
    expect(b.conn.last('room')?.room.briefingUntil).toBeGreaterThan(0);
    // conditions are locked, tyres can still be chosen
    send(a.conn, { t: 'setConditions', weather: 'heavy_rain' });
    expect(b.conn.last('room')?.room.conditions.weather).not.toBe('heavy_rain');
    send(b.conn, { t: 'setTyre', tyre: 'soft' });
    expect(b.conn.last('room')?.room.players.find((p) => p.id === b.id)?.tyre).toBe('soft');
    send(a.conn, { t: 'briefed' });
    expect(room.phase).toBe('briefing');
    send(b.conn, { t: 'briefed' });
    expect(room.phase).toBe('loading');
    expect(b.conn.last('raceSetup')?.race.grid.sort()).toEqual([a.id, b.id].sort());
    // a second start where nobody confirms: the timer launches it
    const r2 = makeRoom(['car_a'], false);
    const c = r2.join('Cid');
    r2.send(c.conn, { t: 'selectCar', carId: 'car_a' });
    r2.send(c.conn, { t: 'ready', ready: true });
    r2.send(c.conn, { t: 'start' });
    expect(r2.room.phase).toBe('briefing');
    r2.advance(BRIEFING_MS + 10);
    r2.room.tick();
    expect(r2.room.phase).toBe('loading');
    void advance;
  });

  it('late joiners wait in the lobby during a race', () => {
    const { room, join, send } = makeRoom();
    const a = join('Ana');
    send(a.conn, { t: 'selectCar', carId: 'car_a' });
    send(a.conn, { t: 'ready', ready: true });
    send(a.conn, { t: 'start' });
    const late = join('Late');
    expect(room.players.get(late.id)?.waiting).toBe(true);
    expect(late.conn.last('welcome')?.race).toBeNull();
  });
});

describe('race state packets', () => {
  it('accepts ordered backfill after a reconnect but rejects future timestamps', async () => {
    const { CLIENT_HEADER, STATE_BYTES, encodeClientStates, makeCarState } = await import('@apex/shared');
    const { ovalPos } = await import('../../../packages/shared/test/helpers');
    const { room, join, send, advance } = makeRoom();
    const a = join('Ana');
    send(a.conn, { t: 'selectCar', carId: 'car_a' });
    send(a.conn, { t: 'ready', ready: true });
    send(a.conn, { t: 'start' });
    send(a.conn, { t: 'loaded', raceId: room.raceId });
    const startAt = room.startAt as number;
    advance(startAt - 1_000_000 + 20_000); // 20 s into the race (now = 1_000_000 + …)
    const now = startAt + 15_000;
    const buf = new ArrayBuffer(CLIENT_HEADER + STATE_BYTES * 2);
    const s1 = makeCarState();
    const s2 = makeCarState();
    // samples from 5 s ago (sent while offline), in order
    for (let k = 0; k < 40; k++) {
      const t = now - 5000 + k * 100;
      const [x1, , z1] = ovalPos(200, k * 5 - 10);
      const [x2, , z2] = ovalPos(200, k * 5 - 7.5);
      Object.assign(s1, { t, px: x1, pz: z1 });
      Object.assign(s2, { t: t + 50, px: x2, pz: z2 });
      const len = encodeClientStates(buf, k, [s1, s2], 2);
      room.onMessage(a.conn, buf.slice(0, len));
    }
    const p = room.tracker?.players.get(a.id);
    expect(p?.raceDist).toBeGreaterThan(150);
    // a sample from the future is ignored
    const before = p?.raceDist;
    const [fx, , fz] = ovalPos(200, 400);
    Object.assign(s1, { t: Date.now() + 1e9, px: fx, pz: fz });
    const len = encodeClientStates(buf, 99, [s1], 1);
    room.onMessage(a.conn, buf.slice(0, len));
    expect(room.tracker?.players.get(a.id)?.raceDist).toBe(before);
  });
});

describe('bots', () => {
  it('only the host adds and removes bots; they take a free car and are ready', () => {
    const { room, join, send } = makeRoom();
    const a = join('Ana');
    const b = join('Ben');
    send(b.conn, { t: 'addBot' });
    expect([...room.players.values()].some((p) => p.bot)).toBe(false);
    send(a.conn, { t: 'selectCar', carId: 'car_a' });
    send(a.conn, { t: 'addBot' });
    const bot = [...room.players.values()].find((p) => p.bot);
    expect(bot).toBeDefined();
    expect(bot?.ready).toBe(true);
    expect(bot?.carId).not.toBe('car_a');
    expect(room.carLocks.get(bot?.carId as string)).toBe(bot?.id);
    const snap = b.conn.last('room')?.room.players.find((p) => p.id === bot?.id);
    expect(snap).toMatchObject({ bot: true, connected: true, ready: true });
    // a bot never takes a locked car: with all cars taken, adding fails
    send(b.conn, { t: 'selectCar', carId: [...['car_a', 'car_b', 'car_c']].find((c) => !room.carLocks.has(c)) });
    send(a.conn, { t: 'addBot' });
    expect(a.conn.last('error')?.code).toBe('car_taken');
    // only the host removes, and the car is released
    send(b.conn, { t: 'removeBot', id: bot?.id });
    expect(room.players.has(bot?.id as string)).toBe(true);
    send(a.conn, { t: 'removeBot', id: bot?.id });
    expect(room.players.has(bot?.id as string)).toBe(false);
    expect(room.carLocks.has(bot?.carId as string)).toBe(false);
  });

  it('races with bots: the countdown does not wait for them, and only the host may send their states', async () => {
    const { BIN_BOT_STATE, STATE_BYTES, encodeBotStates, makeCarState } = await import('@apex/shared');
    const { ovalPos } = await import('../../../packages/shared/test/helpers');
    const { room, join, send, advance } = makeRoom();
    const a = join('Ana');
    const b = join('Ben');
    send(a.conn, { t: 'selectCar', carId: 'car_a' });
    send(b.conn, { t: 'selectCar', carId: 'car_b' });
    send(a.conn, { t: 'ready', ready: true });
    send(b.conn, { t: 'ready', ready: true });
    send(a.conn, { t: 'addBot' });
    const bot = [...room.players.values()].find((p) => p.bot);
    send(a.conn, { t: 'start' });
    expect(room.race?.grid).toContain(bot?.id);
    send(a.conn, { t: 'loaded', raceId: room.raceId });
    send(b.conn, { t: 'loaded', raceId: room.raceId });
    expect(room.startAt).not.toBeNull();
    const startAt = room.startAt as number;
    advance(startAt - 1_000_000 + 20_000);
    const slot = room.race?.slots[bot?.id as string] as number;
    const buf = new ArrayBuffer(5 + STATE_BYTES * 2);
    const s1 = makeCarState();
    const s2 = makeCarState();
    const feed = (from: FakeConn) => {
      for (let k = 0; k < 30; k++) {
        const t = startAt + 10_000 + k * 100;
        const [x1, , z1] = ovalPos(200, k * 5 - 10);
        const [x2, , z2] = ovalPos(200, k * 5 - 7.5);
        Object.assign(s1, { t, px: x1, pz: z1 });
        Object.assign(s2, { t: t + 50, px: x2, pz: z2 });
        const len = encodeBotStates(buf, slot, k, [s1, s2], 2);
        expect(new Uint8Array(buf)[0]).toBe(BIN_BOT_STATE);
        room.onMessage(from, buf.slice(0, len));
      }
    };
    // a non-host cannot drive the bot
    feed(b.conn);
    expect(room.tracker?.players.get(bot?.id as string)?.raceDist ?? 0).toBeLessThan(10);
    feed(a.conn);
    expect(room.tracker?.players.get(bot?.id as string)?.raceDist).toBeGreaterThan(100);
  });
});

describe('qualifying sessions', () => {
  it('only the host sets the session length; the race uses it and ends after the flag', () => {
    const { room, join, send, advance } = makeRoom();
    const a = join('Ana');
    const b = join('Ben');
    send(b.conn, { t: 'setSession', minutes: 20 });
    expect(room.sessionMinutes).toBe(10);
    send(a.conn, { t: 'setSession', minutes: 5 });
    expect(b.conn.last('room')?.room.sessionMinutes).toBe(5);
    send(a.conn, { t: 'selectCar', carId: 'car_a' });
    send(a.conn, { t: 'ready', ready: true });
    send(b.conn, { t: 'selectCar', carId: 'car_b' });
    send(b.conn, { t: 'ready', ready: true });
    send(a.conn, { t: 'start' });
    expect(room.race?.sessionMs).toBe(5 * 60_000);
    send(a.conn, { t: 'loaded', raceId: room.raceId });
    send(b.conn, { t: 'loaded', raceId: room.raceId });
    const startAt = room.startAt as number;
    // a pit stop in the middle of the session is accepted and announced
    advance(startAt - 1_000_000 + 60_000);
    room.tick();
    send(a.conn, { t: 'pit', in: true });
    expect(b.conn.last('pit')).toMatchObject({ playerId: a.id, in: true });
    expect(room.tracker?.players.get(a.id)?.inPit).toBe(true);
    // the flag falls at start + 5 min: Ana is in the garage, so her session is over; Ben may finish his lap
    advance(5 * 60_000);
    room.tick();
    expect(b.conn.inbox.some((m) => m.t === 'flag')).toBe(true);
    expect(room.tracker?.players.get(a.id)?.finishedMs).not.toBeNull();
    expect(room.phase).toBe('racing');
    // after the grace period the session ends with results
    advance(250_000);
    room.tick();
    expect(b.conn.last('results')).toBeDefined();
    expect(room.phase).toBe('lobby');
  });
});

describe('session setup', () => {
  it('only the host sets track and weather; players set their tyres; the race uses them', () => {
    const { room, join, send } = makeRoom();
    const a = join('Ana');
    const b = join('Ben');
    const seed0 = room.conditions.seed;
    send(b.conn, { t: 'setConditions', weather: 'fog' });
    expect(room.conditions.weather).toBe('random');
    send(a.conn, { t: 'setConditions', weather: 'heavy_rain', time: 'dawn', changes: 'off', trackId: 'does-not-exist' });
    expect(room.conditions).toMatchObject({ weather: 'heavy_rain', time: 'dawn', changes: 'off' });
    expect(room.conditions.trackId).not.toBe('does-not-exist');
    send(a.conn, { t: 'setConditions', reroll: true });
    expect(room.conditions.seed).not.toBe(seed0);
    send(b.conn, { t: 'setTyre', tyre: 'wet' });
    expect(a.conn.last('room')?.room.players.find((p) => p.id === b.id)?.tyre).toBe('wet');
    send(a.conn, { t: 'addBot' });
    expect([...room.players.values()].find((p) => p.bot)?.tyre).toBe('wet'); // bots read the (wet) forecast
    send(a.conn, { t: 'selectCar', carId: 'car_a' });
    send(a.conn, { t: 'ready', ready: true });
    send(b.conn, { t: 'selectCar', carId: 'car_b' });
    send(b.conn, { t: 'ready', ready: true });
    send(a.conn, { t: 'start' });
    const race = b.conn.last('raceSetup')?.race;
    expect(race?.weather.kind).toBe('heavy_rain');
    expect(race?.weather.startHour).toBe(6.5);
    expect(race?.trackId).toBe(room.conditions.trackId);
  });
});
