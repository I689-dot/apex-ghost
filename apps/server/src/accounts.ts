/**
 * Accounts, friends and records, in a Durable Object of their own with its built-in SQLite database (AccountsDO,
 * one instance): nothing outside Cloudflare to configure or keep awake, and on the free plan.
 *  - A nickname and a password, nothing else (no e-mail, no verification). Passwords are PBKDF2-SHA256 hashes with a
 *    random salt (WebCrypto; the iteration count fits the free plan's CPU budget per request). Signing in returns a
 *    random token, sent back as `Authorization: Bearer …`.
 *  - Friends: a request is a pending row from the asker; accepting adds the reverse row. Presence (online, in a
 *    lobby, racing, watching, and in which room) is live state, not data: it lives in the DirectoryDO's memory and
 *    expires 90 s after the last heartbeat (the Worker adds it to the friends list).
 *  - Records: laps and results are written by the game server (RoomDO, from its own lap logic: clients never report
 *    times), so a leaderboard can't be typed in.
 * The Worker calls `api()` over Durable Object RPC; it answers an HTTP status and a JSON body.
 */
import { DurableObject } from 'cloudflare:workers';
import { NICK_MAX, NICK_MIN, PROFILE_RE, type AccountUser, type FriendEntry, type RecordRow, type UserStats } from '@apex/shared';
import type { RecordEvent } from './room';
import { COINS, INVITE_RACES, INVITE_WINDOW_MS, RATING_START, SEED_CODES, coinsForResult, dayOf, newInviteCode, normaliseCode, ratingDelta } from './economy';

export type AccountOp =
  | 'register'
  | 'login'
  | 'logout'
  | 'delete'
  | 'password'
  | 'me'
  | 'profile'
  | 'friends'
  | 'friends/add'
  | 'friends/accept'
  | 'friends/remove'
  | 'presence'
  | 'records'
  | 'stats'
  | 'trace'
  | 'telemetry'
  | 'traces'
  | 'drivers'
  | 'wallet'
  | 'redeem'
  | 'invite'
  | 'invite/apply'
  | 'ranking';

/** An HTTP status and the JSON body (as text: RPC carries it unchanged). */
export interface AccountReply {
  status: number;
  json: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const NICK_RE = /^[\p{L}\p{N} _.-]+$/u;
const PBKDF2_ITERATIONS = 10_000;

function checkNick(nick: unknown): string {
  const n = typeof nick === 'string' ? nick.trim() : '';
  if (n.length < NICK_MIN || n.length > NICK_MAX || !NICK_RE.test(n))
    throw new HttpError(400, `Nickname: ${NICK_MIN}–${NICK_MAX} letters, numbers, spaces, _ . -`);
  return n;
}

function checkPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 4 || pw.length > 72) throw new HttpError(400, 'Password: 4 to 72 characters');
  return pw;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return hex(b);
}

async function hashPassword(pw: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g)?.map((x) => parseInt(x, 16)) ?? []);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return hex(new Uint8Array(bits));
}

