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
import { NICK_MAX, NICK_MIN, type AccountUser, type FriendEntry, type RecordRow, type UserStats } from '@apex/shared';
import type { RecordEvent } from './room';

export type AccountOp =
  'register' | 'login' | 'logout' | 'me' | 'friends' | 'friends/add' | 'friends/accept' | 'friends/remove' | 'presence' | 'records' | 'stats';

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
`;

type Row = Record<string, SqlStorageValue>;

export class AccountsDO extends DurableObject<Record<string, never>> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
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
        case 'me': {
          const u = this.userOf(token);
          return u ? { status: 200, body: { user: u } } : { status: 401, body: { error: 'Sign in first.' } };
        }
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
        case 'stats':
          return { status: 200, body: { stats: this.stats(token, query) } };
        default:
          return { status: 404, body: { error: 'Not found' } };
      }
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      console.error('[accounts]', e);
      return { status: 500, body: { error: 'Account server error, try again.' } };
    }
  }

  /** The signed-in user of a token (null: not signed in or unknown). */
  userOf(token: string | null): AccountUser | null {
    if (!token || !/^[0-9a-f]{48}$/.test(token)) return null;
    return this.rows<AccountUser>('select u.id as id, u.nick as nick from tokens t join users u on u.id = t.user_id where t.token = ?', token)[0] ?? null;
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
    for (const e of events) {
      const u = this.userOf(e.token);
      if (!u) continue;
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
    return { token: this.newToken(id), user: { id, nick } };
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

  /** Friends and requests (presence filled in by the Worker, from the DirectoryDO). */
  private friends(token: string | null): FriendEntry[] {
    const me = this.requireUser(token);
    const rows = this.rows<{ id: string; nick: string; mine: string | null; theirs: string | null; last_seen: number | null }>(
      `select u.id as id, u.nick as nick, a.status as mine, b.status as theirs, u.last_seen as last_seen
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
