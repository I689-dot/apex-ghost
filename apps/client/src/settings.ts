import type { PadLayout } from './input/padMap';
import { defaultLang, type Lang } from './i18n';
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export const CONTROL_ACTIONS = [
  'throttle',
  'brake',
  'steerLeft',
  'steerRight',
  'handbrake',
  'shiftUp',
  'shiftDown',
  'resetCar',
  'toggleGearbox',
  'lookLeft',
  'lookRight',
  'lookBack',
  'timing',
  'pause',
  'camera',
] as const;
export type CameraMode = 'cockpit' | 'chase' | 'far';
export const CAMERA_MODES: CameraMode[] = ['cockpit', 'chase', 'far'];

export type ControlAction = (typeof CONTROL_ACTIONS)[number];
export type KeyBindings = Record<ControlAction, string[]>;

export const ACTION_LABEL: Record<ControlAction, string> = {
  throttle: 'Throttle',
  brake: 'Brake / reverse',
  steerLeft: 'Steer left',
  steerRight: 'Steer right',
  handbrake: 'Handbrake',
  shiftUp: 'Shift up',
  shiftDown: 'Shift down',
  resetCar: 'Reset to track',
  toggleGearbox: 'Manual / automatic',
  lookLeft: 'Look left',
  lookRight: 'Look right',
  lookBack: 'Look back',
  timing: 'Timing screen (hold)',
  pause: 'Pause menu',
  camera: 'Change camera',
};

export const DEFAULT_BINDINGS: KeyBindings = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  shiftUp: ['ShiftLeft', 'KeyE'],
  shiftDown: ['ControlLeft', 'KeyQ'],
  resetCar: ['KeyR'],
  toggleGearbox: ['KeyM'],
  lookLeft: ['KeyZ'],
  lookRight: ['KeyC'],
  lookBack: ['KeyX'],
  timing: ['Tab'],
  pause: ['Escape'],
  camera: ['KeyV'],
};

export interface Assists {
  abs: boolean;
  /** 0 off, 1 low, 2 high */
  tc: 0 | 1 | 2;
  stability: boolean;
  steering: boolean;
}

/** Before the session, as in GT3 practice: tyres, rear wing, brake balance, and the deeper setup (carSetup.ts). */
export interface CarSetup {
  tyre: 'soft' | 'medium' | 'hard' | 'wet';
  /** Wing angle: low = top speed, high = cornering grip (and drag). */
  wing: 'low' | 'medium' | 'high';
  /** Front share of brake force, 0.54 … 0.66. */
  brakeBias: number;
  /** Cold tyre pressures (psi), front / rear; null: the crew sets them for the hot target. */
  pressure: [number, number] | null;
  /** Ride height from the car's baseline (mm, − = lower), front / rear. */
  ride: [number, number];
  /** Anti-roll bars, dampers (bump, rebound): clicks 1 (soft) … 7 (stiff), 4 = baseline; front / rear. */
  arb: [number, number];
  bump: [number, number];
  rebound: [number, number];
  /** Fuel load at the start (l), with the host's fuel rule. */
  fuelL: number;
}

export interface Settings {
  nickname: string;
  /** Interface language (first run: the browser's). */
  language: Lang;
  quality: QualityPreset;
  qualityAuto: boolean;
  resolutionScale: number;
  dynamicResolution: boolean;
  /** Phone app: display refresh rate asked for (60, or the screen's 90 / 120 / 144 Hz). */
  refreshRate: number;
  fov: number;
  /** Cockpit camera adjustment (m): + raises the eye / moves it forward. */
  seatHeight: number;
  seatForward: number;
  assists: Assists;
  manualGearbox: boolean;
  /** Driving view: from the seat, or chase cameras behind the car. */
  camera: CameraMode;
  units: 'kmh' | 'mph';
  /** Racing-line assist: off, braking zones and corners only, or the whole lap. */
  racingLine: 'off' | 'corners' | 'full';
  showPerf: boolean;
  /** Replay your best valid lap as a translucent ghost car. */
  ghost: boolean;
  /** Car setup chosen in the lobby. */
  carSetup: CarSetup;
  /** Mixer levels 0..1 */
  audio: { master: number; engine: number; effects: number; ambience: number };
  bindings: KeyBindings;
  /**
   * Game controller: stick dead zone (0…0.25), steering curve exponent (1 = linear, higher = finer near centre),
   * steering speed (× the rate limit), speed sensitivity (0 = same speed at any speed … 1 = much calmer at speed),
   * brake curve exponent, rumble.
   */
  pad: {
    deadzone: number;
    steerCurve: number;
    steerSpeed: number;
    speedSens: number;
    brakeCurve: number;
    vibration: boolean;
    /** Button layouts set up by the player, per controller (input/padMap.ts). */
    layouts: Record<string, PadLayout>;
  };
}

