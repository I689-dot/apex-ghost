/**
 * Cloudflare Worker entry + Durable Object adapter.
 *   POST /api/rooms          → create a room, returns { code }
 *   GET  /api/rooms          → public rooms (the room list before joining), from the DirectoryDO
 *   GET  /api/rooms/:code/ws → WebSocket into the room's Durable Object
 *   GET  /health
 *   /api/account/register|login|logout|me, /api/friends[/add|accept|remove], /api/presence, /api/records, /api/stats
 *       → accounts.ts (Supabase Postgres, DATABASE_URL secret); presence lives in the DirectoryDO
 * One Durable Object per room (idFromName(code)); WebSocket Hibernation API.
 */
import { DurableObject } from 'cloudflare:workers';
import { generateRoomCode, normalizeRoomCode, type RoomSummary, type TrackRaceData } from '@apex/shared';
import trackRace from '@apex/shared/generated/track-race.json';
import tracksRace from '@apex/shared/generated/tracks-race.json';
import carIdList from '@apex/shared/generated/car-ids.json';
import { isPresence, type Presence } from '@apex/shared';
import { RoomCore, type Conn, type PersistedRoom, type RecordEvent } from './room';
import * as acc from './accounts';

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  DIRECTORY: DurableObjectNamespace<DirectoryDO>;
  /** The accounts database (wrangler secret / .dev.vars); without it accounts are off. */
  DATABASE_URL?: string;
}

const TRACK = trackRace as unknown as TrackRaceData;
/** Every layout the host can choose (validation data per track id). */
const TRACKS = tracksRace as unknown as Record<string, TrackRaceData>;
const CAR_IDS: ReadonlySet<string> | null = (carIdList as string[]).length ? new Set(carIdList as string[]) : null;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const directory = (env: Env) => env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));

/** Accounts, friends, presence and records (accounts.ts). */
async function accountApi(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  const sql = acc.db(env);
  if (!sql) return json({ error: 'Accounts are not available on this server.' }, 503);
  try {
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const q = new URL(req.url).searchParams;
    const presence = async (ids: string[]): Promise<Record<string, Presence>> => {
      const r = await directory(env).fetch('https://directory/presence-of', { method: 'POST', body: JSON.stringify({ ids }) });
      return (await r.json()) as Record<string, Presence>;
    };
    switch (`${req.method} ${path}`) {
      case 'POST register':
        return json(await acc.register(sql, body), 201);
      case 'POST login':
        return json(await acc.login(sql, body));
      case 'POST logout':
        await acc.logout(sql, req);
        return json({ ok: true });
      case 'GET me': {
        const u = await acc.userOf(sql, req);
        return u ? json({ user: u }) : json({ error: 'Sign in first.' }, 401);
      }
      case 'GET friends':
        return json({ friends: await acc.friends(sql, req, presence) });
      case 'POST friends/add':
        await acc.addFriend(sql, req, body);
        return json({ ok: true });
      case 'POST friends/accept':
        await acc.acceptFriend(sql, req, body);
        return json({ ok: true });
      case 'POST friends/remove':
        await acc.removeFriend(sql, req, body);
        return json({ ok: true });
      case 'POST presence': {
        // a heartbeat: where I am now (kept in memory by the directory, ~90 s)
        const u = await acc.presenceUser(sql, req);
        if (!u) return json({ error: 'Sign in first.' }, 401);
        if (!isPresence(body.presence)) return json({ error: 'Bad presence.' }, 400);
        await directory(env).fetch('https://directory/presence', { method: 'POST', body: JSON.stringify({ id: u.id, presence: body.presence }) });
        return json({ ok: true });
      }
      case 'GET records':
        return json({ rows: await acc.records(sql, req, q) });
      case 'GET stats':
        return json({ stats: await acc.stats(sql, req, q) });
      default:
        return json({ error: 'Not found' }, 404);
    }
  } catch (e) {
    if (e instanceof acc.HttpError) return json({ error: e.message }, e.status);
    console.error('[accounts]', e);
    return json({ error: 'Account server error, try again.' }, 500);
  } finally {
    ctx.waitUntil(sql.end({ timeout: 2 }));
  }
}

/**
 * Online play is for signed-in drivers only (offline play needs no server): creating a room and connecting to one
 * need an account token, so strangers can't use up the free plan's requests. Without an accounts database (local
 * development) anyone may play.
 */
