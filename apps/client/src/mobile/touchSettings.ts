import { h } from '../ui/dom';
import { t } from '../i18n';

/** How the phone steers: two arrow buttons (= the keys), a drag slider, or tilting the phone like a wheel. */
export type SteerMode = 'buttons' | 'slider' | 'tilt';

export interface TouchPrefs {
  steer: SteerMode;
  /** Tilt angle (degrees) that gives full steering. */
  tiltRange: number;
  /** Swap the tilt direction (a few phones report the sensor mirrored). */
  tiltInvert: boolean;
  /** Pedal size, 0.8 … 1.3. */
  size: number;
  /** Short vibration on gear shifts and button presses. */
  haptics: boolean;
  /** Controls opacity, 0.25 … 1. */
  opacity: number;
}

const KEY = 'apexghost.touch.v1';
const DEFAULTS: TouchPrefs = { steer: 'buttons', tiltRange: 28, tiltInvert: false, size: 1, haptics: true, opacity: 0.7 };

function load(): TouchPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<TouchPrefs>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export const touchPrefs: TouchPrefs = load();
const listeners = new Set<() => void>();

export function saveTouchPrefs(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(touchPrefs));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function onTouchPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "Touch controls" section of the Settings panel, in place of the key bindings (app only). */
export function touchSettingsSection(): HTMLElement {
  const row = (label: string, ctrl: HTMLElement, hint?: string) =>
    h('div.set-row', {}, h('div', {}, h('span', { text: label }), hint ? h('small', { text: hint }) : null), ctrl);
  const range = (value: number, min: number, max: number, step: number, fmt: (v: number) => string, set: (v: number) => void) => {
    const out = h('output', { text: fmt(value) });
    const r = h('input', {
      type: 'range',
      min,
      max,
      step,
      value,
      oninput: () => {
        out.textContent = fmt(Number(r.value));
        set(Number(r.value));
        saveTouchPrefs();
      },
    });
    return h('div.range', {}, r, out);
  };
  const toggle = (value: boolean, set: (v: boolean) => void) => {
    const i = h('input', {
      type: 'checkbox',
      checked: value,
      onchange: () => {
        set(i.checked);
        saveTouchPrefs();
      },
    });
    return h('label.switch', {}, i, h('span'));
  };
  const modes: [SteerMode, string][] = [
    ['buttons', t('Arrow buttons')],
    ['slider', t('Slide')],
    ['tilt', t('Tilt the phone')],
  ];
  const steer = h(
    'select',
    {
      onchange: () => {
        touchPrefs.steer = steer.value as SteerMode;
        saveTouchPrefs();
      },
    },
    ...modes.map(([v, l]) => h('option', { value: v, text: l, selected: v === touchPrefs.steer })),
  );
  return h(
    'section',
    {},
    h('h3', { text: t('Touch controls') }),
    row(t('Steering'), steer, t('Tilt: hold the phone like a wheel. Steering is speed-sensitive in every mode.')),
    row(
      t('Tilt for full lock'),
      range(
        touchPrefs.tiltRange,
        12,
        50,
        1,
        (v) => `${v}°`,
        (v) => (touchPrefs.tiltRange = v),
      ),
      t('Smaller = more sensitive'),
    ),
    row(
      t('Invert tilt'),
      toggle(touchPrefs.tiltInvert, (v) => (touchPrefs.tiltInvert = v)),
    ),
    row(
      t('Button size'),
      range(
        touchPrefs.size,
        0.8,
        1.3,
        0.05,
        (v) => `${Math.round(v * 100)} %`,
        (v) => (touchPrefs.size = v),
      ),
    ),
    row(
      t('Button opacity'),
      range(
        touchPrefs.opacity,
        0.25,
        1,
        0.05,
        (v) => `${Math.round(v * 100)} %`,
        (v) => (touchPrefs.opacity = v),
      ),
    ),
    row(
      t('Vibration'),
      toggle(touchPrefs.haptics, (v) => (touchPrefs.haptics = v)),
    ),
  );
}
