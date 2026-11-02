/**
 * The solo career, after the games' progression: experience and driver levels (Forza, Gran Turismo) and an iRacing
 * licence with its Safety Rating. iRacing's rules, scaled down to a game: a Safety Rating starts at 2.50 in Rookie
 * and moves with the corners driven per incident point (off track 1x, a wall 2x, contact or a reset 4x); Rookie is
 * promoted at 3.00 (iRacing's fast track), the other classes at 4.00, a promotion costs 1.00 of rating; a rating
 * below 1.00 drops the licence a class (iRacing demotes below 2.00 at a season's end). Kept in this browser.
 */
export const LICENCES = ['R', 'D', 'C', 'B', 'A', 'P'] as const;
export type Licence = (typeof LICENCES)[number];
export const LICENCE_NAME: Record<Licence, string> = { R: 'Rookie', D: 'Class D', C: 'Class C', B: 'Class B', A: 'Class A', P: 'Pro' };
export const LICENCE_COLOUR: Record<Licence, string> = { R: '#d63a3a', D: '#f08a24', C: '#e8c21b', B: '#36b04a', A: '#2f7de1', P: '#1b1d22' };

export interface Career {
  xp: number;
  licence: Licence;
  sr: number;
  sessions: number;
  races: number;
  wins: number;
  podiums: number;
  poles: number;
  km: number;
  cleanLaps: number;
  /** Coins (the games' credits) and the cars bought with them. */
  coins: number;
  owned: string[];
  /** The day (YYYY-MM-DD) the daily bonus was last given. */
  daily: string;
}

/** What a session gave: the driving, its incidents and the result. */
export interface SessionStats {
  kind: 'practice' | 'qualifying' | 'race';
  km: number;
  laps: number;
  cleanLaps: number;
  corners: number;
  /** Incident points (iRacing's x): off track 1, wall 2, contact or reset 4. */
  incidents: number;
  personalBests: number;
  /** The AI's difficulty when it was raced (× the coins). */
  difficulty?: number;
  /** Final position (0: none) and the field, the start position (races). */
  position: number;
  field: number;
  start: number;
}

export interface CareerGain {
  xp: number;
  lines: [string, number][];
  coins: number;
  coinLines: [string, number][];
  levelBefore: number;
  levelAfter: number;
  licenceBefore: Licence;
  licenceAfter: Licence;
  srBefore: number;
  srAfter: number;
}

const KEY = 'apexghost.career';
const START: Career = {
  xp: 0,
  licence: 'R',
  sr: 2.5,
  sessions: 0,
  races: 0,
  wins: 0,
  podiums: 0,
  poles: 0,
  km: 0,
  cleanLaps: 0,
  coins: 100_000,
  owned: [],
  daily: '',
};

export function loadCareer(): Career {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...START, ...(JSON.parse(raw) as Partial<Career>) } : { ...START };
  } catch {
    return { ...START };
  }
}

function saveCareer(c: Career): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* private mode: this visit only */
  }
}

/** XP a level needs: 500 for the first, 250 more for each one after. */
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let need = 500;
  let left = xp;
  while (left >= need) {
    left -= need;
    level++;
    need += 250;
  }
  return { level, into: left, need };
}

/**
 * The session's Safety Rating change: clean corners raise it slowly, incidents take it down; ~100 corners per
 * incident point is neutral (iRacing's "corners per incident" sets the target the same way).
 */
export function srDelta(corners: number, incidents: number): number {
  if (corners <= 0) return 0;
  const cpi = corners / Math.max(0.5, incidents);
  const target = Math.min(0.12, Math.max(-0.3, Math.log2(cpi / 100) * 0.06));
  // a short session moves it less
  return target * Math.min(1, corners / 120);
}

