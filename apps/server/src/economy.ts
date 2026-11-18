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
  { code: 'CORSAGHOST', coins: 1000, what: '1,000 coins: thanks for racing at launch', maxUses: null },
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
