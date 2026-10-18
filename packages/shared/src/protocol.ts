import { MAX_PLAYERS, PROTOCOL_VERSION } from './constants';
import type { PenaltyReason, Standing } from './race';
import { WEATHER_KINDS, type ChangeChoice, type TimeChoice, type WeatherChoice } from './weather';
import type { WeatherPlan } from './weather';
import { isRecord } from './validation';

/* ------------------------------------------------------------------ lobby --- */

/** briefing: the host started; everyone sees the final conditions and sets up their car (BRIEFING_MS). */
export type Phase = 'lobby' | 'briefing' | 'loading' | 'countdown' | 'racing' | 'results';

export interface PlayerInfo {
  id: string;
  nick: string;
  carId: string | null;
  ready: boolean;
  host: boolean;
  connected: boolean;
  /** Joined while a race was running; races next time. */
  waiting: boolean;
  /** AI driver simulated by the host's browser. */
  bot: boolean;
  /** Tyres chosen for the start (shown in the lobby). */
  tyre: TyreChoice;
  /** Done with the briefing (car set up). */
  briefed: boolean;
}

export type TyreChoice = 'soft' | 'medium' | 'hard' | 'wet';

/** What the host sets up before the session (all clients compute the same forecast from it). */
export interface Conditions {
  trackId: string;
  weather: WeatherChoice;
  time: TimeChoice;
  changes: ChangeChoice;
  /** Seed of the forecast: rolled again with "new forecast". */
  seed: number;
}

export interface RoomSnapshot {
  code: string;
  phase: Phase;
  players: PlayerInfo[];
  /** carId → playerId */
  carLocks: Record<string, string>;
  raceId: number;
  /** Qualifying session length chosen by the host. */
  sessionMinutes: number;
  conditions: Conditions;
  /** Briefing phase: when it ends (server time). */
  briefingUntil: number | null;
}

export interface RaceSetup {
  raceId: number;
  seed: number;
  weather: WeatherPlan;
  /** playerId per grid slot (index = slot). */
  grid: string[];
  /** Compact numeric slot per player used in binary packets. */
  slots: Record<string, number>;
  /** Session length: the chequered flag falls at startAt + sessionMs. */
  sessionMs: number;
  /** Layout (tracks.json id). */
  trackId: string;
}

export interface RaceResultRow {
  id: string;
  nick: string;
  carId: string | null;
  position: number;
  totalMs: number | null;
  bestLapMs: number | null;
  /** Gap to the fastest lap of the session. */
  gapMs: number | null;
  validLaps: number;
  dnf: boolean;
  penaltyMs: number;
}

export type ErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'race_in_progress'
  | 'nick_taken'
  | 'nick_invalid'
  | 'car_taken'
  | 'not_host'
  | 'not_ready'
  | 'bad_message'
  | 'version_mismatch'
  | 'kicked';

/* ------------------------------------------------------ client → server --- */

export type ClientMsg =
  | { t: 'hello'; v: number; nick: string; session: string | null }
  | { t: 'selectCar'; carId: string | null }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'briefed' }
  | { t: 'loaded'; raceId: number }
  | { t: 'ping'; c: number }
  | { t: 'damage'; zones: number[] }
  | { t: 'leave' }
  | { t: 'addBot' }
  | { t: 'removeBot'; id: string }
  | { t: 'setSession'; minutes: number }
  /** Host: track, weather, time, changes; reroll = new forecast. */
  | { t: 'setConditions'; trackId?: string; weather?: WeatherChoice; time?: TimeChoice; changes?: ChangeChoice; reroll?: boolean }
  | { t: 'setTyre'; tyre: TyreChoice }
  /** Pit stop: into the garage (in: true) and back out (in: false). */
  | { t: 'pit'; in: boolean };

/* ------------------------------------------------------ server → client --- */