/** Equal-time comparison of two hex strings. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const SCHEMA = `
create table if not exists users (
  id text primary key,
  nick text not null,
  nick_key text not null unique,
  pass_hash text not null,
  salt text not null,
  created_at integer not null,
  last_seen integer
);
create table if not exists tokens (
  token text primary key,
  user_id text not null references users (id) on delete cascade,
  created_at integer not null
);
create index if not exists tokens_user on tokens (user_id);
create table if not exists friends (
  user_id text not null references users (id) on delete cascade,
  friend_id text not null references users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at integer not null,
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index if not exists friends_friend on friends (friend_id);
create table if not exists laps (
  id integer primary key autoincrement,
  user_id text not null references users (id) on delete cascade,
  track_id text not null,
  car_id text not null,
  lap_ms integer not null check (lap_ms > 0),
  sectors text not null default '',
  session text not null,
  wet integer not null default 0,
  created_at integer not null
);
create index if not exists laps_track_time on laps (track_id, lap_ms);
create index if not exists laps_user_track on laps (user_id, track_id, lap_ms);
-- each driver's best lap on a layout (dry / wet) as the game recorded it: position, speed, pedals, steering and gear
-- every few metres (the website's telemetry page). Only for a lap this server recorded (laps), the best one kept.
create table if not exists traces (
  user_id text not null references users (id) on delete cascade,
  track_id text not null,
  wet integer not null default 0,
  car_id text not null,
  lap_ms integer not null,
  sectors text not null default '',
  data text not null,
  created_at integer not null,
  primary key (user_id, track_id, wet)
);
create index if not exists traces_track on traces (track_id, wet, lap_ms);
create table if not exists results (
  id integer primary key autoincrement,
  user_id text not null references users (id) on delete cascade,
  track_id text not null,
  car_id text not null,
  session text not null,
  position integer not null,
  entrants integer not null,
  best_lap_ms integer,
  total_ms integer,
  created_at integer not null
);
create index if not exists results_user on results (user_id, created_at desc);
create table if not exists coin_ledger (
  id integer primary key autoincrement,
  user_id text not null references users (id) on delete cascade,
  delta integer not null,
  reason text not null,
  created_at integer not null
);
create index if not exists coin_ledger_user on coin_ledger (user_id, created_at desc);
create table if not exists codes (
  code text primary key,
  coins integer not null check (coins >= 0),
  what text not null,
  max_uses integer,
  uses integer not null default 0,
  expires_at integer
);
create table if not exists code_uses (
  code text not null references codes (code) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  created_at integer not null,
  primary key (code, user_id)
);
`;

type Row = Record<string, SqlStorageValue>;

export class AccountsDO extends DurableObject<Record<string, never>> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
    // the driver profile's columns (added after the first accounts)
    const cols = new Set(this.rows<{ name: string }>('pragma table_info(users)').map((c) => c.name));
    for (const [c, type] of [
      ['country', 'text'],
      ['num', 'integer'],
      ['abbr', 'text'],
      ['colour', 'text'],
      ['avatar', 'text'],
      // coins, the Driver Rating and invites (economy.ts)
      ['coins', 'integer not null default 0'],
      ['rating', `integer not null default ${RATING_START}`],
      ['races', 'integer not null default 0'],
      ['invite_code', 'text'],
      ['invited_by', 'text'],
      ['invite_paid', 'integer not null default 0'],
      ['last_race_day', 'integer'],
    ])
      if (!cols.has(c)) this.sql.exec(`alter table users add column ${c} ${type}`);
    this.sql.exec('create unique index if not exists users_invite on users (invite_code)');
    this.sql.exec('create index if not exists users_rating on users (rating desc)');
    for (const c of SEED_CODES)
      this.sql.exec('insert or ignore into codes (code, coins, what, max_uses) values (?, ?, ?, ?)', c.code, c.coins, c.what, c.maxUses);
  }

  private rows<T = Row>(query: string, ...args: SqlStorageValue[]): T[] {
    return this.sql.exec(query, ...args).toArray() as T[];
  }

  /** One account request: `op` with the caller's token, POST body and query string. */
  async api(op: AccountOp, token: string | null, body: Record<string, unknown>, query: Record<string, string>): Promise<AccountReply> {
    const r = await this.handle(op, token, body, query);
    return { status: r.status, json: JSON.stringify(r.body) };
  }

  private async handle(
    op: AccountOp,
    token: string | null,
    body: Record<string, unknown>,
    query: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> {
    try {
      switch (op) {
        case 'register':
          return { status: 201, body: await this.register(body) };
        case 'login':
          return { status: 200, body: await this.login(body) };
        case 'logout':
          if (token) this.sql.exec('delete from tokens where token = ?', token);
          return { status: 200, body: { ok: true } };
        case 'delete':
          await this.deleteAccount(token, body);
          return { status: 200, body: { ok: true } };
        case 'password':
          await this.changePassword(token, body);
          return { status: 200, body: { ok: true } };
        case 'me': {
          const u = this.userOf(token);
          return u ? { status: 200, body: { user: u } } : { status: 401, body: { error: 'Sign in first.' } };
        }
        case 'profile':
          return { status: 200, body: { user: this.setProfile(token, body) } };
        case 'presence': {
          const u = this.requireUser(token);
          this.sql.exec('update users set last_seen = ? where id = ?', Date.now(), u.id);
          return { status: 200, body: { user: u } };
        }
        case 'friends':
          return { status: 200, body: { friends: this.friends(token) } };
        case 'friends/add':
          this.addFriend(token, body);
          return { status: 200, body: { ok: true } };
        case 'friends/accept':
          this.acceptFriend(token, body);
          return { status: 200, body: { ok: true } };
        case 'friends/remove':
          this.removeFriend(token, body);
          return { status: 200, body: { ok: true } };
        case 'records':
          return { status: 200, body: { rows: this.records(token, query) } };
        case 'trace':
          return { status: 200, body: this.saveTrace(token, body) };
        case 'telemetry':
          return { status: 200, body: this.telemetry(query) };
        case 'drivers':
          return { status: 200, body: { rows: this.drivers(query) } };
        case 'traces':
          return { status: 200, body: { rows: this.traceList(query) } };
        case 'stats':
          return { status: 200, body: { stats: this.stats(token, query) } };
        case 'wallet':
          return { status: 200, body: this.wallet(token) };
        case 'redeem':
          return { status: 200, body: this.redeem(token, body) };
        case 'invite':
          return { status: 200, body: this.invite(token) };
        case 'invite/apply':
          return { status: 200, body: this.applyInvite(this.requireUser(token).id, body.code) };
        case 'ranking':
          return { status: 200, body: this.ranking(token, query) };
        default:
          return { status: 404, body: { error: 'Not found' } };
      }
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      console.error('[accounts]', e);
      return { status: 500, body: { error: 'Account server error, try again.' } };
    }
  }

  /** Saves the driver profile (each field checked; null clears it). */
  private setProfile(token: string | null, body: Record<string, unknown>): AccountUser {
    const u = this.requireUser(token);
    const pick = (v: unknown, ok: (x: unknown) => boolean) => (v === null || v === undefined || v === '' ? null : ok(v) ? v : undefined);
    const country = pick(body.country, (x) => typeof x === 'string' && PROFILE_RE.country.test(x));
    const num = pick(body.num, (x) => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 999);
    const abbr = pick(body.abbr, (x) => typeof x === 'string' && PROFILE_RE.abbr.test(x));
    const colour = pick(body.colour, (x) => typeof x === 'string' && PROFILE_RE.colour.test(x));
    // the avatar only when sent (older clients do not send it: it is kept)
    const avatar = 'avatar' in body ? pick(body.avatar, (x) => typeof x === 'string' && PROFILE_RE.avatar.test(x)) : (u.avatar ?? null);
    if ([country, num, abbr, colour, avatar].some((v) => v === undefined)) throw new HttpError(400, 'Check the profile fields.');
    this.sql.exec(
      'update users set country = ?, num = ?, abbr = ?, colour = ?, avatar = ? where id = ?',
      country as SqlStorageValue,
      num as SqlStorageValue,
      abbr as SqlStorageValue,
      colour as SqlStorageValue,
      avatar as SqlStorageValue,
      u.id,
    );
    return this.userOf(token) as AccountUser;
  }

  /**
   * A lap's telemetry from the game. It must belong to a lap this server recorded for the driver in the last 15
   * minutes (same layout, same time to the millisecond): the time cannot be made up, only the trace comes from the
   * client. Kept when it is the driver's best on that layout in those conditions.
   */
  private saveTrace(token: string | null, body: Record<string, unknown>): { saved: boolean } {
    const u = this.requireUser(token);
    const track = typeof body.track === 'string' && /^[a-z0-9_]{1,40}$/.test(body.track) ? body.track : null;
    const lapMs = typeof body.lapMs === 'number' && Number.isFinite(body.lapMs) ? Math.round(body.lapMs) : null;
    const data = typeof body.data === 'string' && body.data.length <= 160_000 && /^[A-Za-z0-9+/=]+$/.test(body.data) ? body.data : null;
    const bin = typeof body.bin === 'number' && [5, 10].includes(body.bin) ? body.bin : null;
    if (!track || !lapMs || !data || !bin) throw new HttpError(400, 'Bad trace.');
    const lap = this.rows<{ car_id: string; wet: number; sectors: string }>(
      'select car_id, wet, sectors from laps where user_id = ? and track_id = ? and lap_ms = ? and created_at > ? order by created_at desc limit 1',
      u.id,
      track,
      lapMs,
      Date.now() - 15 * 60_000,
    )[0];
    if (!lap) throw new HttpError(404, 'No such lap.');
    const old = this.rows<{ lap_ms: number }>('select lap_ms from traces where user_id = ? and track_id = ? and wet = ?', u.id, track, lap.wet)[0];
    if (old && old.lap_ms <= lapMs) return { saved: false };
    this.sql.exec(
      'insert or replace into traces (user_id, track_id, wet, car_id, lap_ms, sectors, data, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
      u.id,
      track,
      lap.wet,
      lap.car_id,
      lapMs,
      lap.sectors,
      `${bin}:${data}`,
      Date.now(),
    );
    return { saved: true };
  }

  /** Drivers whose nickname starts with q (public: the website's driver lookup), with their profile. */
  private drivers(
    q: Record<string, string>,
  ): { id: string; nick: string; country: string | null; num: number | null; colour: string | null; abbr: string | null }[] {
    const s = (q.q ?? '').normalize('NFKC').toLowerCase().trim();
    if (s.length < 2 || s.length > 16) return [];
    return this.rows<{ id: string; nick: string; country: string | null; num: number | null; colour: string | null; abbr: string | null }>(
      "select id, nick, country, num, colour, abbr from users where nick_key like ? escape '\\' order by nick_key limit 20",
      `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    );
  }

  /** The laps with telemetry on a layout, fastest first (public: the website's telemetry page). */
  private traceList(q: Record<string, string>): { userId: string; nick: string; carId: string; lapMs: number; at: number }[] {
    return this.rows<{ user_id: string; nick: string; car_id: string; lap_ms: number; created_at: number }>(
      'select t.user_id as user_id, u.nick as nick, t.car_id as car_id, t.lap_ms as lap_ms, t.created_at as created_at from traces t join users u on u.id = t.user_id where t.track_id = ? and t.wet = ? order by t.lap_ms limit 100',
      q.track ?? '',
      q.wet === '1' ? 1 : 0,
    ).map((r) => ({ userId: r.user_id, nick: r.nick, carId: r.car_id, lapMs: r.lap_ms, at: r.created_at }));
  }

  /** One lap's telemetry (public). */
  private telemetry(q: Record<string, string>): {
    userId: string;
    nick: string;
    carId: string;
    lapMs: number;
    sectors: number[];
    bin: number;
    data: string;
    at: number;
  } {
    const r = this.rows<{ user_id: string; nick: string; car_id: string; lap_ms: number; sectors: string; data: string; created_at: number }>(
      'select t.user_id as user_id, u.nick as nick, t.car_id as car_id, t.lap_ms as lap_ms, t.sectors as sectors, t.data as data, t.created_at as created_at from traces t join users u on u.id = t.user_id where t.track_id = ? and t.wet = ? and t.user_id = ?',
      q.track ?? '',
      q.wet === '1' ? 1 : 0,
      q.user ?? '',
    )[0];
    if (!r) throw new HttpError(404, 'No telemetry for that lap.');
    const [bin, data] = r.data.split(':');
    return {
      userId: r.user_id,
      nick: r.nick,
      carId: r.car_id,
      lapMs: r.lap_ms,
      sectors: r.sectors ? r.sectors.split(',').map(Number) : [],
      bin: Number(bin),
      data,
      at: r.created_at,
    };
  }

  /** The signed-in user of a token (null: not signed in or unknown). */
  userOf(token: string | null): AccountUser | null {
    if (!token || !/^[0-9a-f]{48}$/.test(token)) return null;
    return (
      this.rows<AccountUser>(
        'select u.id as id, u.nick as nick, u.country as country, u.num as num, u.abbr as abbr, u.colour as colour, u.avatar as avatar from tokens t join users u on u.id = t.user_id where t.token = ?',
        token,
      )[0] ?? null
    );
  }

  /** Accepted friends' ids of the token's user (whom their presence is shown to); [] when unknown. */
  friendIdsOf(token: string | null): { user: AccountUser | null; friends: string[] } {
    const user = this.userOf(token);
    if (!user) return { user: null, friends: [] };
    const friends = this.rows<{ friend_id: string }>("select friend_id from friends where user_id = ? and status = 'accepted'", user.id).map(
      (r) => r.friend_id,
    );
    return { user, friends };
  }

  /** The game server's records (signed-in drivers only: a token that matches nobody writes nothing). */
  writeRecords(events: RecordEvent[]): void {
    const now = Date.now();
    // the signed-in drivers of each race in this batch (a race's results come together): the Driver Rating moves only
    // when people raced each other, not a driver alone with AI cars
    const people = new Map<string, number>();
    for (const e of events)
      if (e.kind === 'result' && e.session === 'race' && this.userOf(e.token)) people.set(e.trackId, (people.get(e.trackId) ?? 0) + 1);
    for (const e of events) {
      const u = this.userOf(e.token);
      if (!u) continue;
      if (e.kind === 'result' && e.session === 'race' && e.totalMs !== null) this.payRace(u.id, e.position, e.entrants, (people.get(e.trackId) ?? 0) >= 2, now);
      if (e.kind === 'lap')
        this.sql.exec(
          'insert into laps (user_id, track_id, car_id, lap_ms, sectors, session, wet, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
          u.id,
          e.trackId,
          e.carId,
          Math.round(e.lapMs),
          e.sectors.map(Math.round).join(','),
          e.session,
          e.wet ? 1 : 0,
          now,
        );
      else
        this.sql.exec(
          'insert into results (user_id, track_id, car_id, session, position, entrants, best_lap_ms, total_ms, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          u.id,
          e.trackId,
          e.carId,
          e.session,
          e.position,
          e.entrants,
          e.bestLapMs,
          e.totalMs,
          now,
        );
    }
  }

  private requireUser(token: string | null): AccountUser {
    const u = this.userOf(token);
    if (!u) throw new HttpError(401, 'Sign in first.');
    return u;
  }

  private newToken(userId: string): string {
    const token = randomHex(24);
    this.sql.exec('insert into tokens (token, user_id, created_at) values (?, ?, ?)', token, userId, Date.now());
    return token;
  }

  private async register(body: Record<string, unknown>): Promise<{ token: string; user: AccountUser }> {
    const nick = checkNick(body.nick);
    const pw = checkPassword(body.password);
    if (this.rows('select 1 from users where nick_key = ?', nick.toLowerCase()).length) throw new HttpError(409, 'That nickname is taken.');
    const salt = randomHex(16);
    const hash = await hashPassword(pw, salt);
    // a register racing this one may have taken the nickname while the hash was computed
    if (this.rows('select 1 from users where nick_key = ?', nick.toLowerCase()).length) throw new HttpError(409, 'That nickname is taken.');
    const id = crypto.randomUUID();
    this.sql.exec(
      'insert into users (id, nick, nick_key, pass_hash, salt, created_at, last_seen) values (?, ?, ?, ?, ?, ?, ?)',
      id,
      nick,
      nick.toLowerCase(),
      hash,
      salt,
      Date.now(),
      Date.now(),
    );
    // an invite code given when signing up (a wrong one does not stop the account: it is just not applied)
    if (body.invite) {
      try {
        this.applyInvite(id, body.invite);
      } catch {
        /* not applied */
      }
    }
    return { token: this.newToken(id), user: { id, nick } };
  }

  // ---------------------------------------------------------------- coins ---

  /** Coins to (or from) a driver, kept in the ledger. */
  private addCoins(userId: string, delta: number, reason: string): void {
    if (delta === 0) return;
    this.sql.exec('update users set coins = max(0, coins + ?) where id = ?', delta, userId);
    this.sql.exec('insert into coin_ledger (user_id, delta, reason, created_at) values (?, ?, ?, ?)', userId, delta, reason, Date.now());
  }

  /** My coins, the latest changes and my Driver Rating. */
  private wallet(token: string | null): { coins: number; rating: number; races: number; ledger: { delta: number; reason: string; at: number }[] } {
    const me = this.requireUser(token);
    const u = this.rows<{ coins: number; rating: number; races: number }>('select coins, rating, races from users where id = ?', me.id)[0];
    const ledger = this.rows<{ delta: number; reason: string; at: number }>(
      'select delta, reason, created_at as at from coin_ledger where user_id = ? order by id desc limit 20',
      me.id,
    );
    return { coins: u.coins, rating: u.rating, races: u.races, ledger };
  }

  /** A promotional code: once per account, while it lasts. */
  private redeem(token: string | null, body: Record<string, unknown>): { coins: number; added: number; what: string } {
    const me = this.requireUser(token);
    const code = normaliseCode(body.code);
    const c = this.rows<{ code: string; coins: number; what: string; max_uses: number | null; uses: number; expires_at: number | null }>(
      'select * from codes where code = ?',
      code,
    )[0];
    if (!c || (c.expires_at !== null && c.expires_at < Date.now()) || (c.max_uses !== null && c.uses >= c.max_uses))
      throw new HttpError(404, 'That code is not valid or has expired.');
    if (this.rows('select 1 from code_uses where code = ? and user_id = ?', code, me.id).length) throw new HttpError(409, 'You have used this code already.');
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('insert into code_uses (code, user_id, created_at) values (?, ?, ?)', code, me.id, Date.now());
      this.sql.exec('update codes set uses = uses + 1 where code = ?', code);
      this.addCoins(me.id, c.coins, `code ${code}`);
    });
    const coins = this.rows<{ coins: number }>('select coins from users where id = ?', me.id)[0].coins;
    return { coins, added: c.coins, what: c.what };
  }

  // -------------------------------------------------------------- invites ---

  /** My invite code (made the first time it is asked for) and how my invites are doing. */
  private invite(token: string | null): { code: string; invited: number; racing: number; inviteRaces: number; rewards: typeof COINS } {
    const me = this.requireUser(token);
    let code = this.rows<{ invite_code: string | null }>('select invite_code from users where id = ?', me.id)[0].invite_code;
    while (!code) {
      const c = newInviteCode((n) => crypto.getRandomValues(new Uint8Array(n)));
      if (!this.rows('select 1 from users where invite_code = ?', c).length) {
        this.sql.exec('update users set invite_code = ? where id = ?', c, me.id);
        code = c;
      }
    }
    const invited = this.rows<{ n: number }>('select count(*) as n from users where invited_by = ?', me.id)[0].n;
    const racing = this.rows<{ n: number }>('select count(*) as n from users where invited_by = ? and races >= ?', me.id, INVITE_RACES)[0].n;
    return { code, invited, racing, inviteRaces: INVITE_RACES, rewards: COINS };
  }

  /** Someone's invite code for a driver: in their first week, once, not their own. They get their coins now, the one
   * who invited them when they have raced INVITE_RACES times. */
  private applyInvite(userId: string, v: unknown): { ok: true; added: number } {
    const code = normaliseCode(v);
    const me = this.rows<{ invited_by: string | null; created_at: number; invite_code: string | null }>(
      'select invited_by, created_at, invite_code from users where id = ?',
      userId,
    )[0];
    if (!me) throw new HttpError(401, 'Sign in first.');
    if (me.invited_by) throw new HttpError(409, 'You have used an invite code already.');
    if (Date.now() - me.created_at > INVITE_WINDOW_MS) throw new HttpError(409, 'Invite codes work in your first week only.');
    const from = this.rows<{ id: string }>('select id from users where invite_code = ?', code)[0];
    if (!from) throw new HttpError(404, 'That invite code is not valid.');
    if (from.id === userId) throw new HttpError(400, 'That is your own code.');
    this.sql.exec('update users set invited_by = ? where id = ?', from.id, userId);
    this.addCoins(userId, COINS.invited, 'invited by a friend');
    return { ok: true, added: COINS.invited };
  }

  // -------------------------------------------------------------- ranking ---

  /** The ranking by Driver Rating: everyone, or me and my friends. My place in it either way. */
  private ranking(token: string | null, query: Record<string, string>): { rows: unknown[]; me: { rank: number; rating: number; races: number } | null } {
    const me = this.userOf(token);
    const friendsOnly = query.scope === 'friends';
    if (friendsOnly && !me) throw new HttpError(401, 'Sign in to see your friends.');
    const ids = friendsOnly && me ? [me.id, ...this.friendIdsOf(token).friends] : null;
    const where = ids ? `where id in (${ids.map(() => '?').join(',')})` : 'where races > 0';
    const rows = this.rows(
      `select nick, country, abbr, num, rating, races from users ${where} order by rating desc, races desc limit 100`,
      ...((ids ?? []) as SqlStorageValue[]),
    );
    let mine = null;
    if (me) {
      const r = this.rows<{ rating: number; races: number }>('select rating, races from users where id = ?', me.id)[0];
      const above = this.rows<{ n: number }>('select count(*) as n from users where races > 0 and rating > ?', r.rating)[0].n;
      mine = { rank: above + 1, rating: r.rating, races: r.races };
    }
    return { rows, me: mine };
  }

  private async login(body: Record<string, unknown>): Promise<{ token: string; user: AccountUser }> {
    const nick = checkNick(body.nick);
    const pw = checkPassword(body.password);
    const u = this.rows<{ id: string; nick: string; pass_hash: string; salt: string }>(
      'select id, nick, pass_hash, salt from users where nick_key = ?',
      nick.toLowerCase(),
    )[0];
    if (!u || !sameHash(await hashPassword(pw, u.salt), u.pass_hash)) throw new HttpError(401, 'Wrong nickname or password.');
    this.sql.exec('update users set last_seen = ? where id = ?', Date.now(), u.id);
    return { token: this.newToken(u.id), user: { id: u.id, nick: u.nick } };
  }

  /** A new password: signed in, the current one again. Every other device signed in as me is signed out (this one keeps
   * its token). */
  private async changePassword(token: string | null, body: Record<string, unknown>): Promise<void> {
    const me = this.requireUser(token);
    const pw = checkPassword(body.password);
    const next = checkPassword(body.newPassword);
    const u = this.rows<{ pass_hash: string; salt: string }>('select pass_hash, salt from users where id = ?', me.id)[0];
    if (!u || !sameHash(await hashPassword(pw, u.salt), u.pass_hash)) throw new HttpError(401, 'Wrong password.');
    const salt = randomHex(16);
    const hash = await hashPassword(next, salt);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('update users set pass_hash = ?, salt = ? where id = ?', hash, salt, me.id);
      this.sql.exec('delete from tokens where user_id = ? and token <> ?', me.id, token);
    });
  }

  /** Delete my account and everything of it (friends, laps, results): signed in, and the password again. */
  private async deleteAccount(token: string | null, body: Record<string, unknown>): Promise<void> {
    const me = this.requireUser(token);
    const pw = checkPassword(body.password);
    const u = this.rows<{ pass_hash: string; salt: string }>('select pass_hash, salt from users where id = ?', me.id)[0];
    if (!u || !sameHash(await hashPassword(pw, u.salt), u.pass_hash)) throw new HttpError(401, 'Wrong password.');
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('delete from tokens where user_id = ?', me.id);
      this.sql.exec('delete from friends where user_id = ?1 or friend_id = ?1', me.id);
      this.sql.exec('delete from laps where user_id = ?', me.id);
      this.sql.exec('delete from results where user_id = ?', me.id);
      this.sql.exec('delete from coin_ledger where user_id = ?', me.id);
      this.sql.exec('delete from code_uses where user_id = ?', me.id);
      this.sql.exec('update users set invited_by = null where invited_by = ?', me.id);
      this.sql.exec('delete from traces where user_id = ?', me.id);
      this.sql.exec('delete from users where id = ?', me.id);
    });
  }

  /** A finished online race: its coins, the Driver Rating, the race count, and the inviter's coins at the third race. */
  private payRace(userId: string, position: number, entrants: number, rated: boolean, now: number): void {
    const u = this.rows<{ last_race_day: number | null; races: number; invited_by: string | null; invite_paid: number }>(
      'select last_race_day, races, invited_by, invite_paid from users where id = ?',
      userId,
    )[0];
    if (!u) return;
    const first = u.last_race_day !== dayOf(now);
    const pay = coinsForResult(position, entrants, first);
    this.addCoins(userId, pay.coins, `race: ${pay.reasons.join(', ')} (P${position} of ${entrants})`);
    const d = rated ? ratingDelta(position, entrants) : 0;
    this.sql.exec('update users set races = races + 1, last_race_day = ?, rating = max(0, rating + ?) where id = ?', dayOf(now), d, userId);
    if (u.invited_by && !u.invite_paid && u.races + 1 >= INVITE_RACES) {
      this.sql.exec('update users set invite_paid = 1 where id = ?', userId);
      this.addCoins(u.invited_by, COINS.inviter, 'a friend you invited raced');
    }
  }

  /** Friends and requests (presence filled in by the Worker, from the DirectoryDO). */
  private friends(token: string | null): FriendEntry[] {
    const me = this.requireUser(token);
    const rows = this.rows<{
      id: string;
      nick: string;
      mine: string | null;
      theirs: string | null;
      last_seen: number | null;
      avatar: string | null;
      colour: string | null;
    }>(
      `select u.id as id, u.nick as nick, a.status as mine, b.status as theirs, u.last_seen as last_seen, u.avatar as avatar, u.colour as colour
       from users u
       left join friends a on a.user_id = ?1 and a.friend_id = u.id
       left join friends b on b.user_id = u.id and b.friend_id = ?1
       where u.id <> ?1 and (a.user_id is not null or b.user_id is not null)
       order by u.nick_key`,
      me.id,
    );
    return rows.map((r) => ({
      id: r.id,
      nick: r.nick,
      status: r.mine === 'accepted' && r.theirs === 'accepted' ? 'friend' : r.theirs === 'pending' ? 'incoming' : 'outgoing',
      presence: null,
      lastSeen: r.last_seen ?? null,
      avatar: r.avatar ?? null,
      colour: r.colour ?? null,
    }));
  }

  /** Ask someone (by nickname) to be friends; if they had asked you already, you are friends now. */
  private addFriend(token: string | null, body: Record<string, unknown>): void {
    const me = this.requireUser(token);
    const nick = checkNick(body.nick);
    const them = this.rows<{ id: string }>('select id from users where nick_key = ?', nick.toLowerCase())[0];
    if (!them) throw new HttpError(404, 'No player with that nickname.');
    if (them.id === me.id) throw new HttpError(400, "That's you.");
    const theirs = this.rows('select status from friends where user_id = ? and friend_id = ?', them.id, me.id)[0];
    const now = Date.now();
    if (theirs) {
      this.sql.exec(
        "insert into friends (user_id, friend_id, status, created_at) values (?, ?, 'accepted', ?) on conflict (user_id, friend_id) do update set status = 'accepted'",
        me.id,
        them.id,
        now,
      );
      this.sql.exec("update friends set status = 'accepted' where user_id = ? and friend_id = ?", them.id, me.id);
    } else
      this.sql.exec("insert into friends (user_id, friend_id, status, created_at) values (?, ?, 'pending', ?) on conflict do nothing", me.id, them.id, now);
  }

  private acceptFriend(token: string | null, body: Record<string, unknown>): void {
    const me = this.requireUser(token);
    const id = typeof body.id === 'string' ? body.id : '';
    if (!this.rows('select 1 from friends where user_id = ? and friend_id = ?', id, me.id).length) throw new HttpError(404, 'No such request.');
    this.sql.exec("update friends set status = 'accepted' where user_id = ? and friend_id = ?", id, me.id);
    this.sql.exec(
      "insert into friends (user_id, friend_id, status, created_at) values (?, ?, 'accepted', ?) on conflict (user_id, friend_id) do update set status = 'accepted'",
      me.id,
      id,
      Date.now(),
    );
  }

  /** Unfriend, cancel a request or decline one. */
  private removeFriend(token: string | null, body: Record<string, unknown>): void {
    const me = this.requireUser(token);
    const id = typeof body.id === 'string' ? body.id : '';
    this.sql.exec('delete from friends where (user_id = ?1 and friend_id = ?2) or (user_id = ?2 and friend_id = ?1)', me.id, id);
  }

  /**
   * The best lap per driver on a layout (each driver's best, then sorted): everyone, or me and my friends; one car or
   * any. Dry laps by default (a wet lap can't compete with a dry one).
   */
  private records(token: string | null, q: Record<string, string>): RecordRow[] {
    const track = q.track ?? '';
    const car = q.car || null;
    const scope = q.scope === 'friends' ? 'friends' : 'global';
    const wet = q.wet === '1' ? 1 : 0;
    const me = this.userOf(token);
    if (scope === 'friends' && !me) throw new HttpError(401, 'Sign in to see your friends.');
    const ids = scope === 'friends' && me ? [me.id, ...this.friendIdsOf(token).friends] : null;
    const rows = this.rows<{ user_id: string; nick: string; car_id: string; lap_ms: number; sectors: string; created_at: number; laps: number }>(
      `select user_id, nick, car_id, lap_ms, sectors, created_at, laps from (
         select l.user_id as user_id, u.nick as nick, l.car_id as car_id, l.lap_ms as lap_ms, l.sectors as sectors,
           l.created_at as created_at, count(*) over (partition by l.user_id) as laps,
           row_number() over (partition by l.user_id order by l.lap_ms) as rn
         from laps l join users u on u.id = l.user_id
         where l.track_id = ?1 and l.wet = ?2 and (?3 is null or l.car_id = ?3)
           and (?4 is null or l.user_id in (select value from json_each(?4)))
       ) where rn = 1 order by lap_ms limit 100`,
      track,
      wet,
      car,
      ids ? JSON.stringify(ids) : null,
    );
    return rows.map((r, i) => ({
      position: i + 1,
      userId: r.user_id,
      nick: r.nick,
      carId: r.car_id,
      lapMs: r.lap_ms,
      sectors: r.sectors ? r.sectors.split(',').map(Number) : [],
      at: r.created_at,
      laps: Number(r.laps),
      me: r.user_id === me?.id,
    }));
  }

  /** A driver's career: sessions, wins, podiums, laps, and their best lap on every layout. */
  private stats(token: string | null, q: Record<string, string>): UserStats {
    const me = this.userOf(token);
    const id = q.user || me?.id;
    if (!id) throw new HttpError(401, 'Sign in first.');
    const u = this.rows<{ nick: string; created_at: number }>('select nick, created_at from users where id = ?', id)[0];
    if (!u) throw new HttpError(404, 'No such player.');
    const r = this.rows<{ races: number; wins: number; podiums: number; quali: number; poles: number }>(
      `select coalesce(sum(session = 'race'), 0) as races,
         coalesce(sum(session = 'race' and position = 1), 0) as wins,
         coalesce(sum(session = 'race' and position <= 3), 0) as podiums,
         coalesce(sum(session = 'qualifying'), 0) as quali,
         coalesce(sum(session = 'qualifying' and position = 1), 0) as poles
       from results where user_id = ?`,
      id,
    )[0];
    const laps = this.rows<{ n: number }>('select count(*) as n from laps where user_id = ?', id)[0].n;
    const best = this.rows<{ track_id: string; car_id: string; lap_ms: number }>(
      `select track_id, car_id, lap_ms from (
         select track_id, car_id, lap_ms, row_number() over (partition by track_id order by lap_ms) as rn
         from laps where user_id = ? and wet = 0
       ) where rn = 1 order by track_id`,
      id,
    );
    return {
      nick: u.nick,
      since: u.created_at,
      races: r.races,
      wins: r.wins,
      podiums: r.podiums,
      qualifyings: r.quali,
      poles: r.poles,
      laps,
      best: best.map((b) => ({ trackId: b.track_id, carId: b.car_id, lapMs: b.lap_ms })),
    };
  }
}