async function mayPlayOnline(req: Request, env: Env, ctx: ExecutionContext, token: string | null): Promise<boolean> {
  const sql = acc.db(env);
  if (!sql) return true;
  try {
    const auth = token ? new Request(req.url, { headers: { Authorization: `Bearer ${token}` } }) : req;
    return (await acc.userOf(sql, auth)) !== null;
  } catch (e) {
    console.error('[accounts]', e);
    return false;
  } finally {
    ctx.waitUntil(sql.end({ timeout: 2 }));
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/health') return json({ ok: true });
    const am = url.pathname.match(/^\/api\/(?:account\/)?(register|login|logout|me|friends(?:\/add|\/accept|\/remove)?|presence|records|stats)$/);
    if (am) return accountApi(req, env, ctx, am[1]);

    if (url.pathname === '/api/rooms' && req.method === 'GET') {
      const res = await env.DIRECTORY.get(env.DIRECTORY.idFromName('directory')).fetch('https://directory/list');
      return json(await res.json());
    }

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (!(await mayPlayOnline(req, env, ctx, null))) return json({ error: 'Sign in to play online.' }, 401);
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateRoomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch(`https://room/init?code=${code}`, { method: 'POST' });
        if (res.status === 201) return json({ code }, 201);
      }
      return json({ error: 'Could not allocate a room code, try again.' }, 503);
    }

    const m = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (m) {
      const code = normalizeRoomCode(decodeURIComponent(m[1]));
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected WebSocket' }, 426);
      if (!code) {
        // Accept and immediately explain, since browsers hide HTTP errors on WS handshakes.
        const pair = new WebSocketPair();
        pair[1].accept();
        pair[1].send(JSON.stringify({ t: 'error', code: 'room_not_found', message: 'Invalid room code.', fatal: true }));
        pair[1].close(4000, 'room_not_found');
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      if (!(await mayPlayOnline(req, env, ctx, url.searchParams.get('t')))) {
        const pair = new WebSocketPair();
        pair[1].accept();
        pair[1].send(JSON.stringify({ t: 'error', code: 'sign_in', message: 'Sign in to play online.', fatal: true }));
        pair[1].close(4001, 'sign_in');
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(req);
    }
    return json({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  cid: string;
  pid: string | null;
  /** A spectator's socket (survives hibernation like a player's). */
  spec?: boolean;
}

export class RoomDO extends DurableObject<Env> {
  private core: RoomCore;
  private conns = new Map<WebSocket, Conn>();
  private nextCid = 1;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = this.makeCore();
    // Keepalive pings are answered without waking the object (no duration billed).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ka', 'ka'));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<PersistedRoom>('room');
      if (saved) this.core.restore(saved);
      for (const ws of ctx.getWebSockets()) {
        const att = ws.deserializeAttachment() as Attachment | null;
        const conn = this.wrap(ws, att?.cid ?? `c${this.nextCid++}`);
        if (att?.pid) this.core.reattach(conn, att.pid);
        else if (att?.spec) this.core.spectators.set(conn.id, conn);
      }
    });
  }

  private makeCore(): RoomCore {
    return new RoomCore({
      now: () => Date.now(),
      random: () => {
        const a = new Uint32Array(1);
        crypto.getRandomValues(a);
        return a[0] / 4294967296;
      },
      schedule: (at) => {
        void this.ctx.storage.getAlarm().then((cur) => {
          if (cur === null || at < cur) return this.ctx.storage.setAlarm(at);
        });
      },
      persist: (s) => {
        void this.ctx.storage.put('room', s);
      },
      report: (summary) => {
        const code = this.core?.code;
        if (!code) return;
        const dir = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('directory'));
        this.ctx.waitUntil(
          dir.fetch('https://directory/report', { method: 'POST', body: JSON.stringify({ code, summary }) }).then(
            () => undefined,
            () => undefined,
          ),
        );
      },
      track: TRACK,
      tracks: TRACKS,
      carIds: CAR_IDS,
      record: (e) => this.record(e),
    });
  }

  /** Signed-in drivers' laps and results: batched, written to the accounts database after the message. */
  private records: RecordEvent[] = [];
  private record(e: RecordEvent): void {
    this.records.push(e);
    if (this.records.length > 1) return;
    this.ctx.waitUntil(
      (async () => {
        await Promise.resolve();
        const batch = this.records;
        this.records = [];
        const sql = acc.db(this.env);
        if (!sql) return;
        try {
          await acc.writeRecords(sql, batch);
        } catch (err) {
          console.error('[records]', err);
        } finally {
          await sql.end({ timeout: 2 });
        }
      })(),
    );
  }

  private wrap(ws: WebSocket, cid: string): Conn {
    const conn: Conn = {
      id: cid,
      send: (d) => {
        try {
          ws.send(d);
        } catch {
          /* socket already closing */
        }
      },
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          /* ignore */
        }
      },
    };
    this.conns.set(ws, conn);
    return conn;
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init' && req.method === 'POST') {
      const code = url.searchParams.get('code') ?? '';
      return new Response(null, { status: this.core.init(code) ? 201 : 409 });
    }
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      const cid = `c${Date.now().toString(36)}${this.nextCid++}`;
      server.serializeAttachment({ cid, pid: null } satisfies Attachment);
      this.wrap(server, cid);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('Not found', { status: 404 });
  }

  private connFor(ws: WebSocket): Conn {
    return this.conns.get(ws) ?? this.wrap(ws, (ws.deserializeAttachment() as Attachment | null)?.cid ?? `c${this.nextCid++}`);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = this.connFor(ws);
    this.core.onMessage(conn, message);
    // remember which player owns this socket so it survives hibernation
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att && att.pid === null && !att.spec && typeof message === 'string') {
      if (this.core.spectators.has(conn.id)) ws.serializeAttachment({ cid: att.cid, pid: null, spec: true } satisfies Attachment);
      for (const p of this.core.players.values()) {
        if (p.conn === conn) {
          ws.serializeAttachment({ cid: att.cid, pid: p.id } satisfies Attachment);
          break;
        }
      }
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const conn = this.connFor(ws);
    this.conns.delete(ws);
    this.core.onClose(conn);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  override async alarm(): Promise<void> {
    const next = this.core.tick();
    if (next !== null) await this.ctx.storage.setAlarm(next);
    if (!this.core.created && this.core.players.size === 0) await this.ctx.storage.deleteAll();
  }
}

