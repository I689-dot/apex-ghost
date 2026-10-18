/**
 * Transport-agnostic room logic. The Durable Object (do.ts) and the unit tests both
 * drive this class. Everything here is synchronous, so each incoming message is
 * processed atomically: two simultaneous car requests can never both succeed.
 */
import {
  COUNTDOWN_MS,
  FINISH_TIMEOUT_MS,
  LOAD_TIMEOUT_MS,
  MAX_CLOCK_SKEW_MS,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  DEFAULT_SESSION_MINUTES,
  FLAG_GRACE_MS,
  RECONNECT_GRACE_MS,
  FLAG_OFF_TRACK,
  FLAG_RESET,
  RaceTracker,
  decodeClientStates,
  decodeBotStates,
  botToRelay,
  BIN_BOT_STATE,
  makeCarState,
  makeRelayPacket,
  mulberry32,
  nicknameKey,
  parseClientMsg,
  planWeather,
  sanitizeNickname,
  shuffle,
  type CarState,
  type ClientMsg,
  type Conditions,
  type TyreChoice,
  type ErrorCode,
  type PlayerInfo,
  type RaceResultRow,
  type RaceSetup,
  type RoomSnapshot,
  type ServerMsg,
  type Phase,
  type TrackRaceData,
  type RaceEvent,
} from '@apex/shared';

export interface Conn {
  readonly id: string;
  send(data: string | ArrayBuffer): void;
  close(code: number, reason: string): void;
}

export interface RoomEnv {
  now(): number;
  random(): number;
  /** Ask to be ticked at (or soon after) this time. */
  schedule(at: number): void;
  /** Persist lobby-level state (survives hibernation). */
  persist(state: PersistedRoom): void;
  /** Default layout. */
  track: TrackRaceData;
  /** All layouts by id (the default included); missing → only the default. */
  tracks?: Record<string, TrackRaceData>;
  carIds: ReadonlySet<string> | null;
}

export interface PersistedPlayer {
  id: string;
  nick: string;
  session: string;
  carId: string | null;
  ready: boolean;
  joinedAt: number;
  waiting: boolean;
  /** AI driver, simulated by the host's browser. */
  bot: boolean;
  /** Starting tyres (display; the physics runs on each client). */
  tyre?: TyreChoice;
}

export interface PersistedRoom {
  code: string;
  created: boolean;
  hostId: string | null;
  raceId: number;
  players: PersistedPlayer[];
  sessionMinutes?: number;
  conditions?: Conditions;
}

interface Player extends PersistedPlayer {
  conn: Conn | null;
  disconnectedAt: number | null;
  slot: number;
  lastDamageAt: number;
  lastPacketAt: number;
}

const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
const BOT_NAMES = [
  'AI Nova',
  'AI Viper',
  'AI Comet',
  'AI Falcon',
  'AI Rook',
  'AI Blaze',
  'AI Orion',
  'AI Pulse',
  'AI Atlas',
  'AI Echo',
  'AI Zephyr',
  'AI Quasar',
];

export class RoomCore {
  code = '';
  created = false;
  phase: Phase = 'lobby';
  hostId: string | null = null;
  raceId = 0;
  readonly players = new Map<string, Player>();
  /** carId → playerId: the single source of truth for car ownership. */
  readonly carLocks = new Map<string, string>();
  private readonly connPlayer = new Map<string, string>();
  race: RaceSetup | null = null;
  tracker: RaceTracker | null = null;
  startAt: number | null = null;
  private loaded = new Set<string>();
  private loadDeadline: number | null = null;
  finishDeadline: number | null = null;
  sessionMinutes = DEFAULT_SESSION_MINUTES;
  conditions: Conditions = { trackId: '', weather: 'random', time: 'random', changes: 'random', seed: 1 };
  private lastStandingsAt = 0;
  private readonly scratch: CarState[] = [makeCarState(), makeCarState(), makeCarState(), makeCarState()];
  private readonly events: RaceEvent[] = [];

  constructor(private readonly env: RoomEnv) {}

