/**
 * A solo championship (ACC's and F1's single-player championships): a set of rounds on different circuits against
 * the same AI drivers, qualifying then a race each, points for the top ten as in F1 (25-18-15-12-10-8-6-4-2-1, one
 * for the fastest lap in the top ten). Kept in this browser between rounds; the table after each race.
 */
export interface ChampDriver {
  nick: string;
  carId: string | null;
  points: number;
  wins: number;
  podiums: number;
  /** Finishing positions, round by round (0: no finish). */
  results: number[];
}

export interface Championship {
  /** Layout ids, in order. */
  rounds: string[];
  /** Rounds already raced. */
  done: number;
  raceLaps: number;
  qualiMinutes: number;
  bots: number;
  drivers: Record<string, ChampDriver>;
  /** The race id last scored (a results screen shown twice scores once). */
  lastScored: string;
}

export const CHAMP_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const KEY = 'apexghost.championship';

export function loadChampionship(): Championship | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Championship) : null;
  } catch {
    return null;
  }
}

export function saveChampionship(c: Championship | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the championship lasts this visit */
  }
}

export function newChampionship(rounds: string[], raceLaps: number, qualiMinutes: number, bots: number): Championship {
  return { rounds, done: 0, raceLaps, qualiMinutes, bots, drivers: {}, lastScored: '' };
}

/** Scores a race: `order` is the classification (nick, car, classified), `fastest` the fastest lap's nick. */
export function scoreRace(
  c: Championship,
  raceKey: string,
  order: { nick: string; carId: string | null; classified: boolean }[],
  fastest: string | null,
): void {
  if (c.lastScored === raceKey) return;
  c.lastScored = raceKey;
  const round = c.done;
  order.forEach((r, i) => {
    const d = (c.drivers[r.nick] ??= { nick: r.nick, carId: r.carId, points: 0, wins: 0, podiums: 0, results: [] });
    d.carId = r.carId ?? d.carId;
    const pos = r.classified ? i + 1 : 0;
    d.results[round] = pos;
    if (pos > 0 && pos <= CHAMP_POINTS.length) d.points += CHAMP_POINTS[pos - 1];
    if (pos === 1) d.wins++;
    if (pos > 0 && pos <= 3) d.podiums++;
    if (r.nick === fastest && pos > 0 && pos <= 10) d.points += 1;
  });
  c.done++;
}

/** The table: points, then wins, then best results (count-back), as the FIA ties are broken. */
export function standings(c: Championship): ChampDriver[] {
  return Object.values(c.drivers).sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || a.nick.localeCompare(b.nick));
}
