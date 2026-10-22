import { settings } from '../settings';

/**
 * Turns whatever the browser reports for a controller into the W3C "standard" layout the game reads
 * (buttons 0–16: A B X Y LB RB LT RT View Menu L3 R3 ↑ ↓ ← → Home; axes: LX LY RX RY).
 *
 * Browsers only use the standard layout for pads they know. Others come through raw ("mapping": ""), e.g.
 * Switch Pro clones on Linux: buttons in kernel key-code order, the D-pad as a hat (two axes). So:
 *  1. a layout the player set up in Settings → Controller (per pad, see PadSetup) wins;
 *  2. the browser's standard layout;
 *  3. a built-in layout for known raw pads (Switch Pro protocol under the Linux hid_nintendo driver);
 *  4. otherwise the raw indices as they come (usually right for the sticks, often wrong for buttons).
 */

/** Where a standard button comes from: a raw button, or a raw axis pushed in one direction from rest. */
export type PadSource = { b: number } | { a: number; dir: 1 | -1; rest: number };
export interface PadLayout {
  /** Index = standard button. */
  buttons: (PadSource | null)[];
  /** Index = standard axis (LX, LY, RX, RY): raw axis and sign. */
  axes: ({ a: number; dir: 1 | -1 } | null)[];
}

export interface VirtualPad {
  raw: Gamepad;
  layout: 'custom' | 'standard' | 'builtin' | 'raw';
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
}

export const STD_BUTTONS = 17;

/** Storage key of a pad: its id without the browser-specific decoration. */
export function padKey(id: string): string {
  return id.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Switch Pro (and clones) under Linux hid_nintendo, raw: S E N W Capture L R ZL ZR − + Home LS RS; hat on axes 4/5. */
const NINTENDO_LINUX: PadLayout = {
  buttons: [
    { b: 0 }, // A (bottom) ← south
    { b: 1 }, // B (right) ← east
    { b: 3 }, // X (left) ← west
    { b: 2 }, // Y (top) ← north
    { b: 5 }, // LB ← L
    { b: 6 }, // RB ← R
    { b: 7 }, // LT ← ZL
    { b: 8 }, // RT ← ZR
    { b: 9 }, // View ← −
    { b: 10 }, // Menu ← +
    { b: 12 }, // L3
    { b: 13 }, // R3
    { a: 5, dir: -1, rest: 0 }, // ↑
    { a: 5, dir: 1, rest: 0 }, // ↓
    { a: 4, dir: -1, rest: 0 }, // ←
    { a: 4, dir: 1, rest: 0 }, // →
    { b: 11 }, // Home
  ],
  axes: [
    { a: 0, dir: 1 },
    { a: 1, dir: 1 },
    { a: 2, dir: 1 },
    { a: 3, dir: 1 },
  ],
};

function builtinLayout(p: Gamepad): PadLayout | null {
  const id = p.id.toLowerCase();
  if (/057e/.test(id) && /2009/.test(id) && p.buttons.length === 14 && p.axes.length >= 6) return NINTENDO_LINUX;
  return null;
}

export function layoutFor(p: Gamepad): { kind: VirtualPad['layout']; layout: PadLayout | null } {
  const custom = settings.pad.layouts?.[padKey(p.id)];
  if (custom) return { kind: 'custom', layout: custom };
  if (p.mapping === 'standard') return { kind: 'standard', layout: null };
  const b = builtinLayout(p);
  if (b) return { kind: 'builtin', layout: b };
  return { kind: 'raw', layout: null };
}

export function sourceValue(p: Gamepad, s: PadSource | null): number {
  if (!s) return 0;
  if ('b' in s) return p.buttons[s.b]?.value ?? (p.buttons[s.b]?.pressed ? 1 : 0);
  const v = p.axes[s.a] ?? s.rest;
  const span = s.dir > 0 ? 1 - s.rest : s.rest + 1;
  return Math.min(1, Math.max(0, ((v - s.rest) * s.dir) / (span || 1)));
}

const empty = () => Array.from({ length: STD_BUTTONS }, () => ({ pressed: false, value: 0 }));
const out: VirtualPad = { raw: null as unknown as Gamepad, layout: 'raw', buttons: empty(), axes: [0, 0, 0, 0] };

/** The pad in the standard layout (one shared object, refreshed per call). */
export function readPad(p: Gamepad): VirtualPad {
  const { kind, layout } = layoutFor(p);
  out.raw = p;
  out.layout = kind;
  for (let i = 0; i < STD_BUTTONS; i++) {
    let v: number;
    let pressed: boolean;
    if (layout) {
      const s = layout.buttons[i] ?? null;
      v = sourceValue(p, s);
      pressed = s && 'b' in s ? !!p.buttons[s.b]?.pressed : v > 0.5;
    } else {
      v = p.buttons[i]?.value ?? 0;
      pressed = !!p.buttons[i]?.pressed;
    }
    out.buttons[i].value = v;
    out.buttons[i].pressed = pressed;
  }
  for (let i = 0; i < 4; i++) {
    if (layout) {
      const s = layout.axes[i];
      out.axes[i] = s ? (p.axes[s.a] ?? 0) * s.dir : 0;
    } else out.axes[i] = p.axes[i] ?? 0;
  }
  return out;
}

/** Plausible game controllers only (a keyboard's "joystick" interface reports a couple of buttons, no sticks). */
export function isPlausiblePad(p: Gamepad | null): p is Gamepad {
  return !!p && p.connected && p.axes.length >= 2 && p.buttons.length >= 6;
}
