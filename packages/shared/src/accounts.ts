/** Accounts, friends and records: what the server's account API (apps/server/src/accounts.ts) sends. */

export interface AccountUser {
  id: string;
  nick: string;
  /** Driver profile (as iRacing's member profile and F1's driver card): country (ISO 3166 alpha-2), car number 1-999,
   * three-letter code for timing screens, helmet colour. */
  country?: string | null;
  num?: number | null;
  abbr?: string | null;
  colour?: string | null;
}

/** A profile field check shared by the server and the profile form. */
export const PROFILE_RE = { country: /^[A-Z]{2}$/, abbr: /^[A-Z]{3}$/, colour: /^#[0-9a-fA-F]{6}$/ };

/** Where a signed-in player is right now (heartbeats, ~45 s; gone after 90 s without one). */
export interface Presence {
  state: 'menu' | 'lobby' | 'racing' | 'watching';
  /** The room they are in (lobby / racing / watching), to join or watch. */
  room: string | null;
  trackId: string | null;
  /** In a session: which one. */
  session: 'practice' | 'qualifying' | 'race' | null;
  at: number;
}

export interface FriendEntry {
  id: string;
  nick: string;
  /** friend: accepted both ways; incoming: they asked you; outgoing: you asked them. */
  status: 'friend' | 'incoming' | 'outgoing';
  /** Friends only, and only while online. */
  presence: Presence | null;
  lastSeen: number | null;
}

export interface RecordRow {
  position: number;
  userId: string;
  nick: string;
  carId: string;
  lapMs: number;
  sectors: number[];
  /** When the lap was set (ms since epoch). */
  at: number;
  /** Timed laps this driver has on this layout. */
  laps: number;
  me: boolean;
}

export interface UserStats {
  nick: string;
  since: number;
  races: number;
  wins: number;
  podiums: number;
  qualifyings: number;
  poles: number;
  laps: number;
  /** Best dry lap per layout. */
  best: { trackId: string; carId: string; lapMs: number }[];
}

export function isPresence(v: unknown): v is Omit<Presence, 'at'> {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  const s = (x: unknown) => x === null || (typeof x === 'string' && x.length <= 64);
  return (
    ['menu', 'lobby', 'racing', 'watching'].includes(p.state as string) &&
    s(p.room) &&
    s(p.trackId) &&
    (p.session === null || ['practice', 'qualifying', 'race'].includes(p.session as string))
  );
}
