/**
 * Accounts, friends and records (Supabase Postgres, schema `apex`: db/schema.sql).
 *  - A nickname and a password, nothing else (no e-mail, no verification, as asked). Passwords are hashed in the
 *    database (pgcrypto bcrypt): the Worker's CPU budget per request is ~10 ms on the free plan, too little for a
 *    password hash of its own. Signing in returns a random token, sent back as `Authorization: Bearer …`.
 *  - Friends: a request is a pending row from the asker; accepting adds the reverse row. Presence (online, in a
 *    lobby, racing, watching, and in which room) is live state, not data: it lives in the DirectoryDO's memory and
 *    expires 90 s after the last heartbeat.
 *  - Records: laps and results are written by the game server (RoomDO, from its own lap logic: clients never report
 *    times), so a leaderboard can't be typed in.
 * One connection per request (Workers can't keep them), closed after the response.
 */
import postgres from 'postgres';
import { NICK_MAX, NICK_MIN, type AccountUser, type FriendEntry, type Presence, type RecordRow, type UserStats } from '@apex/shared';
import type { RecordEvent } from './room';

export interface AccountsEnv {
  DATABASE_URL?: string;
}

type Sql = ReturnType<typeof postgres>;

export function db(env: AccountsEnv): Sql | null {
  if (!env.DATABASE_URL) return null;
  return postgres(env.DATABASE_URL, { prepare: false, max: 1, fetch_types: false, idle_timeout: 5, connect_timeout: 8, onnotice: () => {} });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const NICK_RE = /^[\p{L}\p{N} _.-]+$/u;

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

function newToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** The signed-in user of a request (null: not signed in or an unknown token). */
export async function userOf(sql: Sql, req: Request): Promise<AccountUser | null> {
  const token = req.headers.get('Authorization')?.match(/^Bearer ([0-9a-f]{48})$/)?.[1];
  if (!token) return null;
  const rows = await sql<AccountUser[]>`select u.id, u.nick from apex.tokens t join apex.users u on u.id = t.user_id where t.token = ${token}`;
  return rows[0] ?? null;
}

async function requireUser(sql: Sql, req: Request): Promise<AccountUser> {
  const u = await userOf(sql, req);
  if (!u) throw new HttpError(401, 'Sign in first.');
  return u;
}

export async function register(sql: Sql, body: { nick?: unknown; password?: unknown }): Promise<{ token: string; user: AccountUser }> {
  const nick = checkNick(body.nick);
  const pw = checkPassword(body.password);
  const rows = await sql<AccountUser[]>`
    insert into apex.users (nick, nick_key, pass_hash) values (${nick}, ${nick.toLowerCase()}, crypt(${pw}, gen_salt('bf', 8)))
    on conflict (nick_key) do nothing returning id, nick`;
  if (!rows[0]) throw new HttpError(409, 'That nickname is taken.');
  const token = newToken();
  await sql`insert into apex.tokens (token, user_id) values (${token}, ${rows[0].id})`;
  return { token, user: rows[0] };
}

export async function login(sql: Sql, body: { nick?: unknown; password?: unknown }): Promise<{ token: string; user: AccountUser }> {
  const nick = checkNick(body.nick);
  const pw = checkPassword(body.password);
  const rows = await sql<AccountUser[]>`select id, nick from apex.users where nick_key = ${nick.toLowerCase()} and pass_hash = crypt(${pw}, pass_hash)`;
  if (!rows[0]) throw new HttpError(401, 'Wrong nickname or password.');
  const token = newToken();
  await sql`insert into apex.tokens (token, user_id) values (${token}, ${rows[0].id})`;
  await sql`update apex.users set last_seen = now() where id = ${rows[0].id}`;
  return { token, user: rows[0] };
}

export async function logout(sql: Sql, req: Request): Promise<void> {
  const token = req.headers.get('Authorization')?.match(/^Bearer ([0-9a-f]{48})$/)?.[1];
  if (token) await sql`delete from apex.tokens where token = ${token}`;
}

/** Friends and requests, with their presence (from the DirectoryDO). */
export async function friends(sql: Sql, req: Request, presence: (ids: string[]) => Promise<Record<string, Presence>>): Promise<FriendEntry[]> {
  const me = await requireUser(sql, req);
  const rows = await sql<{ id: string; nick: string; mine: string | null; theirs: string | null; last_seen: Date | null }[]>`
    select u.id, u.nick, a.status as mine, b.status as theirs, u.last_seen
    from apex.users u
    left join apex.friends a on a.user_id = ${me.id} and a.friend_id = u.id
    left join apex.friends b on b.user_id = u.id and b.friend_id = ${me.id}
    where u.id <> ${me.id} and (a.user_id is not null or b.user_id is not null)
    order by u.nick_key`;
  const accepted = rows.filter((r) => r.mine === 'accepted' && r.theirs === 'accepted').map((r) => r.id);
  const pres = accepted.length ? await presence(accepted) : {};
  return rows.map((r) => ({
    id: r.id,
    nick: r.nick,
    status: r.mine === 'accepted' && r.theirs === 'accepted' ? 'friend' : r.theirs === 'pending' ? 'incoming' : 'outgoing',
    presence: pres[r.id] ?? null,
    lastSeen: r.last_seen ? r.last_seen.getTime() : null,
  }));
}

/** Ask someone (by nickname) to be friends; if they had asked you already, you are friends now. */
export async function addFriend(sql: Sql, req: Request, body: { nick?: unknown }): Promise<void> {
  const me = await requireUser(sql, req);
  const nick = checkNick(body.nick);
  const them = (await sql<{ id: string }[]>`select id from apex.users where nick_key = ${nick.toLowerCase()}`)[0];
  if (!them) throw new HttpError(404, 'No player with that nickname.');
  if (them.id === me.id) throw new HttpError(400, "That's you.");
  const theirs = (await sql<{ status: string }[]>`select status from apex.friends where user_id = ${them.id} and friend_id = ${me.id}`)[0];
  if (theirs) {
    await sql`insert into apex.friends (user_id, friend_id, status) values (${me.id}, ${them.id}, 'accepted')
      on conflict (user_id, friend_id) do update set status = 'accepted'`;
    await sql`update apex.friends set status = 'accepted' where user_id = ${them.id} and friend_id = ${me.id}`;
  } else await sql`insert into apex.friends (user_id, friend_id, status) values (${me.id}, ${them.id}, 'pending') on conflict do nothing`;
}

export async function acceptFriend(sql: Sql, req: Request, body: { id?: unknown }): Promise<void> {
  const me = await requireUser(sql, req);
  const id = typeof body.id === 'string' ? body.id : '';
  const r = await sql`update apex.friends set status = 'accepted' where user_id = ${id} and friend_id = ${me.id} returning user_id`;
  if (!r.length) throw new HttpError(404, 'No such request.');
  await sql`insert into apex.friends (user_id, friend_id, status) values (${me.id}, ${id}, 'accepted') on conflict (user_id, friend_id) do update set status = 'accepted'`;
}

/** Unfriend, cancel a request or decline one. */
export async function removeFriend(sql: Sql, req: Request, body: { id?: unknown }): Promise<void> {
  const me = await requireUser(sql, req);
  const id = typeof body.id === 'string' ? body.id : '';
  await sql`delete from apex.friends where (user_id = ${me.id} and friend_id = ${id}) or (user_id = ${id} and friend_id = ${me.id})`;
}

/** The accepted friends' ids of a user (whom their presence is shown to). */
export async function friendIds(sql: Sql, userId: string): Promise<string[]> {
  return (await sql<{ friend_id: string }[]>`select friend_id from apex.friends where user_id = ${userId} and status = 'accepted'`).map((r) => r.friend_id);
}

/**
 * The best lap per driver on a layout (each driver's best, then sorted): everyone, or me and my friends; one car or
 * any. Dry laps by default (a wet lap can't compete with a dry one).
 */
export async function records(sql: Sql, req: Request, q: URLSearchParams): Promise<RecordRow[]> {
  const track = q.get('track') ?? '';
  const car = q.get('car') || null;
  const scope = q.get('scope') === 'friends' ? 'friends' : 'global';
  const wet = q.get('wet') === '1';
  const me = await userOf(sql, req);
  if (scope === 'friends' && !me) throw new HttpError(401, 'Sign in to see your friends.');
  const ids = scope === 'friends' && me ? pgArray([me.id, ...(await friendIds(sql, me.id))]) : null;
  const rows = await sql<{ user_id: string; nick: string; car_id: string; lap_ms: number; sectors: string; created_at: Date; laps: number }[]>`
    select * from (
      select distinct on (l.user_id) l.user_id, u.nick, l.car_id, l.lap_ms, array_to_string(l.sectors, ',') as sectors, l.created_at,
        count(*) over (partition by l.user_id) as laps
      from apex.laps l join apex.users u on u.id = l.user_id
      where l.track_id = ${track} and l.wet = ${wet}
        and (${car}::text is null or l.car_id = ${car})
        and (${ids}::uuid[] is null or l.user_id = any(${ids}::uuid[]))
      order by l.user_id, l.lap_ms
    ) best order by lap_ms limit 100`;
  return rows.map((r, i) => ({
    position: i + 1,
    userId: r.user_id,
    nick: r.nick,
    carId: r.car_id,
    lapMs: r.lap_ms,
    sectors: r.sectors ? r.sectors.split(',').map(Number) : [],
    at: r.created_at.getTime(),
    laps: Number(r.laps),
    me: r.user_id === me?.id,
  }));
}

/** A driver's career: sessions, wins, podiums, laps, and their best lap on every layout. */
export async function stats(sql: Sql, req: Request, q: URLSearchParams): Promise<UserStats> {
  const me = await userOf(sql, req);
  const id = q.get('user') || me?.id;
  if (!id) throw new HttpError(401, 'Sign in first.');
  const u = (await sql<{ nick: string; created_at: Date }[]>`select nick, created_at from apex.users where id = ${id}`)[0];
  if (!u) throw new HttpError(404, 'No such player.');
  const [r] = await sql<{ races: number; wins: number; podiums: number; quali: number; poles: number }[]>`
    select count(*) filter (where session = 'race')::int as races,
      count(*) filter (where session = 'race' and position = 1)::int as wins,
      count(*) filter (where session = 'race' and position <= 3)::int as podiums,
      count(*) filter (where session = 'qualifying')::int as quali,
      count(*) filter (where session = 'qualifying' and position = 1)::int as poles
    from apex.results where user_id = ${id}`;
  const [l] = await sql<{ laps: number }[]>`select count(*)::int as laps from apex.laps where user_id = ${id}`;
  const best = await sql<{ track_id: string; car_id: string; lap_ms: number }[]>`
    select distinct on (track_id) track_id, car_id, lap_ms from apex.laps where user_id = ${id} and not wet order by track_id, lap_ms`;
  return {
    nick: u.nick,
    since: u.created_at.getTime(),
    races: r.races,
    wins: r.wins,
    podiums: r.podiums,
    qualifyings: r.quali,
    poles: r.poles,
    laps: l.laps,
    best: best.map((b) => ({ trackId: b.track_id, carId: b.car_id, lapMs: b.lap_ms })),
  };
}

/** Write the game server's records (signed-in drivers only: a token that matches nobody writes nothing). */
export async function writeRecords(sql: Sql, events: RecordEvent[]): Promise<void> {
  for (const e of events) {
    if (e.kind === 'lap')
      await sql`insert into apex.laps (user_id, track_id, car_id, lap_ms, sectors, session, wet)
        select user_id, ${e.trackId}, ${e.carId}, ${Math.round(e.lapMs)}, ${pgArray(e.sectors.map(Math.round))}::integer[], ${e.session}, ${e.wet} from apex.tokens where token = ${e.token}`;
    else
      await sql`insert into apex.results (user_id, track_id, car_id, session, position, entrants, best_lap_ms, total_ms)
        select user_id, ${e.trackId}, ${e.carId}, ${e.session}, ${e.position}, ${e.entrants}, ${e.bestLapMs}, ${e.totalMs} from apex.tokens where token = ${e.token}`;
  }
}

/**
 * A Postgres array literal ('{a,b}'): with type fetching off (one connection per request) the driver can't send JS
 * arrays as array parameters ("malformed array literal"). Only numbers and uuids go through here.
 */
function pgArray(v: (number | string)[]): string {
  return `{${v.map((x) => (typeof x === 'number' ? String(x) : x.replace(/[^0-9a-f-]/gi, ''))).join(',')}}`;
}

/** The user ids behind tokens (presence heartbeats carry a token). */
export async function presenceUser(sql: Sql, req: Request): Promise<AccountUser | null> {
  const u = await userOf(sql, req);
  if (u) await sql`update apex.users set last_seen = now() where id = ${u.id}`;
  return u;
}