export type ServerMsg =
  | { t: 'welcome'; you: string; session: string; room: RoomSnapshot; serverTime: number; race: RaceSetup | null; startAt: number | null }
  | { t: 'room'; room: RoomSnapshot }
  | { t: 'error'; code: ErrorCode; message: string; fatal: boolean }
  | { t: 'carLock'; ok: boolean; carId: string | null; owner: string | null }
  | { t: 'raceSetup'; race: RaceSetup }
  | { t: 'countdown'; raceId: number; startAt: number }
  | { t: 'standings'; raceId: number; list: Standing[]; finishDeadline: number | null }
  | { t: 'lap'; playerId: string; lap: number; lapMs: number; penaltyMs: number; sectors: number[]; best: boolean; valid: boolean; outLap: boolean }
  | { t: 'penalty'; playerId: string; reason: PenaltyReason; ms: number; lapPenaltyMs: number }
  | { t: 'flag'; raceId: number }
  | { t: 'pit'; playerId: string; in: boolean }
  | { t: 'sector'; playerId: string; sector: number; ms: number }
  | { t: 'finished'; playerId: string; totalMs: number }
  | { t: 'results'; raceId: number; rows: RaceResultRow[]; fastestLap: { id: string; ms: number } | null }
  | { t: 'damage'; playerId: string; zones: number[] }
  | { t: 'pong'; c: number; s: number };

const str = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Strict validation of untrusted client JSON. Returns null for anything malformed. */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > 2048) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(v) || typeof v.t !== 'string') return null;
  switch (v.t) {
    case 'hello':
      return num(v.v) && str(v.nick, 64) && (v.session === null || str(v.session, 64)) ? { t: 'hello', v: v.v, nick: v.nick, session: v.session } : null;
    case 'selectCar':
      return v.carId === null || str(v.carId, 64) ? { t: 'selectCar', carId: v.carId } : null;
    case 'ready':
      return typeof v.ready === 'boolean' ? { t: 'ready', ready: v.ready } : null;
    case 'start':
      return { t: 'start' };
    case 'briefed':
      return { t: 'briefed' };
    case 'loaded':
      return num(v.raceId) ? { t: 'loaded', raceId: v.raceId } : null;
    case 'ping':
      return num(v.c) ? { t: 'ping', c: v.c } : null;
    case 'damage':
      return Array.isArray(v.zones) && v.zones.length === 6 && v.zones.every((z) => num(z) && z >= 0 && z <= 1)
        ? { t: 'damage', zones: v.zones as number[] }
        : null;
    case 'leave':
      return { t: 'leave' };
    case 'addBot':
      return { t: 'addBot' };
    case 'removeBot':
      return str(v.id, 32) ? { t: 'removeBot', id: v.id } : null;
    case 'setSession':
      return num(v.minutes) && Number.isInteger(v.minutes) && v.minutes >= 1 && v.minutes <= 60 ? { t: 'setSession', minutes: v.minutes } : null;
    case 'pit':
      return typeof v.in === 'boolean' ? { t: 'pit', in: v.in } : null;
    case 'setTyre':
      return v.tyre === 'soft' || v.tyre === 'medium' || v.tyre === 'hard' || v.tyre === 'wet' ? { t: 'setTyre', tyre: v.tyre } : null;
    case 'setConditions': {
      const out: Extract<ClientMsg, { t: 'setConditions' }> = { t: 'setConditions' };
      if (v.trackId !== undefined) {
        if (!str(v.trackId, 64)) return null;
        out.trackId = v.trackId;
      }
      if (v.weather !== undefined) {
        if (!(v.weather === 'random' || (WEATHER_KINDS as readonly unknown[]).includes(v.weather))) return null;
        out.weather = v.weather as WeatherChoice;
      }
      if (v.time !== undefined) {
        if (!['random', 'dawn', 'morning', 'midday', 'afternoon', 'evening', 'night'].includes(v.time as string)) return null;
        out.time = v.time as TimeChoice;
      }
      if (v.changes !== undefined) {
        if (!['random', 'off', 'on'].includes(v.changes as string)) return null;
        out.changes = v.changes as ChangeChoice;
      }
      if (v.reroll === true) out.reroll = true;
      return out;
    }
    default:
      return null;
  }
}

