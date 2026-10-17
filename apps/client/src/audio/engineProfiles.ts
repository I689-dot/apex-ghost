import type { CarEntry } from '@apex/shared';

/** One firing: crank angle (0–720°) and the exhaust bank it fires into. */
interface FireEvent {
  a: number;
  bank: number;
}

/** What the engine worklet needs (see public/audio/engine-worklet.js). */
export interface EngineProfile {
  name: string;
  events: FireEvent[];
  banks: number;
  /** Exhaust/intake resonances: [Hz, Q, gain] */
  formants: [number, number, number][];
  thump: number;
  noise: number;
  noiseMs: number;
  bright: number;
  drive: number;
  /** Extra pulse strength when a bank fires twice in a row (uneven firing → burble). */
  sameBank: number;
  crackle: number;
  redline: number;
  idle: number;
  level: number;
  turbo: boolean;
  hybrid: boolean;
  /** Cylinders (maps the rpm onto a recorded bank with the same firing frequency). */
  cyl: number;
  /** Recorded loop bank (public/assets/audio/engine_<bank>.bin/.json) that carries the sound. */
  bank: string;
  /** Gain of the recording, and of the procedural layer kept underneath it once the recording is loaded. */
  sampleGain: number;
  synthMix: number;
}

/** Even firing every 720/n degrees; `banks` lists the bank of each event in firing order. */
function even(banks: number[]): FireEvent[] {
  const step = 720 / banks.length;
  return banks.map((bank, i) => ({ a: i * step, bank }));
}

/**
 * Engine layouts of the cars in the game (real firing orders, bank by bank):
 *  - cross-plane V8 (Mercedes-AMG 6.2 / 4.0): 1-5-4-8-6-3-7-2, banks 1-4 | 5-8 → L R L R R L R L: the burble;
 *  - flat-plane V8 (McLaren M838T/M840T): banks alternate: even, screaming;
 *  - V10 (Audi/Lamborghini 5.2 FSI): 72° even firing, banks alternate: high, howling;
 *  - flat-six (Porsche 4.2 boxer): 1-6-2-4-3-5, banks alternate every 120°: metallic rasp;
 *  - inline-six (BMW P58 / S58): 1-5-3-6-2-4 into front/rear manifolds: smooth, turbo;
 *  - V6 120° hot-vee (Ferrari 296, Mercedes F1 1.6 in the AMG ONE): even 120°, banks alternate.
 */
const LAYOUT = {
  crossV8: even([0, 1, 0, 1, 1, 0, 1, 0]),
  flatV8: even([0, 1, 0, 1, 0, 1, 0, 1]),
  v10: even([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]),
  boxer6: even([0, 1, 0, 1, 0, 1]),
  i6: even([0, 1, 0, 1, 0, 1]),
  v6: even([0, 1, 0, 1, 0, 1]),
};

const base = {
  banks: 2,
  thump: 0.9,
  noise: 0.35,
  noiseMs: 1.6,
  drive: 1.8,
  sameBank: 0,
  crackle: 0.05,
  idle: 1200,
  level: 0.55,
  turbo: false,
  hybrid: false,
  sampleGain: 0.6,
  synthMix: 0.3,
};

