/**
 * What this browser remembers between visits, beyond the career totals (career.ts): the last sessions you drove
 * (the "recent results" of iRacing's and Gran Turismo's profile pages) and the drivers you raced against (the
 * consoles' "recent players", to add them as friends afterwards).
 */
export interface SessionRecord {
  at: number;
  kind: 'practice' | 'qualifying' | 'race';
  trackId: string;
  carId: string | null;
  /** Finishing position (0: not classified) out of `field`. */
  position: number;
  field: number;
  bestLapMs: number | null;
  /** Online room or solo. */
  online: boolean;
}

export interface RecentPlayer {
  nick: string;
  at: number;
  trackId: string;
  country: string | null;
}

const HIST = 'apexghost.history.v1';
const RECENT = 'apexghost.recentPlayers.v1';
const MAX_HIST = 40;
const MAX_RECENT = 30;

function read<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: nothing kept */
  }
}

export function loadHistory(): SessionRecord[] {
  return read<SessionRecord>(HIST);
}

export function addHistory(r: SessionRecord): void {
  write(HIST, [r, ...loadHistory()].slice(0, MAX_HIST));
}

export function loadRecentPlayers(): RecentPlayer[] {
  return read<RecentPlayer>(RECENT);
}

/** The humans of a session (not bots, not you), newest first, each once. */
export function addRecentPlayers(players: { nick: string; country?: string | null }[], trackId: string): void {
  const now = Date.now();
  const fresh = players.map((p) => ({ nick: p.nick, at: now, trackId, country: p.country ?? null }));
  const seen = new Set(fresh.map((p) => p.nick.toLowerCase()));
  write(RECENT, [...fresh, ...loadRecentPlayers().filter((p) => !seen.has(p.nick.toLowerCase()))].slice(0, MAX_RECENT));
}

/** The car you drove most in the sessions remembered (the profile's "favourite car"). */
export function favouriteCar(h: SessionRecord[]): string | null {
  const n = new Map<string, number>();
  for (const r of h) if (r.carId) n.set(r.carId, (n.get(r.carId) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [k, v] of n)
    if (v > most) {
      best = k;
      most = v;
    }
  return best;
}
