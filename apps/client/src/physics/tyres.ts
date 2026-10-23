/**
 * Tyre compounds and wear.
 *
 * GT3 championships race a single Pirelli dry compound plus a wet; Soft / Medium / Hard here are a game
 * choice (as in ACC's and F1's sets) so that a pit stop means a strategy: the faster compound lasts less.
 *  - grip: relative peak grip on a dry track (Medium = 1);
 *  - wetGrip: relative grip on a fully wet track (slicks aquaplane; wets bite);
 *  - wear: how fast the tread goes (×), in its own conditions;
 *  - optimumC / heatCap: the temperature window and how quickly the tyre warms up (softs fastest).
 */
export type CompoundId = 'soft' | 'medium' | 'hard' | 'wet';

export interface Compound {
  id: CompoundId;
  name: string;
  letter: string;
  /** Pirelli's sidewall colour code. */
  colour: string;
  grip: number;
  wetGrip: number;
  wear: number;
  optimumC: number;
  heatCap: number;
}

export const COMPOUNDS: Record<CompoundId, Compound> = {
  soft: { id: 'soft', name: 'Soft', letter: 'S', colour: '#ff3b30', grip: 1.035, wetGrip: 0.52, wear: 1.9, optimumC: 80, heatCap: 0.85 },
  medium: { id: 'medium', name: 'Medium', letter: 'M', colour: '#ffd60a', grip: 1.0, wetGrip: 0.52, wear: 1.0, optimumC: 85, heatCap: 1.0 },
  hard: { id: 'hard', name: 'Hard', letter: 'H', colour: '#f2f2f2', grip: 0.965, wetGrip: 0.5, wear: 0.55, optimumC: 92, heatCap: 1.15 },
  wet: { id: 'wet', name: 'Wet', letter: 'W', colour: '#3a86ff', grip: 0.86, wetGrip: 0.8, wear: 0.7, optimumC: 60, heatCap: 0.9 },
};

/** Grip of a compound for the track's water (wetness 0..1) and the rain falling now (standing water). */
export function compoundGrip(c: Compound, wetness: number, rain: number): number {
  const base = c.grip * (1 - wetness) + c.wetGrip * wetness;
  // slicks also aquaplane in standing water; grooved wets clear it
  const aqua = c.id === 'wet' ? 0 : 0.08 * rain * wetness;
  return base - aqua;
}

/** Wear multiplier for the conditions: wets shred on a dry track. */
export function wearRate(c: Compound, wetness: number): number {
  return c.id === 'wet' ? c.wear * (0.6 + 3.5 * (1 - wetness)) : c.wear * (1 - 0.5 * wetness);
}

/** Grip left on a worn tyre (wear 0 new … 1 down to the cords). */
export function wearGrip(wear: number): number {
  return 1 - 0.16 * Math.pow(Math.min(1, wear), 1.6);
}

/**
 * Tread lost per joule of sliding energy. Calibrated with tools/sim/ailap.ts: a Medium loses ~4–5 % a lap at a
 * smooth pace (more when sliding), so a 10-minute session on one set costs about a second by the end; Softs
 * wear about twice as fast.
 */
export const WEAR_PER_J = 9e-8;

/** Wet tyres pick a bot's set at the start; players choose in the pits. */
export function compoundForWeather(wetness: number): CompoundId {
  return wetness > 0.35 ? 'wet' : 'medium';
}