  /* ------------------------------------------------------------ lifecycle --- */

  init(code: string): boolean {
    if (this.created) return false;
    this.code = code;
    this.conditions = { ...this.conditions, trackId: this.env.track.id, seed: this.newSeed() };
    this.created = true;
    this.persist();
    return true;
  }

  restore(s: PersistedRoom): void {
    this.code = s.code;
    this.created = s.created;
    this.hostId = s.hostId;
    this.raceId = s.raceId;
    this.sessionMinutes = s.sessionMinutes ?? DEFAULT_SESSION_MINUTES;
    this.conditions = s.conditions ?? { trackId: this.env.track.id, weather: 'random', time: 'random', changes: 'random', seed: this.newSeed() };
    for (const p of s.players) {
      this.players.set(p.id, { ...p, bot: !!p.bot, conn: null, disconnectedAt: p.bot ? null : this.env.now(), slot: -1, lastDamageAt: 0, lastPacketAt: 0 });
      if (p.carId) this.carLocks.set(p.carId, p.id);
    }
    this.scheduleNext();
  }

  /** Re-attach a socket that survived hibernation. */
  reattach(conn: Conn, playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.conn = conn;
    p.disconnectedAt = null;
    this.connPlayer.set(conn.id, playerId);
  }

  private persist(): void {
    this.env.persist({
      code: this.code,
      created: this.created,
      hostId: this.hostId,
      raceId: this.raceId,
      sessionMinutes: this.sessionMinutes,
      conditions: this.conditions,
      players: [...this.players.values()].map(({ id, nick, session, carId, ready, joinedAt, waiting, bot, tyre }) => ({
        id,
        nick,
        session,
        carId,
        ready,
        joinedAt,
        waiting,
        bot,
        tyre,
      })),
    });
  }

  /* -------------------------------------------------------------- helpers --- */

  private rid(len: number): string {
    let s = '';
    for (let i = 0; i < len; i++) s += ID_CHARS[Math.floor(this.env.random() * ID_CHARS.length)];
    return s;
  }

