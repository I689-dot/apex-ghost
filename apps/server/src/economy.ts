/**
 * Coins, codes, invites and the ranking (the Godot app, 2026-11-17): the rules, kept apart from the storage
 * (accounts.ts). Coins are earned in online races, whose results only the game server reports (a client cannot award
 * itself any), from promotional codes and from inviting friends; buying them is not switched on.
 */

/** Coins for an online race's result (a race with at least two drivers). */
export const COINS = {
  finish: 25,
  podium: 50,
  win: 100,
  firstOfDay: 50,
  /** a new driver who signs up with an invite code */
  invited: 300,
  /** the driver who invited them, when they have finished INVITE_RACES races */
  inviter: 500,
} as const;

export const INVITE_RACES = 3;
/** An invite code can be entered within this long of signing up. */
export const INVITE_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** The promotional codes the server starts with (more can be added in the table): coins and what the player is told. */
export const SEED_CODES: { code: string; coins: number; what: string; maxUses: number | null }[] = [
  { code: 'WELCOME500', coins: 500, what: '500 coins', maxUses: null },
  { code: 'GRIDCORSA', coins: 1000, what: '1,000 coins: thanks for racing at launch', maxUses: null },
  { code: 'SPA2026', coins: 250, what: '250 coins', maxUses: null },
];

export function coinsForResult(position: number, entrants: number, firstOfDay: boolean): { coins: number; reasons: string[] } {
  if (entrants < 2 || position < 1) return { coins: 0, reasons: [] };
  let coins = COINS.finish;
  const reasons = ['finish'];
  if (position === 1) {
    coins += COINS.win;
    reasons.push('win');
  } else if (position <= 3) {
    coins += COINS.podium;
    reasons.push('podium');
  }
  if (firstOfDay) {
    coins += COINS.firstOfDay;
    reasons.push('first race of the day');
  }
  return { coins, reasons };
}

/** The Driver Rating everyone starts at. */
export const RATING_START = 1500;

/**
 * A race's change of Driver Rating from the finishing place: the field's middle keeps its rating, the winner gains the
 * most, the last loses the most, a bigger field moves it more (as iRating does for a field of equals). Never below 0.
 */
export function ratingDelta(position: number, entrants: number): number {
  if (entrants < 2) return 0;
  const share = 1 - (2 * (position - 1)) / (entrants - 1); // +1 the winner .. -1 the last
  const k = 16 + 4 * Math.min(entrants, 12);
  return Math.round(share * k);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** An invite code: CG- and five letters or digits (no 0/O or 1/I to mix up). */
export function newInviteCode(random: (n: number) => Uint8Array): string {
  const b = random(5);
  return 'CG-' + [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}

export function normaliseCode(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase().replace(/\s+/g, '') : '';
}

/** The start of the UTC day of a time (first race of the day). */
export const dayOf = (t: number) => Math.floor(t / 86_400_000);

/**
 * The online licence and Safety Rating (2026-11-19): the offline career's rules (godot/scripts/game/career.gd, after
 * iRacing), judged by the game server. Incident points: off the track 1, contact 4, a reset 4 (the server sees no wall
 * hits: those are in the car's physics, on the driver's own machine). Race and qualifying sessions count.
 */
export const LICENCES = ['R', 'D', 'C', 'B', 'A', 'P'] as const;
export type Licence = (typeof LICENCES)[number];
export const SR_START = 2.5;
export const INCIDENT_POINTS = { offTrack: 1, contact: 4, reset: 4 } as const;
/** Contact between two cars counts once in this long (a scrape is one incident, not one a packet). */
export const CONTACT_WINDOW_MS = 2000;
/** Contact counts only when the server has the two cars this close (a client cannot hand others incidents from afar). */
export const CONTACT_NEAR_M = 10;

/** A session's Safety Rating change: ~100 corners an incident point is neutral; clean corners raise it slowly. */
export function srDelta(corners: number, incidents: number): number {
  if (corners <= 0) return 0;
  const cpi = corners / Math.max(0.5, incidents);
  const target = Math.min(0.12, Math.max(-0.3, (Math.log(cpi / 100) / Math.log(2)) * 0.06));
  return target * Math.min(1, corners / 120);
}

/** The licence and Safety Rating after a session: promoted at 3.00 from Rookie and 4.00 above (it costs 1.00), down a class below 1.00. */
export function licenceAfter(licence: string, sr: number, corners: number, incidents: number): { licence: Licence; sr: number } {
  let i = Math.max(0, LICENCES.indexOf(licence as Licence));
  let s = Math.max(0, Math.min(4.99, sr + srDelta(corners, incidents)));
  if (i < LICENCES.length - 1 && s >= (i === 0 ? 3 : 4)) {
    i++;
    s -= 1;
  } else if (i > 0 && s < 1) {
    i--;
    s = SR_START;
  }
  return { licence: LICENCES[i], sr: Math.round(s * 100) / 100 };
}
