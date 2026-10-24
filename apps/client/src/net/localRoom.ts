import type { TrackRaceData } from '@apex/shared';
import { RoomCore, type Conn } from '../../../server/src/room';
import { loadCarsFile, loadTrackFile, loadTrackIndex } from '../game/assets';

/** Room code of the offline room. */
export const LOCAL_CODE = 'SOLO1';

/**
 * Offline play: the server's own room logic (RoomCore: lobby, briefing, lap timing, penalties, bots) running in
 * the browser, so a session alone or with AI cars makes no network requests and costs no Cloudflare requests.
 * The client talks to it through LocalSocket, which behaves like the WebSocket it replaces.
 */
let room: RoomCore | null = null;
let timer = 0;

export function isLocalCode(code: string): boolean {
  return code === LOCAL_CODE;
}

export async function createLocalRoom(): Promise<string> {
  const index = await loadTrackIndex();
  const tracks: Record<string, TrackRaceData> = {};
  for (const e of index) {
    const t = await loadTrackFile(e.id);
    tracks[t.id] = {
      id: t.id,
      name: t.name,
      length: t.length,
      centerline: t.centerline,
      cumS: t.cumS,
      gates: t.gates,
      sectorGates: t.sectorGates,
      firstGate: t.firstGate,
      minLapMs: t.minLapMs,
      pitExitS: t.pitLane?.exitS ?? null,
      pitEntryS: t.pitLane?.entryS ?? null,
      pitLaneM: t.pitLane?.length ?? null,
    };
  }
  const def = index.find((e) => e.default)?.id ?? Object.keys(tracks)[0];
  const cars = await loadCarsFile();
  clearTimeout(timer);
  const r = new RoomCore({
    now: () => Date.now(),
    random: Math.random,
    schedule: (at) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => r.tick(), Math.max(0, at - Date.now()));
    },
    persist: () => {},
    track: tracks[def],
    tracks,
    carIds: new Set(cars.cars.filter((c) => c.role !== 'safety').map((c) => c.id)),
  });
  r.init(LOCAL_CODE);
  room = r;
  return LOCAL_CODE;
}

let nextId = 0;

/** A WebSocket look-alike connected to the in-browser room. */
export class LocalSocket {
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly conn: Conn;

  constructor() {
    const id = `local-${nextId++}`;
    this.conn = {
      id,
      // async like a real socket: the room may send while it is still handling our message
      send: (data) => queueMicrotask(() => this.readyState === 1 && this.onmessage?.({ data })),
      close: () => this.shut(),
    };
    queueMicrotask(() => {
      if (!room) {
        this.shut();
        return;
      }
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== 1 || !room) return;
    // keepalive: answered by Cloudflare before the room sees it online; here, the same
    if (data === 'ka') {
      this.conn.send('ka');
      return;
    }
    room.onMessage(this.conn, data);
  }

  close(): void {
    if (this.readyState === 3) return;
    room?.onClose(this.conn);
    this.shut();
  }

  private shut(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}