/**
 * The public room list: rooms report their summary when it changes (RoomCore.report); the menu reads it with
 * GET /api/rooms. Entries silent for 6 h are dropped (a room that vanished without saying so).
 */
export class DirectoryDO extends DurableObject<Env> {
  private rooms: Map<string, RoomSummary> | null = null;
  /** Signed-in players' presence (heartbeats). Also in storage: an idle object is evicted within seconds, and a
   * map kept only in memory lost everyone's presence between two friends' requests. */
  private presence = new Map<string, Presence>();

  private async load(): Promise<Map<string, RoomSummary>> {
    if (!this.rooms) this.rooms = new Map(Object.entries((await this.ctx.storage.get<Record<string, RoomSummary>>('rooms')) ?? {}));
    return this.rooms;
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const rooms = await this.load();
    const now = Date.now();
    for (const [code, r] of rooms) if (now - r.updatedAt > 6 * 3600_000) rooms.delete(code);
    if (url.pathname === '/report' && req.method === 'POST') {
      const { code, summary } = (await req.json()) as { code: string; summary: RoomSummary | null };
      if (summary) rooms.set(code, summary);
      else rooms.delete(code);
      await this.ctx.storage.put('rooms', Object.fromEntries(rooms));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/presence' && req.method === 'POST') {
      const { id, presence } = (await req.json()) as { id: string; presence: Omit<Presence, 'at'> };
      const p = { ...presence, at: now };
      this.presence.set(id, p);
      await this.ctx.storage.put(`p:${id}`, p);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/presence-of' && req.method === 'POST') {
      const { ids } = (await req.json()) as { ids: string[] };
      const missing = ids.filter((id) => !this.presence.has(id)).slice(0, 128);
      if (missing.length) for (const [k, v] of await this.ctx.storage.get<Presence>(missing.map((id) => `p:${id}`))) this.presence.set(k.slice(2), v);
      const out: Record<string, Presence> = {};
      const stale: string[] = [];
      for (const id of ids) {
        const p = this.presence.get(id);
        if (p && now - p.at < 90_000) out[id] = p;
        else if (p) {
          this.presence.delete(id);
          stale.push(`p:${id}`);
        }
      }
      if (stale.length) await this.ctx.storage.delete(stale);
      return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/list') {
      const list = [...rooms.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
      return new Response(JSON.stringify({ rooms: list }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Not found', { status: 404 });
  }
}