export function encodeJson(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export { PROTOCOL_VERSION, MAX_PLAYERS };

/* --------------------------------------------------------- binary state --- */

export const BIN_CLIENT_STATE = 1;
export const BIN_SERVER_RELAY = 2;
/** Host → server: states of a bot it simulates. Same layout as a relay packet (type, slot, count, seq, states). */
export const BIN_BOT_STATE = 3;

export const FLAG_BRAKE = 1;
export const FLAG_HEADLIGHTS = 2;
export const FLAG_REVERSE = 4;
export const FLAG_RESET = 8;
export const FLAG_HANDBRAKE = 16;
export const FLAG_SMOKE = 32;
/** All four wheels beyond the track limits (grass, gravel, sand): the lap is invalid. */
export const FLAG_OFF_TRACK = 64;

/** One car state sample. Reused objects; never allocate per frame. */
export interface CarState {
  /** Server-clock time in ms (full precision in memory, 32-bit on the wire). */
  t: number;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  /** Front wheel steer angle, radians. */
  steer: number;
  /** Wheel rotation angles front/rear axle, radians. */
  rotF: number;
  rotR: number;
  /** Suspension compression per wheel FL, FR, RL, RR (m, 0..0.2). */
  susp: [number, number, number, number];
  flags: number;
}

export function makeCarState(): CarState {
  return {
    t: 0,
    px: 0,
    py: 0,
    pz: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    wx: 0,
    wy: 0,
    wz: 0,
    steer: 0,
    rotF: 0,
    rotR: 0,
    susp: [0, 0, 0, 0],
    flags: 0,
  };
}

export function copyCarState(dst: CarState, src: CarState): CarState {
  dst.t = src.t;
  dst.px = src.px;
  dst.py = src.py;
  dst.pz = src.pz;
  dst.qx = src.qx;
  dst.qy = src.qy;
  dst.qz = src.qz;
  dst.qw = src.qw;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
  dst.wx = src.wx;
  dst.wy = src.wy;
  dst.wz = src.wz;
  dst.steer = src.steer;
  dst.rotF = src.rotF;
  dst.rotR = src.rotR;
  dst.susp[0] = src.susp[0];
  dst.susp[1] = src.susp[1];
  dst.susp[2] = src.susp[2];
  dst.susp[3] = src.susp[3];
  dst.flags = src.flags;
  return dst;
}

/** Bytes per encoded sample. */
export const STATE_BYTES = 4 + 9 + 4 + 6 + 6 + 1 + 2 + 4 + 1;
/** Header: type u8, count u8, seq u16. Relay header additionally has slot u8. */
export const CLIENT_HEADER = 4;
export const RELAY_HEADER = 5;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const TWO_PI = Math.PI * 2;
const SQRT1_2 = Math.SQRT1_2;

function writeI24(dv: DataView, o: number, v: number): void {
  const x = clamp(Math.round(v), -8388608, 8388607) & 0xffffff;
  dv.setUint8(o, x & 0xff);
  dv.setUint8(o + 1, (x >> 8) & 0xff);
  dv.setUint8(o + 2, (x >> 16) & 0xff);
}

function readI24(dv: DataView, o: number): number {
  const x = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16);
  return x & 0x800000 ? x - 0x1000000 : x;
}

/** Smallest-three quaternion compression: 2-bit index + 3 × 10-bit components. */
export function packQuat(qx: number, qy: number, qz: number, qw: number): number {
  const ax = Math.abs(qx);
  const ay = Math.abs(qy);
  const az = Math.abs(qz);
  const aw = Math.abs(qw);
  let idx = 0;
  let max = ax;
  if (ay > max) {
    max = ay;
    idx = 1;
  }
  if (az > max) {
    max = az;
    idx = 2;
  }
  if (aw > max) {
    idx = 3;
  }
  const c = [qx, qy, qz, qw];
  const sign = c[idx] < 0 ? -1 : 1;
  let packed = idx;
  for (let i = 0; i < 4; i++) {
    if (i === idx) continue;
    const v = clamp((c[i] * sign) / SQRT1_2, -1, 1);
    packed = (packed << 10) | Math.round((v * 0.5 + 0.5) * 1023);
  }
  return packed >>> 0;
}