const KEY = 'apexghost.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  nickname: '',
  language: defaultLang(),
  quality: 'medium',
  qualityAuto: true,
  resolutionScale: 1,
  dynamicResolution: true,
  refreshRate: 60,
  fov: 72,
  seatHeight: 0,
  seatForward: 0,
  assists: { abs: true, tc: 1, stability: false, steering: false },
  manualGearbox: false,
  camera: 'cockpit',
  units: 'kmh',
  racingLine: 'corners',
  showPerf: false,
  audio: { master: 0.8, engine: 0.9, effects: 0.8, ambience: 0.6 },
  carSetup: {
    tyre: 'medium',
    wing: 'medium',
    brakeBias: 0.6,
    pressure: null,
    ride: [0, 0],
    arb: [4, 4],
    bump: [4, 4],
    rebound: [4, 4],
    fuelL: 60,
  },
  ghost: true,
  bindings: DEFAULT_BINDINGS,
  pad: { deadzone: 0.06, steerCurve: 1.7, steerSpeed: 1, speedSens: 0.5, brakeCurve: 1.4, vibration: true, layouts: {} },
};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode): settings just won't persist */
  }
}

export function loadSettings(): Settings {
  const raw = safeGet(KEY);
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  try {
    const s = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...s };
    merged.assists = { ...DEFAULT_SETTINGS.assists, ...(s.assists ?? {}) };
    merged.bindings = { ...DEFAULT_BINDINGS, ...(s.bindings ?? {}) };
    merged.audio = { ...DEFAULT_SETTINGS.audio, ...(s.audio ?? {}) };
    merged.pad = { ...DEFAULT_SETTINGS.pad, ...(s.pad ?? {}) };
    merged.carSetup = { ...DEFAULT_SETTINGS.carSetup, ...(s.carSetup ?? {}) };
    return merged;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  safeSet(KEY, JSON.stringify(s));
}

export const settings: Settings = loadSettings();

export function sessionKey(code: string): string {
  return `apexghost.session.${code}`;
}

export function getSession(code: string): string | null {
  try {
    return sessionStorage.getItem(sessionKey(code));
  } catch {
    return null;
  }
}

export function setSession(code: string, token: string | null): void {
  try {
    if (token) sessionStorage.setItem(sessionKey(code), token);
    else sessionStorage.removeItem(sessionKey(code));
  } catch {
    /* ignore */
  }
}

export interface QualityConfig {
  shadowMapSize: number;
  shadows: boolean;
  shadowRange: number;
  pixelRatioCap: number;
  bloom: boolean;
  /** 'msaa': multisampled post-processing target (High/Ultra); otherwise the canvas' native MSAA is used. */
  antialias: 'native' | 'msaa';
  /** Reflection environment on track surfaces too (cars always get it). */
  envOnTrack: boolean;
  /** Buildings and trackside objects cast sun shadows (cars always do). */
  sceneryShadows: boolean;
  /** Full PBR shading on scenery; otherwise cheaper Lambert shading for everything but the road. */
  pbrScenery: boolean;
  treeDistance: number;
  sceneryDistance: number;
  /** Small trackside detail (posts, fences, signs) is hidden beyond this distance. */
  detailDistance: number;
  /** Guard rails, tyre walls and the pit wall are hidden beyond this distance (sub-pixel there). */
  barrierDistance: number;
  rainParticles: number;
  /** Real spot lights for your own headlights (costly on integrated GPUs: every lit pixel evaluates them). */
  ownHeadlightSpots: boolean;
  /** Your car uses its high-detail cockpit model (full interior detail, sharper textures). */
  cockpitDetail: boolean;
  /** Other cars get their full-detail model up close, streamed in after loading (a third of a session's download). */
  remoteDetail: boolean;
  /** Spectators on the grandstands: share of the seats taken (0 = none). */
  crowd: number;
  /** Sky clouds: 0 flat (one noise sample), 1 lit cumulus + cirrus, 2 cumulus with deeper self-shadowing. */
  cloudDetail: 0 | 1 | 2;
  /** 3D lawn on the verges (grassShells.ts): layers of blades (0 = flat lawn) within grassShellRadius m. */
  grassShells: number;
  grassShellRadius: number;
  /** Screen-space ambient occlusion (N8AO): soft contact shadows in the cockpit and around cars. */
  ao: boolean;
  ownHeadlightShadows: boolean;
  /** Trees cast sun shadows (alpha-tested foliage in the shadow pass is expensive). */
  treeShadows: boolean;
  softShadows: boolean;
  anisotropy: number;
  envMapSize: number;
  /** Procedural Eifel forest (forest.ts): 3D trees up to forestNear m, impostor cards up to forestFar m. */
  forestNear: number;
  forestFar: number;
  /** Share of the scattered trees drawn as 3D trees / as far cards (0..1). */
  forestNearDensity: number;
  forestDensity: number;
}