  snapshot(): RoomSnapshot {
    const players: PlayerInfo[] = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        nick: p.nick,
        carId: p.carId,
        ready: p.ready,
        host: p.id === this.hostId,
        connected: p.conn !== null || p.bot,
        waiting: p.waiting,
        bot: p.bot,
        tyre: p.tyre ?? 'medium',
      }));
    return {
      code: this.code,
      phase: this.phase,
      players,
      carLocks: Object.fromEntries(this.carLocks),
      raceId: this.raceId,
      sessionMinutes: this.sessionMinutes,
      conditions: this.conditions,
    };
  }

  private tracks(): Record<string, TrackRaceData> {
    return this.env.tracks ?? { [this.env.track.id]: this.env.track };
  }

  private send(p: Player | undefined, msg: ServerMsg): void {
    if (p?.conn) p.conn.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg, except?: string): void {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.conn && p.id !== except) p.conn.send(s);
  }

  private broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.snapshot() });
  }

  private error(conn: Conn, code: ErrorCode, message: string, fatal: boolean): void {
    conn.send(JSON.stringify({ t: 'error', code, message, fatal } satisfies ServerMsg));
    if (fatal) conn.close(4000, code);
  }

  private racers(): Player[] {
    if (!this.race) return [];
    return this.race.grid.map((id) => this.players.get(id)).filter((p): p is Player => !!p);
  }

  /* ------------------------------------------------------------- messages --- */

  onMessage(conn: Conn, data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      this.onBinary(conn, data);
      return;
    }
    const msg = parseClientMsg(data);
    if (!msg) {
      this.error(conn, 'bad_message', 'Malformed message.', false);
      return;
    }
    if (msg.t === 'ping') {
      conn.send(JSON.stringify({ t: 'pong', c: msg.c, s: this.env.now() } satisfies ServerMsg));
      return;
    }
    if (msg.t === 'hello') {
      this.onHello(conn, msg);
      return;
    }
    const pid = this.connPlayer.get(conn.id);
    const p = pid ? this.players.get(pid) : undefined;
    if (!p) {
      this.error(conn, 'bad_message', 'Say hello first.', true);
      return;
    }
    this.handle(p, msg);
  }

  private onHello(conn: Conn, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    const now = this.env.now();
    if (!this.created) return this.error(conn, 'room_not_found', 'Room not found. Check the code.', true);
    if (msg.v !== PROTOCOL_VERSION) return this.error(conn, 'version_mismatch', 'Game version mismatch. Reload the page.', true);

    // reconnect with a session token
    if (msg.session) {
      const existing = [...this.players.values()].find((p) => p.session === msg.session);
      if (existing) {
        if (existing.conn && existing.conn.id !== conn.id) {
          this.connPlayer.delete(existing.conn.id);
          existing.conn.close(4001, 'replaced');
        }
        existing.conn = conn;
        existing.disconnectedAt = null;
        this.connPlayer.set(conn.id, existing.id);
        this.sendWelcome(existing);
        this.broadcastRoom();
        return;
      }
    }

    const nick = sanitizeNickname(msg.nick);
    if (!nick.ok) return this.error(conn, 'nick_invalid', nick.error, true);
    if (this.players.size >= MAX_PLAYERS) return this.error(conn, 'room_full', `Room is full (${MAX_PLAYERS} players).`, true);
    const key = nicknameKey(nick.nick);
    for (const o of this.players.values()) {
      if (nicknameKey(o.nick) === key) return this.error(conn, 'nick_taken', 'That nickname is already taken in this room.', true);
    }

    const p: Player = {
      id: this.rid(10),
      nick: nick.nick,
      session: this.rid(24),
      carId: null,
      ready: false,
      joinedAt: now,
      waiting: this.phase !== 'lobby',
      bot: false,
      conn,
      disconnectedAt: null,
      slot: -1,
      lastDamageAt: 0,
      lastPacketAt: 0,
    };
    this.players.set(p.id, p);
    this.connPlayer.set(conn.id, p.id);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = p.id;
    this.persist();
    this.sendWelcome(p);
    this.broadcastRoom();
  }

  private sendWelcome(p: Player): void {
    const inRace = this.race !== null && this.race.grid.includes(p.id) && this.phase !== 'lobby';
    this.send(p, {
      t: 'welcome',
      you: p.id,
      session: p.session,
      room: this.snapshot(),
      serverTime: this.env.now(),
      race: inRace ? this.race : null,
      startAt: inRace ? this.startAt : null,
    });
  }

  private handle(p: Player, msg: ClientMsg): void {
    switch (msg.t) {
      case 'selectCar':
        return this.selectCar(p, msg.carId);
      case 'ready':
        if (this.phase !== 'lobby') return;
        if (msg.ready && !p.carId) return;
        p.ready = msg.ready;
        this.persist();
        return this.broadcastRoom();
      case 'start':
        return this.start(p);
      case 'loaded':
        if (this.race && msg.raceId === this.race.raceId) {
          this.loaded.add(p.id);
          this.maybeBeginCountdown();
        }
        return;
      case 'damage': {
        const now = this.env.now();
        if (now - p.lastDamageAt < 400) return;
        p.lastDamageAt = now;
        return this.broadcast({ t: 'damage', playerId: p.id, zones: msg.zones }, p.id);
      }
      case 'leave':
        this.removePlayer(p.id);
        p.conn?.close(1000, 'left');
        return;
      case 'addBot':
        return this.addBot(p);
      case 'setConditions': {
        if (p.id !== this.hostId || this.phase !== 'lobby') return;
        const c = { ...this.conditions };
        if (msg.trackId !== undefined && this.tracks()[msg.trackId]) c.trackId = msg.trackId;
        if (msg.weather !== undefined) c.weather = msg.weather;
        if (msg.time !== undefined) c.time = msg.time;
        if (msg.changes !== undefined) c.changes = msg.changes;
        if (msg.reroll) c.seed = this.newSeed();
        this.conditions = c;
        this.updateBotTyres();
        this.persist();
        this.broadcastRoom();
        return;
      }
      case 'setTyre':
        if (this.phase !== 'lobby' && !p.waiting) return;
        p.tyre = msg.tyre;
        this.persist();
        this.broadcastRoom();
        return;
      case 'setSession':
        if (p.id !== this.hostId || this.phase !== 'lobby') return;
        this.sessionMinutes = msg.minutes;
        this.persist();
        this.broadcastRoom();
        return;
      case 'pit': {
        if (!this.tracker || !this.race || this.race.slots[p.id] === undefined) return;
        if (this.phase !== 'racing' && this.phase !== 'countdown') return;
        const ev = this.events;
        ev.length = 0;
        if (msg.in) this.tracker.pitIn(p.id, this.env.now(), ev);
        else this.tracker.pitOut(p.id, this.tracker.track.pitExitS ?? 0);
        this.broadcast({ t: 'pit', playerId: p.id, in: msg.in });
        this.handleRaceEvents(ev, p, this.env.now());
        if (this.tracker?.allDone()) this.endRace();
        return;
      }
      case 'removeBot': {
        const b = this.players.get(msg.id);
        if (p.id === this.hostId && this.phase === 'lobby' && b?.bot) this.removePlayer(b.id);
        return;
      }
      default:
        return;
    }
  }

  private newSeed(): number {
    return Math.floor(this.env.random() * 0xffffffff) >>> 0;
  }

  /** Bots pick their tyres from the forecast: wets on a wet track, mediums otherwise. */
  private updateBotTyres(): void {
    const plan = planWeather(this.conditions.seed, this.conditions);
    const tyre: TyreChoice = plan.initialWetness > 0.35 ? 'wet' : 'medium';
    for (const b of this.players.values()) if (b.bot) b.tyre = tyre;
  }

  /** Host adds an AI driver with a random free car (respects the car locks). */
  private addBot(host: Player): void {
    if (host.id !== this.hostId || this.phase !== 'lobby') return;
    if (this.players.size >= MAX_PLAYERS) {
      this.send(host, { t: 'error', code: 'room_full', message: `Room is full (${MAX_PLAYERS} players).`, fatal: false });
      return;
    }
    const free = [...(this.env.carIds ?? [])].filter((c) => !this.carLocks.has(c));
    if (free.length === 0) {
      this.send(host, { t: 'error', code: 'car_taken', message: 'No free car left for a bot.', fatal: false });
      return;
    }
    const used = new Set([...this.players.values()].map((x) => x.nick));
    const nick = BOT_NAMES.find((n) => !used.has(n)) ?? `AI ${this.rid(3).toUpperCase()}`;
    const carId = free[Math.floor(this.env.random() * free.length)];
    const bot: Player = {
      id: `bot${this.rid(7)}`,
      nick,
      session: '',
      carId,
      ready: true,
      joinedAt: this.env.now(),
      waiting: false,
      bot: true,
      tyre: planWeather(this.conditions.seed, this.conditions).initialWetness > 0.35 ? 'wet' : 'medium',
      conn: null,
      disconnectedAt: null,
      slot: -1,
      lastDamageAt: 0,
      lastPacketAt: 0,
    };
    this.players.set(bot.id, bot);
    this.carLocks.set(carId, bot.id);
    this.persist();
    this.broadcastRoom();
  }

  /** Atomic car lock: grant only when nobody else holds the car. */
  selectCar(p: Player, carId: string | null): void {
    if (this.phase !== 'lobby' && !p.waiting) {
      this.send(p, { t: 'carLock', ok: false, carId, owner: null });
      return;
    }
    if (carId !== null && this.env.carIds && !this.env.carIds.has(carId)) {
      this.send(p, { t: 'carLock', ok: false, carId, owner: null });
      return;
    }
    if (carId !== null) {
      const owner = this.carLocks.get(carId);
      if (owner !== undefined && owner !== p.id) {
        this.send(p, { t: 'carLock', ok: false, carId, owner });
        return;
      }
    }
    if (p.carId && this.carLocks.get(p.carId) === p.id) this.carLocks.delete(p.carId);
    p.carId = carId;
    if (carId) this.carLocks.set(carId, p.id);
    else p.ready = false;
    this.persist();
    this.send(p, { t: 'carLock', ok: true, carId, owner: p.id });
    this.broadcastRoom();
  }

  private start(p: Player): void {
    if (p.id !== this.hostId || this.phase !== 'lobby') {
      this.send(p, { t: 'error', code: 'not_host', message: 'Only the host can start the race.', fatal: false });
      return;
    }
    const entrants = [...this.players.values()].filter((x) => x.conn !== null || x.bot);
    if (entrants.length === 0 || entrants.some((x) => !x.carId || !x.ready)) {
      this.send(p, { t: 'error', code: 'not_ready', message: 'Everyone needs a car and must be ready.', fatal: false });
      return;
    }
    const now = this.env.now();
    this.raceId++;
    const seed = Math.floor(this.env.random() * 0xffffffff) >>> 0;
    const rand = mulberry32(seed);
    const grid = shuffle(
      entrants.map((x) => x.id),
      rand,
    );
    const slots: Record<string, number> = {};
    grid.forEach((id, i) => {
      slots[id] = i;
      const pl = this.players.get(id);
      if (pl) pl.slot = i;
    });
    for (const x of this.players.values()) x.waiting = !grid.includes(x.id);
    const cond = this.conditions;
    this.race = {
      raceId: this.raceId,
      seed: cond.seed,
      weather: planWeather(cond.seed, cond),
      grid,
      slots,
      sessionMs: this.sessionMinutes * 60_000,
      trackId: this.tracks()[cond.trackId] ? cond.trackId : this.env.track.id,
    };
    this.phase = 'loading';
    this.loaded = new Set();
    this.loadDeadline = now + LOAD_TIMEOUT_MS;
    this.startAt = null;
    this.tracker = null;
    this.finishDeadline = null;
    this.persist();
    this.broadcast({ t: 'raceSetup', race: this.race });
    this.broadcastRoom();
    this.scheduleNext();
  }

  private maybeBeginCountdown(force = false): void {
    if (this.phase !== 'loading' || !this.race) return;
    const waitingFor = this.racers().filter((r) => r.conn !== null && !this.loaded.has(r.id));
    if (!force && waitingFor.length > 0) return;
    const now = this.env.now();
    this.startAt = now + COUNTDOWN_MS;
    this.tracker = new RaceTracker(this.tracks()[this.race.trackId] ?? this.env.track, this.startAt, { sessionMs: this.race.sessionMs });
    for (const id of this.race.grid) this.tracker.addPlayer(id);
    this.phase = 'countdown';
    this.broadcast({ t: 'countdown', raceId: this.race.raceId, startAt: this.startAt });
    this.broadcastRoom();
    this.scheduleNext();
  }

  /* --------------------------------------------------------------- binary --- */

  private onBinary(conn: Conn, buf: ArrayBuffer): void {
    const pid = this.connPlayer.get(conn.id);
    const sender = pid ? this.players.get(pid) : undefined;
    if (!sender || !this.race || !this.tracker || (this.phase !== 'countdown' && this.phase !== 'racing')) return;
    const now = this.env.now();
    let p: Player | undefined = sender;
    let relay: ArrayBuffer;
    let count: number;
    if (buf.byteLength > 0 && new Uint8Array(buf)[0] === BIN_BOT_STATE) {
      // only the host simulates bots
      if (sender.id !== this.hostId) return;
      const dec = decodeBotStates(buf, this.scratch, now);
      if (!dec) return;
      p = [...this.players.values()].find((x) => x.bot && x.slot === dec.slot);
      if (!p) return;
      count = dec.count;
      relay = botToRelay(buf);
    } else {
      if (sender.slot < 0 || this.race.slots[sender.id] === undefined) return;
      const dec = decodeClientStates(buf, this.scratch, now);
      if (!dec) return;
      count = dec.count;
      relay = makeRelayPacket(buf, sender.slot);
    }
    const dec = { count };
    p.lastPacketAt = now;
    if (this.phase === 'countdown' && now >= (this.startAt ?? Infinity)) this.phase = 'racing';
    // race validation (server clock)
    const ev = this.events;
    ev.length = 0;
    for (let i = 0; i < dec.count; i++) {
      const s = this.scratch[i];
      // future timestamps are forged; old ones are accepted for backfill after a reconnect
      if (s.t > now + MAX_CLOCK_SKEW_MS || s.t < now - RECONNECT_GRACE_MS - 10_000) continue;
      this.tracker.ingest(p.id, s.t, s.px, s.py, s.pz, (s.flags & FLAG_RESET) !== 0, ev, (s.flags & FLAG_OFF_TRACK) !== 0);
    }
    this.handleRaceEvents(ev, p, now);
    // relay to everybody else in the race (bot states go to everyone but the simulating host)
    for (const o of this.players.values()) if (o.conn && o.id !== p.id && o.id !== sender.id && !o.waiting) o.conn.send(relay);

    if (now - this.lastStandingsAt >= 500) {
      this.lastStandingsAt = now;
      this.broadcast({ t: 'standings', raceId: this.race.raceId, list: this.tracker.standings(), finishDeadline: this.finishDeadline });
    }
    if (this.tracker.allDone()) this.endRace();
  }

  /** Broadcast what the lap logic decided (laps, sectors, penalties, finishes, the flag). */
  private handleRaceEvents(ev: RaceEvent[], p: Player, now: number): void {
    for (const e of ev) {
      if (e.type === 'lap' || e.type === 'penalty') this.lastStandingsAt = 0; // the timing screen updates at once
      if (e.type === 'lap')
        this.broadcast({
          t: 'lap',
          playerId: e.playerId,
          lap: e.lap,
          lapMs: e.lapMs,
          penaltyMs: e.penaltyMs,
          sectors: e.sectors,
          best: e.best,
          valid: e.valid,
          outLap: e.outLap,
        });
      else if (e.type === 'penalty' && !p.bot) this.send(p, { t: 'penalty', playerId: e.playerId, reason: e.reason, ms: e.ms, lapPenaltyMs: e.lapPenaltyMs });
      else if (e.type === 'sector' && !p.bot) this.send(p, { t: 'sector', playerId: e.playerId, sector: e.sector, ms: e.ms });
      else if (e.type === 'finish') {
        this.broadcast({ t: 'finished', playerId: e.playerId, totalMs: e.totalMs });
        // lap-count sessions only: the others get a minute after the first finisher
        if (this.finishDeadline === null && this.tracker?.flagAt === null) {
          this.finishDeadline = now + FINISH_TIMEOUT_MS;
          this.scheduleNext();
        }
      } else if (e.type === 'flag' && this.race) {
        this.broadcast({ t: 'flag', raceId: this.race.raceId });
        // chequered flag: everyone may finish the lap they are on
        this.finishDeadline = (this.tracker?.flagAt ?? now) + FLAG_GRACE_MS;
        this.scheduleNext();
      }
    }
  }

  /* --------------------------------------------------------- end of race --- */

  endRace(): void {
    if (!this.race || !this.tracker) return;
    for (const p of this.tracker.players.values()) if (p.finishedMs === null) this.tracker.markDnf(p.id);
    const st = this.tracker.standings();
    let fastest: { id: string; ms: number } | null = null;
    const rows: RaceResultRow[] = st.map((s) => {
      const pl = this.players.get(s.id);
      if (s.bestLapMs !== null && (!fastest || s.bestLapMs < fastest.ms)) fastest = { id: s.id, ms: s.bestLapMs };
      return {
        id: s.id,
        nick: pl?.nick ?? 'left',
        carId: pl?.carId ?? null,
        position: s.position,
        totalMs: s.finishedMs,
        bestLapMs: s.bestLapMs,
        gapMs: s.gapMs,
        validLaps: s.validLaps,
        dnf: s.dnf,
        penaltyMs: s.penaltyMs,
      };
    });
    this.broadcast({ t: 'results', raceId: this.race.raceId, rows, fastestLap: fastest });
    // back to the lobby for a rematch with the same code
    this.phase = 'lobby';
    this.race = null;
    this.tracker = null;
    this.startAt = null;
    this.finishDeadline = null;
    this.loadDeadline = null;
    for (const p of this.players.values()) {
      p.ready = false;
      p.waiting = false;
      p.slot = -1;
    }
    this.persist();
    this.broadcastRoom();
  }

  /* ---------------------------------------------------------- disconnects --- */

  onClose(conn: Conn): void {
    const pid = this.connPlayer.get(conn.id);
    this.connPlayer.delete(conn.id);
    const p = pid ? this.players.get(pid) : undefined;
    if (!p || p.conn?.id !== conn.id) return;
    p.conn = null;
    p.disconnectedAt = this.env.now();
    this.scheduleNext();
    this.broadcastRoom();
    if (this.phase === 'loading') this.maybeBeginCountdown();
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    if (p.conn) this.connPlayer.delete(p.conn.id);
    this.players.delete(id);
    if (p.carId && this.carLocks.get(p.carId) === id) this.carLocks.delete(p.carId);
    if (this.tracker) this.tracker.markDnf(id);
    if (this.hostId === id) {
      // bots were simulated by the old host: they cannot continue this race
      if (this.tracker) for (const b of this.players.values()) if (b.bot) this.tracker.markDnf(b.id);
      const next = [...this.players.values()]
        .filter((x) => !x.bot)
        .sort((a, b) => {
          if ((a.conn !== null) !== (b.conn !== null)) return a.conn ? -1 : 1;
          return a.joinedAt - b.joinedAt;
        })[0];
      this.hostId = next?.id ?? null;
    }
    if (![...this.players.values()].some((x) => !x.bot)) {
      // no humans left: the room code expires (bots go with it)
      this.players.clear();
      this.created = false;
      this.phase = 'lobby';
      this.race = null;
      this.tracker = null;
      this.carLocks.clear();
    }
    this.persist();
    this.broadcastRoom();
    if (this.tracker && this.tracker.allDone()) this.endRace();
    if (this.phase === 'loading') this.maybeBeginCountdown();
  }

  /** Process deadlines. Returns the next time we need a tick, or null. */
  tick(): number | null {
    const now = this.env.now();
    for (const p of [...this.players.values()]) {
      if (p.disconnectedAt !== null && now - p.disconnectedAt >= RECONNECT_GRACE_MS) this.removePlayer(p.id);
    }
    if (this.phase === 'loading' && this.loadDeadline !== null && now >= this.loadDeadline) this.maybeBeginCountdown(true);
    if (this.phase === 'countdown' && this.startAt !== null && now >= this.startAt) this.phase = 'racing';
    if (this.tracker && this.race && (this.phase === 'racing' || this.phase === 'countdown')) {
      const ev = this.events;
      ev.length = 0;
      this.tracker.checkFlag(now, ev);
      const host = this.hostId ? this.players.get(this.hostId) : undefined;
      if (ev.length && host) this.handleRaceEvents(ev, host, now);
      if (this.tracker.allDone()) this.endRace();
    }
    if (this.finishDeadline !== null && now >= this.finishDeadline) this.endRace();
    return this.scheduleNext();
  }

  private scheduleNext(): number | null {
    const times: number[] = [];
    for (const p of this.players.values()) if (p.disconnectedAt !== null) times.push(p.disconnectedAt + RECONNECT_GRACE_MS);
    if (this.phase === 'loading' && this.loadDeadline !== null) times.push(this.loadDeadline);
    if (this.phase === 'countdown' && this.startAt !== null) times.push(this.startAt);
    if (this.finishDeadline !== null) times.push(this.finishDeadline);
    if (this.tracker?.flagAt != null && !this.tracker.flagShown) times.push(this.tracker.flagAt);
    if (times.length === 0) return null;
    const at = Math.min(...times);
    this.env.schedule(at);
    return at;
  }
}