/** Adds a session to the career; returns what it gave (the results screen shows it). */
export function addSession(s: SessionStats): CareerGain {
  const c = loadCareer();
  const lines: [string, number][] = [];
  const add = (label: string, xp: number) => {
    if (xp > 0) lines.push([label, Math.round(xp)]);
  };
  add('Distance', s.km * 5);
  add('Clean laps', s.cleanLaps * 20);
  add('Personal bests', s.personalBests * 50);
  if (s.kind === 'race' && s.position > 0) {
    add('Finishing position', (s.field - s.position + 1) * 25);
    if (s.start > s.position) add('Places gained', (s.start - s.position) * 30);
    if (s.position === 1) add('Win', 250);
    else if (s.position <= 3) add('Podium', 120);
  }
  if (s.kind === 'qualifying' && s.position === 1 && s.field > 1) add('Pole position', 150);
  const xp = lines.reduce((a, [, v]) => a + v, 0);
  // coins, as Gran Turismo's prize money and Forza's credits: the prize by position (a bigger field pays more),
  // places gained (Forza pays more for starting further back), pole, clean laps, distance; +50 % for a race with no
  // incident (GT7's clean race bonus); all scaled by the AI's difficulty
  const coinLines: [string, number][] = [];
  const pay = (label: string, v: number) => {
    if (v > 0) coinLines.push([label, Math.round((v * (s.difficulty ?? 1) ** 3) / 10) * 10]);
  };
  if (s.kind === 'race' && s.position > 0) {
    const share = Math.max(0.1, 1 - (s.position - 1) / Math.max(1, s.field));
    pay('Prize money', (6000 + 2500 * Math.min(12, s.field)) * share ** 1.5);
    if (s.start > s.position) pay('Places gained', (s.start - s.position) * 1500);
  }
  if (s.kind === 'qualifying' && s.position === 1 && s.field > 1) pay('Pole position', 8000);
  pay('Clean laps', s.cleanLaps * 600);
  pay('Distance', s.km * 120);
  if (s.kind === 'race' && s.position > 0 && s.incidents === 0 && s.laps > 0) {
    const base = coinLines.reduce((a, [, v]) => a + v, 0);
    coinLines.push(['Clean race bonus', Math.round(base * 0.05) * 10]);
  }
  const coins = coinLines.reduce((a, [, v]) => a + v, 0);
  c.coins += coins;
  const before = { level: levelOf(c.xp).level, licence: c.licence, sr: c.sr };
  c.xp += xp;
  c.sessions++;
  c.km += s.km;
  c.cleanLaps += s.cleanLaps;
  if (s.kind === 'race') {
    c.races++;
    if (s.position === 1) c.wins++;
    if (s.position > 0 && s.position <= 3) c.podiums++;
  }
  if (s.kind === 'qualifying' && s.position === 1 && s.field > 1) c.poles++;
  c.sr = Math.max(0, Math.min(4.99, c.sr + srDelta(s.corners, s.incidents)));
  const i = LICENCES.indexOf(c.licence);
  if (i < LICENCES.length - 1 && c.sr >= (c.licence === 'R' ? 3 : 4)) {
    c.licence = LICENCES[i + 1];
    c.sr -= 1;
  } else if (i > 0 && c.sr < 1) {
    c.licence = LICENCES[i - 1];
    c.sr = 2.5;
  }
  saveCareer(c);
  return {
    xp,
    lines,
    coins,
    coinLines,
    levelBefore: before.level,
    levelAfter: levelOf(c.xp).level,
    licenceBefore: before.licence,
    licenceAfter: c.licence,
    srBefore: before.sr,
    srAfter: c.sr,
  };
}

/* ------------------------------------------------------------- the garage --- */

/**
 * A car's price in coins (GT7 sells its Gr.3 cars for about 450,000 credits): by power to weight (the GT3s are close
 * by their balance of performance, the Cup car and the hypercar far above), a little more for a newer model.
 */
export function carPrice(car: { specs: { powerKw: number; massKg: number }; year?: number | null }): number {
  const pw = car.specs.powerKw / car.specs.massKg;
  const p = 60_000 + Math.max(0, pw - 0.24) * 3_200_000 + Math.max(0, (car.year ?? 2015) - 2015) * 5000;
  return Math.round(Math.min(900_000, Math.max(50_000, p)) / 5000) * 5000;
}

/**
 * The garage the first time: the three most affordable cars, and the car last driven (nobody loses the car they
 * use). Later calls change nothing.
 */
export function initGarage(cars: { id: string; specs: { powerKw: number; massKg: number }; year?: number | null }[], current?: string | null): void {
  const c = loadCareer();
  if (c.owned.length) return;
  c.owned = [...cars]
    .sort((a, b) => carPrice(a) - carPrice(b))
    .slice(0, 3)
    .map((x) => x.id);
  if (current && !c.owned.includes(current)) c.owned.push(current);
  saveCareer(c);
}

export function ownsCar(id: string): boolean {
  return loadCareer().owned.includes(id);
}

/** Buys a car: false when there are not coins enough. */
export function buyCar(car: { id: string; specs: { powerKw: number; massKg: number }; year?: number | null }): boolean {
  const c = loadCareer();
  if (c.owned.includes(car.id)) return true;
  const price = carPrice(car);
  if (c.coins < price) return false;
  c.coins -= price;
  c.owned.push(car.id);
  saveCareer(c);
  return true;
}

/** The daily bonus (5,000 coins, once a day): what was given, 0 if already today. */
export function claimDaily(): number {
  const c = loadCareer();
  const today = new Date().toISOString().slice(0, 10);
  if (c.daily === today) return 0;
  c.daily = today;
  c.coins += 5000;
  saveCareer(c);
  return 5000;
}
