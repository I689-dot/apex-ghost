import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@apex/shared';
import type { Conn } from '../../../server/src/room';
import { SERVER_URL } from '../config';
import { createLocalRoom, localRoom } from './localRoom';

/**
 * Races hosted on a device (a phone at a friend's house, a laptop at a LAN): the host's browser runs the room
 * itself, as offline play does (RoomCore), and the other players connect straight to it over WebRTC data channels.
 * The game server only relays each connection's offer and answer once (apps/server/src/signal.ts); on one Wi-Fi
 * network the race then stays on it (direct host candidates), the host at no latency at all, as in a LAN game.
 * One reliable, ordered channel per player: the room's messages need their order, and on a LAN it costs nothing.
 */
const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const api = (code: string, path = '') => `${SERVER_URL}/api/p2p/${code}${path}`;

/** Waits until the connection has gathered its candidates (they go in the one offer / answer), at most 3 s. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === 'complete') resolve();
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 3000);
  });
}

/** Codes found to be hosted on a device (the connection then uses a data channel, not the server). */
const p2pCodes = new Set<string>();

export function isKnownP2p(code: string): boolean {
  return p2pCodes.has(code);
}

/** Is this room code a race hosted on a device right now? */
export async function isP2pCode(code: string): Promise<boolean> {
  try {
    const r = await fetch(api(code));
    const yes = r.ok && ((await r.json()) as { hosted?: boolean }).hosted === true;
    if (yes) p2pCodes.add(code);
    return yes;
  } catch {
    return false;
  }
}

let hosting: { code: string; timer: number; peers: Set<RTCPeerConnection> } | null = null;

/** Hosts a race on this device: the room here, a code the other players join with. Returns the code. */
export async function hostRace(): Promise<string> {
  stopHosting();
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  const r = await fetch(api(code, '/host'), { method: 'POST' });
  if (!r.ok) throw new Error('Cannot reach the game server to share the code. Check your connection.');
  await createLocalRoom(code);
  const h = { code, timer: 0, peers: new Set<RTCPeerConnection>() };
  hosting = h;
  const seen = new Set<string>();
  const poll = async () => {
    if (hosting !== h) return;
    try {
      const res = await fetch(api(code, '/offers'));
      const { offers } = (await res.json()) as { offers: { id: string; sdp: string }[] };
      for (const o of offers)
        if (!seen.has(o.id)) {
          seen.add(o.id);
          void accept(code, o.id, o.sdp, h.peers);
        }
    } catch {
      /* the next poll */
    }
    if (hosting === h) h.timer = window.setTimeout(poll, 1000);
  };
  void poll();
  return code;
}

export function stopHosting(): void {
  if (!hosting) return;
  clearTimeout(hosting.timer);
  for (const pc of hosting.peers) pc.close();
  hosting = null;
}

/** A guest's offer: answered, and its data channel becomes a connection to the room here. */
async function accept(code: string, id: string, sdp: string, peers: Set<RTCPeerConnection>): Promise<void> {
  const pc = new RTCPeerConnection(ICE);
  peers.add(pc);
  pc.ondatachannel = (e) => {
    const dc = e.channel;
    dc.binaryType = 'arraybuffer';
    const conn: Conn = {
      id: `p2p-${id}`,
      send: (data) => {
        if (dc.readyState === 'open') dc.send(data as string);
      },
      close: () => pc.close(),
    };
    dc.onmessage = (m) => {
      // keepalive: answered here, as the server's edge answers it online
      if (m.data === 'ka') return conn.send('ka');
      localRoom()?.onMessage(conn, m.data as string | ArrayBuffer);
    };
    dc.onclose = () => {
      localRoom()?.onClose(conn);
      peers.delete(pc);
    };
  };
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  await fetch(api(code, '/answer'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, sdp: pc.localDescription?.sdp ?? '' }),
  });
}

/** A WebSocket look-alike over a data channel to the device hosting the race (the guest's side). */
export class P2pSocket {
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private pc = new RTCPeerConnection(ICE);
  private dc: RTCDataChannel;

  constructor(code: string) {
    this.dc = this.pc.createDataChannel('race', { ordered: true });
    this.dc.binaryType = 'arraybuffer';
    this.dc.onopen = () => {
      this.readyState = 1;
      this.onopen?.();
    };
    this.dc.onmessage = (e) => this.onmessage?.({ data: e.data as string | ArrayBuffer });
    this.dc.onclose = () => this.shut();
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') {
        this.onerror?.();
        this.shut();
      }
    };
    void this.connect(code).catch(() => {
      this.onerror?.();
      this.shut();
    });
  }

  private async connect(code: string): Promise<void> {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    const r = await fetch(api(code, '/offer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: this.pc.localDescription?.sdp ?? '' }),
    });
    if (!r.ok) throw new Error('not hosted');
    const { id } = (await r.json()) as { id: string };
    for (let i = 0; i < 40 && this.readyState !== 3; i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      const a = await fetch(api(code, `/answer/${id}`));
      if (a.status === 204) continue;
      if (!a.ok) throw new Error('no answer');
      const { sdp } = (await a.json()) as { sdp: string };
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
      return;
    }
    throw new Error('the host did not answer');
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState === 1 && this.dc.readyState === 'open') this.dc.send(data as string);
  }

  close(): void {
    this.dc.close();
    this.pc.close();
    this.shut();
  }

  private shut(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}
