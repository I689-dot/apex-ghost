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
] as const;
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
};

export interface Assists {
  abs: boolean;
  /** 0 off, 1 low, 2 high */
  tc: 0 | 1 | 2;
  stability: boolean;
  steering: boolean;
}

/** Before the session, as in GT3 practice: tyres, rear wing, brake balance. */
export interface CarSetup {
  tyre: 'soft' | 'medium' | 'hard' | 'wet';
  /** Wing angle: low = top speed, high = cornering grip (and drag). */
  wing: 'low' | 'medium' | 'high';
  /** Front share of brake force, 0.54 … 0.66. */
  brakeBias: number;
}

export interface Settings {
  nickname: string;
  /** Interface language (first run: the browser's). */
  language: Lang;
  quality: QualityPreset;
  qualityAuto: boolean;
  resolutionScale: number;
  dynamicResolution: boolean;
  fov: number;
  /** Cockpit camera adjustment (m): + raises the eye / moves it forward. */
  seatHeight: number;
  seatForward: number;
  assists: Assists;
  manualGearbox: boolean;
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
}

const KEY = 'apexghost.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  nickname: '',
  language: defaultLang(),
  quality: 'medium',
  qualityAuto: true,
  resolutionScale: 1,
  dynamicResolution: true,
  fov: 72,
  seatHeight: 0,
  seatForward: 0,
  assists: { abs: true, tc: 1, stability: false, steering: false },
  manualGearbox: false,
  units: 'kmh',
  racingLine: 'corners',
  showPerf: false,
  audio: { master: 0.8, engine: 0.9, effects: 0.8, ambience: 0.6 },
  carSetup: { tyre: 'medium', wing: 'medium', brakeBias: 0.6 },
  ghost: true,
  bindings: DEFAULT_BINDINGS,
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
  rainParticles: number;
  /** Real spot lights for your own headlights (costly on integrated GPUs: every lit pixel evaluates them). */
  ownHeadlightSpots: boolean;
  /** Your car uses its high-detail cockpit model (full interior detail, sharper textures). */
  cockpitDetail: boolean;
  /** Screen-space ambient occlusion (N8AO): soft contact shadows in the cockpit and around cars. */
  ao: boolean;
  ownHeadlightShadows: boolean;
  /** Trees cast sun shadows (alpha-tested foliage in the shadow pass is expensive). */
  treeShadows: boolean;
  softShadows: boolean;
  anisotropy: number;
  envMapSize: number;
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
    rainParticles: 3000,
    ao: false,
    cockpitDetail: false,
    ownHeadlightSpots: false,
    ownHeadlightShadows: false,
    treeShadows: false,
    softShadows: false,
    anisotropy: 1,
    envMapSize: 64,
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
    rainParticles: 6000,
    ao: false,
    cockpitDetail: true,
    ownHeadlightSpots: false,
    ownHeadlightShadows: false,
    treeShadows: false,
    softShadows: false,
    anisotropy: 4,
    envMapSize: 128,
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
    rainParticles: 10000,
    ao: true,
    cockpitDetail: true,
    ownHeadlightSpots: true,
    ownHeadlightShadows: true,
    treeShadows: true,
    softShadows: true,
    anisotropy: 8,
    envMapSize: 256,
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
    rainParticles: 14000,
    ao: true,
    cockpitDetail: true,
    ownHeadlightSpots: true,
    ownHeadlightShadows: true,
    treeShadows: true,
    softShadows: true,
    anisotropy: 16,
    envMapSize: 256,
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