export function unpackQuat(packed: number, out: { qx: number; qy: number; qz: number; qw: number }): void {
  const idx = (packed >>> 30) & 3;
  const vals = [0, 0, 0];
  for (let k = 2; k >= 0; k--) {
    vals[k] = (((packed >>> ((2 - k) * 10)) & 1023) / 1023 - 0.5) * 2 * SQRT1_2;
  }
  const rest = Math.sqrt(Math.max(0, 1 - vals[0] * vals[0] - vals[1] * vals[1] - vals[2] * vals[2]));
  const c = [0, 0, 0, 0];
  let k = 0;
  for (let i = 0; i < 4; i++) c[i] = i === idx ? rest : vals[k++];
  out.qx = c[0];
  out.qy = c[1];
  out.qz = c[2];
  out.qw = c[3];
}

function writeState(dv: DataView, o: number, s: CarState): number {
  dv.setUint32(o, s.t >>> 0, true);
  o += 4;
  writeI24(dv, o, s.px * 1000);
  writeI24(dv, o + 3, s.py * 1000);
  writeI24(dv, o + 6, s.pz * 1000);
  o += 9;
  dv.setUint32(o, packQuat(s.qx, s.qy, s.qz, s.qw), true);
  o += 4;
  dv.setInt16(o, clamp(Math.round(s.vx * 100), -32768, 32767), true);
  dv.setInt16(o + 2, clamp(Math.round(s.vy * 100), -32768, 32767), true);
  dv.setInt16(o + 4, clamp(Math.round(s.vz * 100), -32768, 32767), true);
  o += 6;
  dv.setInt16(o, clamp(Math.round(s.wx * 1000), -32768, 32767), true);
  dv.setInt16(o + 2, clamp(Math.round(s.wy * 1000), -32768, 32767), true);
  dv.setInt16(o + 4, clamp(Math.round(s.wz * 1000), -32768, 32767), true);
  o += 6;
  dv.setInt8(o, clamp(Math.round((s.steer / 0.7) * 127), -127, 127));
  o += 1;
  const rf = ((s.rotF % TWO_PI) + TWO_PI) % TWO_PI;
  const rr = ((s.rotR % TWO_PI) + TWO_PI) % TWO_PI;
  dv.setUint8(o, Math.round((rf / TWO_PI) * 255) & 255);
  dv.setUint8(o + 1, Math.round((rr / TWO_PI) * 255) & 255);
  o += 2;
  for (let i = 0; i < 4; i++) dv.setUint8(o + i, clamp(Math.round((s.susp[i] / 0.25) * 255), 0, 255));
  o += 4;
  dv.setUint8(o, s.flags & 255);
  return o + 1;
}

function readState(dv: DataView, o: number, s: CarState, timeBase: number): number {
  const t32 = dv.getUint32(o, true);
  // re-expand 32-bit ms to full time using the receiver's notion of "now"
  const base = timeBase - (timeBase % 4294967296);
  let t = base + t32;
  if (t - timeBase > 2147483648) t -= 4294967296;
  else if (timeBase - t > 2147483648) t += 4294967296;
  s.t = t;
  o += 4;
  s.px = readI24(dv, o) / 1000;
  s.py = readI24(dv, o + 3) / 1000;
  s.pz = readI24(dv, o + 6) / 1000;
  o += 9;
  unpackQuat(dv.getUint32(o, true), s);
  o += 4;
  s.vx = dv.getInt16(o, true) / 100;
  s.vy = dv.getInt16(o + 2, true) / 100;
  s.vz = dv.getInt16(o + 4, true) / 100;
  o += 6;
  s.wx = dv.getInt16(o, true) / 1000;
  s.wy = dv.getInt16(o + 2, true) / 1000;
  s.wz = dv.getInt16(o + 4, true) / 1000;
  o += 6;
  s.steer = (dv.getInt8(o) / 127) * 0.7;
  o += 1;
  s.rotF = (dv.getUint8(o) / 255) * TWO_PI;
  s.rotR = (dv.getUint8(o + 1) / 255) * TWO_PI;
  o += 2;
  for (let i = 0; i < 4; i++) s.susp[i] = (dv.getUint8(o + i) / 255) * 0.25;
  o += 4;
  s.flags = dv.getUint8(o);
  return o + 1;
}

