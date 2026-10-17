import type { EngineProfile } from './engineProfiles';

/** Procedural engine DSP (engine-worklet.js): used by the AudioWorklet, and on the main thread as a fallback. */
export class EngineDSP {
  constructor(sampleRate: number, profile: EngineProfile);
  render(out: Float32Array, n: number, rpm0: number, rpm1: number, load0: number, load1: number, cut: number): void;
}

export interface EngineBank {
  order: number;
  cyl: number;
  loops: { rpm: number; on: Float32Array; off: Float32Array }[];
}

/** Recorded engine: constant-rpm loops played by pitch-synchronous granular synthesis. */
export class SampleEngine {
  constructor(sampleRate: number, bank: EngineBank, carCyl: number);
  render(out: Float32Array, n: number, rpm0: number, rpm1: number, load0: number, load1: number, cut: number, gain: number): void;
}

/** Procedural layer plus the recording (when loaded) into `out`. */
export function mixEngine(
  dsp: EngineDSP,
  rec: SampleEngine | null,
  profile: EngineProfile,
  out: Float32Array,
  n: number,
  rpm0: number,
  rpm1: number,
  load0: number,
  load1: number,
  cut: number,
): void;