const PROFILES: Record<string, Omit<EngineProfile, 'redline'>> = {
  amgV8: {
    ...base,
    cyl: 8,
    bank: 'viper', // Dodge Viper GTS V10 race engine: the closest free match to the 6.2 AMG's thunder
    level: 0.59,
    name: 'Mercedes-AMG 6.2 V8 (naturally aspirated, cross-plane)',
    events: LAYOUT.crossV8,
    formants: [
      [105, 1.2, 1.0],
      [460, 1.6, 0.45],
      [1500, 2, 0.16],
    ],
    thump: 1.3,
    bright: 2300,
    drive: 2.3,
    sameBank: 0.5,
    crackle: 0.09,
    idle: 1000,
  },
  amgV8tt: {
    ...base,
    cyl: 8,
    bank: 'viper',
    level: 0.8,
    name: 'Mercedes-AMG 4.0 V8 biturbo (cross-plane)',
    events: LAYOUT.crossV8,
    formants: [
      [120, 1.2, 1.0],
      [520, 1.6, 0.4],
      [1600, 2, 0.12],
    ],
    thump: 1.1,
    bright: 1800,
    drive: 2.0,
    sameBank: 0.4,
    crackle: 0.06,
    turbo: true,
  },
  mclarenV8: {
    ...base,
    cyl: 8,
    bank: 'v8tt', // McLaren 570S (3.8 V8 biturbo, flat-plane)
    level: 0.88,
    name: 'McLaren 3.8/4.0 V8 biturbo (flat-plane)',
    events: LAYOUT.flatV8,
    formants: [
      [165, 1.3, 0.9],
      [720, 1.8, 0.55],
      [2300, 2.4, 0.22],
    ],
    bright: 3200,
    crackle: 0.05,
    turbo: true,
  },
  v10: {
    ...base,
    cyl: 10,
    bank: 'v10', // Audi R8 (5.2 V10, the GT3 cars' engine)
    sampleGain: 0.8,
    level: 0.8,
    name: 'Audi/Lamborghini 5.2 V10 (naturally aspirated)',
    events: LAYOUT.v10,
    formants: [
      [215, 1.4, 0.85],
      [920, 1.8, 0.6],
      [2900, 2.6, 0.3],
    ],
    thump: 0.6,
    noise: 0.5,
    noiseMs: 2.4,
    bright: 5200,
    drive: 1.6,
    crackle: 0.06,
  },
  boxer6: {
    ...base,
    cyl: 6,
    bank: 'flat6', // Porsche 997 Cup (race flat-six)
    level: 0.85,
    name: 'Porsche 4.2 flat-six (naturally aspirated)',
    events: LAYOUT.boxer6,
    formants: [
      [175, 1.3, 0.8],
      [1080, 2.2, 0.75],
      [3300, 3, 0.3],
    ],
    thump: 0.7,
    noise: 0.45,
    noiseMs: 2.0,
    bright: 4600,
    drive: 1.9,
    crackle: 0.07,
  },
  bmwI6: {
    ...base,
    cyl: 6,
    bank: 'i6', // BMW M4 F82 (S55 3.0 inline-six biturbo)
    level: 1.12,
    name: 'BMW 3.0 inline-six biturbo',
    events: LAYOUT.i6,
    formants: [
      [145, 1.2, 0.95],
      [760, 1.6, 0.45],
      [2100, 2.2, 0.16],
    ],
    bright: 2600,
    turbo: true,
    crackle: 0.06,
  },
  ferrariV6: {
    ...base,
    cyl: 6,
    bank: 'v8f', // Ferrari 488 (3.9 V8 biturbo): no free 296 recording
    level: 0.99,
    name: 'Ferrari 3.0 V6 biturbo (120° hot-vee)',
    events: LAYOUT.v6,
    formants: [
      [190, 1.3, 0.85],
      [960, 1.8, 0.55],
      [2700, 2.4, 0.25],
    ],
    bright: 3900,
    turbo: true,
  },
  f1V6: {
    ...base,
    cyl: 6,
    bank: 'v8f',
    synthMix: 0.6,
    level: 1.19,
    name: 'Mercedes 1.6 V6 turbo hybrid (F1-derived)',
    events: LAYOUT.v6,
    formants: [
      [260, 1.4, 0.75],
      [1300, 2, 0.6],
      [3600, 2.6, 0.3],
    ],
    thump: 0.5,
    bright: 6200,
    drive: 1.5,
    crackle: 0.03,
    turbo: true,
    hybrid: true,
  },
};

function profileKey(id: string): keyof typeof PROFILES {
  if (id.includes('project_one')) return 'f1V6';
  if (id.includes('porsche')) return 'boxer6';
  if (id.includes('mclaren')) return 'mclarenV8';
  if (id.includes('lamborghini') || id.includes('audi')) return 'v10';
  if (id.includes('bmw')) return 'bmwI6';
  if (id.includes('ferrari')) return 'ferrariV6';
  if (id.includes('vantage')) return 'amgV8tt';
  if (id.includes('mercedes')) return 'amgV8';
  return 'amgV8tt';
}

export function engineProfileFor(car: CarEntry): EngineProfile {
  const p = PROFILES[profileKey(car.id)];
  return { ...p, redline: car.specs.redlineRpm, idle: car.specs.idleRpm || p.idle };
}