/** Encode `count` states into `buf` (must be ≥ CLIENT_HEADER + count*STATE_BYTES). Returns byte length. */
export function encodeClientStates(buf: ArrayBuffer, seq: number, states: readonly CarState[], count: number): number {
  const dv = new DataView(buf);
  dv.setUint8(0, BIN_CLIENT_STATE);
  dv.setUint8(1, count);
  dv.setUint16(2, seq & 0xffff, true);
  let o = CLIENT_HEADER;
  for (let i = 0; i < count; i++) o = writeState(dv, o, states[i]);
  return o;
}

export interface DecodedPacket {
  seq: number;
  count: number;
  slot: number;
}

/** Validates a client packet. Returns sample count, or -1 when malformed. */
export function validateClientPacket(buf: ArrayBuffer): number {
  if (buf.byteLength < CLIENT_HEADER) return -1;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== BIN_CLIENT_STATE) return -1;
  const count = dv.getUint8(1);
  if (count < 1 || count > 4) return -1;
  if (buf.byteLength !== CLIENT_HEADER + count * STATE_BYTES) return -1;
  return count;
}

/** Decode a client packet's states (server side, for race validation). */
export function decodeClientStates(buf: ArrayBuffer, out: CarState[], timeBase: number): DecodedPacket | null {
  const count = validateClientPacket(buf);
  if (count < 0) return null;
  const dv = new DataView(buf);
  let o = CLIENT_HEADER;
  for (let i = 0; i < count; i++) o = readState(dv, o, out[i], timeBase);
  return { seq: dv.getUint16(2, true), count, slot: -1 };
}

/** Server: wrap a validated client packet for relay, adding the sender's slot. */
export function makeRelayPacket(clientBuf: ArrayBuffer, slot: number): ArrayBuffer {
  const src = new Uint8Array(clientBuf);
  const out = new Uint8Array(src.length + 1);
  out[0] = BIN_SERVER_RELAY;
  out[1] = slot;
  out.set(src.subarray(1), 2); // count, seq, states
  return out.buffer;
}

/** Host: encode bot states (relay layout with type BIN_BOT_STATE). Returns byte length. */
export function encodeBotStates(buf: ArrayBuffer, slot: number, seq: number, states: readonly CarState[], count: number): number {
  const dv = new DataView(buf);
  dv.setUint8(0, BIN_BOT_STATE);
  dv.setUint8(1, slot);
  dv.setUint8(2, count);
  dv.setUint16(3, seq & 0xffff, true);
  let o = RELAY_HEADER;
  for (let i = 0; i < count; i++) o = writeState(dv, o, states[i]);
  return o;
}

/** Server: decode a bot packet (validated). */
export function decodeBotStates(buf: ArrayBuffer, out: CarState[], timeBase: number): DecodedPacket | null {
  if (buf.byteLength < RELAY_HEADER) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== BIN_BOT_STATE) return null;
  const slot = dv.getUint8(1);
  const count = dv.getUint8(2);
  if (count < 1 || count > 4 || buf.byteLength !== RELAY_HEADER + count * STATE_BYTES) return null;
  const seq = dv.getUint16(3, true);
  let o = RELAY_HEADER;
  for (let i = 0; i < count; i++) o = readState(dv, o, out[i], timeBase);
  return { seq, count, slot };
}

/** Server: turn a validated bot packet into a relay packet. */
export function botToRelay(buf: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(buf.slice(0));
  out[0] = BIN_SERVER_RELAY;
  return out.buffer;
}

/** Client: decode a relayed packet. */
export function decodeRelay(buf: ArrayBuffer, out: CarState[], timeBase: number): DecodedPacket | null {
  if (buf.byteLength < RELAY_HEADER) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== BIN_SERVER_RELAY) return null;
  const slot = dv.getUint8(1);
  const count = dv.getUint8(2);
  if (count < 1 || count > 4 || buf.byteLength !== RELAY_HEADER + count * STATE_BYTES) return null;
  const seq = dv.getUint16(3, true);
  let o = RELAY_HEADER;
  for (let i = 0; i < count; i++) o = readState(dv, o, out[i], timeBase);
  return { seq, count, slot };
}
