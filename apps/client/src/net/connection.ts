import {
  BIN_SERVER_RELAY,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  estimateOffset,
  makeSample,
  type ClientMsg,
  type ClockSample,
  type ServerMsg,
} from '@apex/shared';
import { SERVER_URL } from '../config';
import { getSession, setSession } from '../settings';
import { LocalSocket, isLocalCode } from './localRoom';

export type ConnState = 'connecting' | 'open' | 'reconnecting' | 'closed';

type Listener = (msg: ServerMsg) => void;
type BinListener = (buf: ArrayBuffer) => void;

export class RoomError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Creates a room on the server and returns its code. */
export async function createRoom(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/rooms`, { method: 'POST' });
  } catch {
    throw new RoomError('network', 'Cannot reach the game server. Check your connection.');
  }
  if (!res.ok) throw new RoomError('server', `Server error (${res.status}). Try again.`);
  const body = (await res.json()) as { code?: string };
  if (!body.code) throw new RoomError('server', 'Server returned no room code.');
  return body.code;
}

/**
 * WebSocket session with automatic reconnect (session token keeps the slot, car and race
 * progress for up to 30 s) and NTP-style clock sync.
 */
export class Connection {
  state: ConnState = 'connecting';
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private binListeners = new Set<BinListener>();
  private stateListeners = new Set<(s: ConnState) => void>();
  private samples: ClockSample[] = [];
  private offset = 0;
  rtt = 0;
  private pingTimer: number | null = null;
  private kaTimer: number | null = null;
  private reconnectStart = 0;
  private reconnectAttempt = 0;
  private closedByUser = false;
  private fatal = false;
  /** Bytes/packets for the perf overlay. */
  stats = { sent: 0, recv: 0, binRecv: 0, lastSeqGaps: 0 };
  private welcomed: (() => void) | null = null;
  /** State packets produced while disconnected; replayed after reconnect so no checkpoint is missed. */
  private backlog: ArrayBuffer[] = [];

  constructor(
    readonly code: string,
    private nick: string,
  ) {}

  /** Resolves on the first `welcome`, rejects with RoomError on fatal errors. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.welcomed = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const off = this.on((m) => {
        if (m.t === 'error' && m.fatal && !settled) {
          settled = true;
          off();
          reject(new RoomError(m.code, m.message));
        }
      });
      this.open();
      window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new RoomError('timeout', 'Connection timed out. The server may be unreachable.'));
          this.close();
        }
      }, 12_000);
    });
  }

  private url(): string {
    const base = SERVER_URL.replace(/^http/, 'ws');
    return `${base}/api/rooms/${encodeURIComponent(this.code)}/ws`;
  }

  private open(): void {
    // the offline room runs in this page (localRoom.ts): same protocol, no network
    const ws = isLocalCode(this.code) ? (new LocalSocket() as unknown as WebSocket) : new WebSocket(this.url());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.sendJson({ t: 'hello', v: PROTOCOL_VERSION, nick: this.nick, session: getSession(this.code) });
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        this.stats.recv++;
        if (e.data === 'ka') return;
        let msg: ServerMsg;
        try {
          msg = JSON.parse(e.data) as ServerMsg;
        } catch {
          return;
        }
        this.onJson(msg);
      } else {
        this.stats.binRecv++;
        const buf = e.data as ArrayBuffer;
        if (new Uint8Array(buf)[0] === BIN_SERVER_RELAY) for (const l of this.binListeners) l(buf);
      }
    };
    ws.onclose = () => {
      this.stopTimers();
      if (this.closedByUser || this.fatal) {
        this.setState('closed');
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private onJson(msg: ServerMsg): void {
    if (msg.t === 'welcome') {
      setSession(this.code, msg.session);
      this.flushBacklog();
      this.offset = msg.serverTime - Date.now();
      this.samples = [];
      this.setState('open');
      this.startTimers();
      this.welcomed?.();
    } else if (msg.t === 'pong') {
      const now = performance.now();
      this.samples.push(makeSample(msg.c, msg.s, now));
      if (this.samples.length > 16) this.samples.shift();
      const est = estimateOffset(this.samples);
      this.offset = est.offset;
      this.rtt = est.rtt;
      return;
    } else if (msg.t === 'error' && msg.fatal) {
      this.fatal = true;
      if (msg.code === 'room_not_found' || msg.code === 'kicked') setSession(this.code, null);
    }
    for (const l of this.listeners) l(msg);
  }

  private startTimers(): void {
    this.stopTimers();
    // burst of samples for a quick initial estimate, then a slow refresh
    let burst = 0;
    const ping = () => {
      this.sendJson({ t: 'ping', c: performance.now() });
      burst++;
      this.pingTimer = window.setTimeout(ping, burst < 8 ? 200 : 3000);
    };
    ping();
    this.kaTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ka');
    }, 20_000);
  }

  private stopTimers(): void {
    if (this.pingTimer !== null) clearTimeout(this.pingTimer);
    if (this.kaTimer !== null) clearInterval(this.kaTimer);
    this.pingTimer = this.kaTimer = null;
  }

  /** Re-run a quick clock sync (e.g. after the tab was hidden). */
  resync(): void {
    if (this.state === 'open') {
      this.samples = [];
      this.startTimers();
    } else if (this.state === 'reconnecting' && this.ws?.readyState !== WebSocket.CONNECTING) {
      this.open();
    }
  }

  private scheduleReconnect(): void {
    if (this.state !== 'reconnecting') {
      this.reconnectStart = Date.now();
      this.setState('reconnecting');
    }
    if (Date.now() - this.reconnectStart > RECONNECT_GRACE_MS) {
      this.setState('closed');
      for (const l of this.listeners) l({ t: 'error', code: 'kicked', message: 'Connection lost for too long. You were removed from the room.', fatal: true });
      return;
    }
    const delay = Math.min(4000, 400 * 2 ** this.reconnectAttempt++);
    window.setTimeout(() => {
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private setState(s: ConnState): void {
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }

  /** Current server time estimate (ms). */
  serverNow(): number {
    return performance.now() + this.offsetPerf();
  }

  private offsetPerf(): number {
    // `offset` from pongs is relative to performance.now(); the welcome estimate is Date-based
    return this.samples.length ? this.offset : this.offset + (Date.now() - performance.now());
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onBinary(l: BinListener): () => void {
    this.binListeners.add(l);
    return () => this.binListeners.delete(l);
  }

  onState(l: (s: ConnState) => void): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }

  sendJson(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      this.stats.sent++;
    }
  }

  sendBinary(buf: ArrayBuffer, length: number): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.state === 'open' && this.backlog.length === 0) {
      this.ws.send(length === buf.byteLength ? buf : buf.slice(0, length));
      this.stats.sent++;
    } else if (this.state === 'reconnecting' || this.state === 'connecting' || this.backlog.length) {
      this.backlog.push(buf.slice(0, length));
      if (this.backlog.length > 400) this.backlog.shift(); // ~40 s at 10 packets/s
    }
  }

  private flushBacklog(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const b of this.backlog) this.ws.send(b);
    this.stats.sent += this.backlog.length;
    this.backlog = [];
  }

  close(): void {
    this.closedByUser = true;
    this.stopTimers();
    this.ws?.close(1000, 'bye');
    this.setState('closed');
  }

  leave(): void {
    this.sendJson({ t: 'leave' });
    setSession(this.code, null);
    this.close();
  }
}