export const QUALITY: Record<QualityPreset, QualityConfig> = {
  low: {
    shadowMapSize: 1024,
    shadows: false,
    shadowRange: 60,
    pixelRatioCap: 1,
    bloom: false,
    antialias: 'native',
    envOnTrack: false,
    sceneryShadows: false,
    pbrScenery: false,
    treeDistance: 180,
    sceneryDistance: 380,
    detailDistance: 140,
    barrierDistance: 900,
    rainParticles: 3000,
    ao: false,
    cockpitDetail: false,
    remoteDetail: false,
    crowd: 0.5,
    cloudDetail: 0,
    grassShells: 0,
    grassShellRadius: 0,
    ownHeadlightSpots: false,
    ownHeadlightShadows: false,
    treeShadows: false,
    softShadows: false,
    anisotropy: 1,
    envMapSize: 64,
    forestNear: 0,
    forestFar: 700,
    forestNearDensity: 0.0,
    forestDensity: 0.45,
  },
  medium: {
    shadowMapSize: 2048,
    shadows: true,
    shadowRange: 60,
    pixelRatioCap: 1,
    bloom: false,
    antialias: 'native',
    envOnTrack: false,
    sceneryShadows: false,
    pbrScenery: false,
    treeDistance: 380,
    sceneryDistance: 800,
    detailDistance: 280,
    barrierDistance: 1500,
    rainParticles: 6000,
    ao: false,
    cockpitDetail: true,
    remoteDetail: true,
    crowd: 1,
    cloudDetail: 1,
    grassShells: 6,
    grassShellRadius: 16,
    ownHeadlightSpots: false,
    ownHeadlightShadows: false,
    treeShadows: false,
    softShadows: false,
    anisotropy: 4,
    envMapSize: 128,
    forestNear: 80,
    forestFar: 1100,
    forestNearDensity: 0.8,
    forestDensity: 0.6,
  },
  high: {
    shadowMapSize: 2048,
    shadows: true,
    shadowRange: 120,
    pixelRatioCap: 1.5,
    bloom: true,
    antialias: 'msaa',
    envOnTrack: true,
    sceneryShadows: true,
    pbrScenery: true,
    treeDistance: 700,
    sceneryDistance: 1500,
    detailDistance: 450,
    barrierDistance: 2200,
    rainParticles: 10000,
    ao: true,
    cockpitDetail: true,
    remoteDetail: true,
    crowd: 1,
    cloudDetail: 2,
    grassShells: 10,
    grassShellRadius: 24,
    ownHeadlightSpots: true,
    ownHeadlightShadows: true,
    treeShadows: true,
    softShadows: true,
    anisotropy: 8,
    envMapSize: 256,
    forestNear: 110,
    forestFar: 1400,
    forestNearDensity: 1,
    forestDensity: 0.7,
  },
  ultra: {
    shadowMapSize: 4096,
    shadows: true,
    shadowRange: 150,
    pixelRatioCap: 2,
    bloom: true,
    antialias: 'msaa',
    envOnTrack: true,
    sceneryShadows: true,
    pbrScenery: true,
    treeDistance: 1200,
    sceneryDistance: 3000,
    detailDistance: 800,
    barrierDistance: 3500,
    rainParticles: 14000,
    ao: true,
    cockpitDetail: true,
    remoteDetail: true,
    crowd: 1,
    cloudDetail: 2,
    grassShells: 14,
    grassShellRadius: 32,
    ownHeadlightSpots: true,
    ownHeadlightShadows: true,
    treeShadows: true,
    softShadows: true,
    anisotropy: 16,
    envMapSize: 256,
    forestNear: 150,
    forestFar: 2200,
    forestNearDensity: 1,
    forestDensity: 0.9,
  },
};

/** First-launch guess from the GPU renderer string. */
export function detectQuality(gl: WebGL2RenderingContext | null): QualityPreset {
  if (!gl) return 'low';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const r = (ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))).toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(r)) return 'low';
  if (/rtx\s*(30[6-9]|40|50)|rx\s*(6[7-9]|7[7-9]|9)\d\d|apple m[2-4] (pro|max)/.test(r)) return 'ultra';
  if (/rtx|gtx\s*1(07|08)|rx\s*(5[67]|6[0-6])\d\d|radeon pro|apple m[1-4]/.test(r)) return 'high';
  // integrated GPUs (Intel Iris Xe/UHD, AMD Vega/Radeon Graphics APUs) start on Low; dynamic resolution helps further
  if (/intel|uhd|iris|hd graphics|mali|adreno|radeon(\(tm\))? graphics|vega\s*\d|renoir|cezanne|rembrandt|phoenix/.test(r)) return 'low';
  if (/gtx|rx\s*(4|5)\d\d|arc|radeon/.test(r)) return 'medium';
  return 'medium';
}
