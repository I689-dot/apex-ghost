import { settings, type ControlAction } from '../settings';
import { padInput } from '../physics/input';
import { PAD } from '../physics/keyboardDriver';
import { toast } from '../ui/dom';
import { t } from '../i18n';

/**
 * Game controller support (Gamepad API, "standard" mapping: Xbox, PlayStation, Switch Pro and most USB pads).
 * Like the mobile touch controls it plugs into the existing input path, so the session code does not know about it:
 *  - driving: left stick and triggers write `padInput` (physics/input.ts), merged with the keys by the
 *    InputSmoother and then filtered every physics step like any other input (rate limits, speed-sensitive
 *    steering); the buttons press the bound keys with synthetic keyboard events;
 *  - menus (lobby, pause, pit box, settings, results): the D-pad or left stick moves the focus between the
 *    controls on screen, A presses, B goes back (Esc), ←/→ change a dropdown or slider.
 */

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/** Held buttons → held actions while driving. */
const HOLD: [number, ControlAction][] = [
  [BTN.Y, 'lookBack'],
  [BTN.RS, 'lookBack'],
  [BTN.VIEW, 'timing'],
];
/** Pressed buttons → one tap of an action while driving. */
const TAP: [number, ControlAction][] = [
  [BTN.RB, 'shiftUp'],
  [BTN.B, 'shiftUp'],
  [BTN.LB, 'shiftDown'],
  [BTN.X, 'shiftDown'],
  [BTN.UP, 'resetCar'],
  [BTN.DOWN, 'toggleGearbox'],
  [BTN.MENU, 'pause'],
];

const FOCUSABLE =
  'button, a[href], input:not([type=hidden]):not([type=checkbox]), select, textarea, label.switch, label.switch-row, .car-card, [tabindex]:not([tabindex="-1"])';

let prev: boolean[] = [];
let mode: 'drive' | 'menu' = 'menu';
let held = new Set<ControlAction>();
let navDir = '';
let navNext = 0;
let connected = false;

export function initGamepad(): void {
  if (typeof navigator.getGamepads !== 'function') return;
  window.addEventListener('gamepadconnected', (e) => {
    connected = true;
    toast(t('Controller connected: {name}', { name: shortName(e.gamepad.id) }));
  });
  window.addEventListener('gamepaddisconnected', () => {
    connected = !!activePad();
    release();
    toast(t('Controller disconnected'));
  });
  // a mouse move gives the focus ring back to the mouse
  window.addEventListener('mousemove', () => document.documentElement.classList.remove('pad-nav'), { passive: true });
  requestAnimationFrame(loop);
}

/** True while a controller is plugged in (and has been touched once, as browsers require). */
export function controllerConnected(): boolean {
  return connected;
}

/** A short jolt, 0…1, e.g. on a wall hit. */
export function rumble(strength: number): void {
  const pad = activePad();
  const s = Math.min(1, Math.max(0, strength));
  if (!pad || !settings.pad.vibration || s < 0.05) return;
  void pad.vibrationActuator?.playEffect?.('dual-rumble', { duration: 90 + 160 * s, strongMagnitude: s, weakMagnitude: Math.min(1, s * 0.7) }).catch(() => {});
}

function activePad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? [];
  let any: Gamepad | null = null;
  for (const p of pads) {
    if (!p || !p.connected) continue;
    if (p.mapping === 'standard') return p;
    any ??= p;
  }
  return any;
}

function shortName(id: string): string {
  return (
    id
      .replace(/\s*\(.*?\)\s*/g, ' ')
      .trim()
      .slice(0, 40) || t('Controller')
  );
}

function loop(): void {
  requestAnimationFrame(loop);
  const pad = activePad();
  if (!pad) {
    if (padInput.active) release();
    return;
  }
  connected = true;
  const now = pad.buttons.map((b) => b.pressed);
  const pressed = (i: number) => !!now[i] && !prev[i];
  const race = document.querySelector('.race-ui');
  const blocked = document.querySelector('.modal, .pit-menu, .results');
  const next = race && !blocked ? 'drive' : 'menu';
  if (next !== mode) {
    release();
    mode = next;
    // the button that switched the mode (Start, A on "Resume"…) must not act again in the new one
    prev = now;
    return;
  }
  if (mode === 'drive') drive(pad, now, pressed, !!race?.querySelector('.hud.spectating'));
  else menu(pad, pressed);
  prev = now;
}

/* ------------------------------------------------------------- driving --- */

function drive(pad: Gamepad, now: boolean[], pressed: (i: number) => boolean, spectating: boolean): void {
  const val = (i: number) => pad.buttons[i]?.value ?? 0;
  padInput.active = true;
  PAD.rateScale = settings.pad.steerSpeed;
  PAD.speedSens = settings.pad.speedSens;
  padInput.throttle = shapePedal(val(BTN.RT), 1.1);
  // a finer brake curve: the short trigger travel is spent mostly around the locking point (ACC "brake gamma")
  padInput.brake = shapePedal(val(BTN.LT), settings.pad.brakeCurve);
  padInput.handbrake = now[BTN.A] ? 1 : 0;
  padInput.steer = -shapeSteer(pad.axes[0] ?? 0); // + = left

  // A also confirms (skips the intro); the handbrake is harmless then
  if (pressed(BTN.A)) tapKey('Enter', 'Enter');
  if (spectating) {
    // change the car you watch
    if (pressed(BTN.LEFT) || pressed(BTN.LB)) tapKey('ArrowLeft', 'ArrowLeft');
    if (pressed(BTN.RIGHT) || pressed(BTN.RB)) tapKey('ArrowRight', 'ArrowRight');
    if (pressed(BTN.MENU)) tapAction('pause');
    return;
  }
  for (const [b, a] of TAP) if (pressed(b)) tapAction(a);
  const want = new Set<ControlAction>();
  for (const [b, a] of HOLD) if (now[b]) want.add(a);
  const rx = pad.axes[2] ?? 0;
  if (rx < -0.6) want.add('lookLeft');
  if (rx > 0.6) want.add('lookRight');
  for (const a of held) if (!want.has(a)) pressAction(a, false);
  for (const a of want) if (!held.has(a)) pressAction(a, true);
  held = want;
}

/**
 * Stick → steering: dead zone with the rest of the travel rescaled (no jump at its edge), full lock a little before
 * the rim (sticks rarely reach 1.0 on every angle) and the player's response curve: >1 = finer near centre for
 * small corrections at speed, still full lock at the rim.
 */
function shapeSteer(x: number): number {
  const dz = settings.pad.deadzone;
  const m = Math.min(1, Math.max(0, (Math.abs(x) - dz) / (0.97 - dz)));
  return Math.sign(x) * m ** settings.pad.steerCurve;
}

/** Trigger: a small rest dead zone, full value just before the end stop (worn triggers never read 1.0), curve. */
function shapePedal(v: number, curve: number): number {
  return v < 0.04 ? 0 : Math.min(1, (v - 0.04) / 0.92) ** curve;
}

function release(): void {
  for (const a of held) pressAction(a, false);
  held.clear();
  padInput.active = false;
  padInput.throttle = padInput.brake = padInput.handbrake = padInput.steer = 0;
  navDir = '';
}

/* --------------------------------------------------------------- menus --- */

function menu(pad: Gamepad, pressed: (i: number) => boolean): void {
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const b = pad.buttons;
  const dir =
    b[BTN.UP]?.pressed || ay < -0.6
      ? 'up'
      : b[BTN.DOWN]?.pressed || ay > 0.6
        ? 'down'
        : b[BTN.LEFT]?.pressed || ax < -0.6
          ? 'left'
          : b[BTN.RIGHT]?.pressed || ax > 0.6
            ? 'right'
            : '';
  const t0 = performance.now();
  if (dir && (dir !== navDir || t0 >= navNext)) {
    navNext = t0 + (dir === navDir ? 110 : 380); // first step, then auto-repeat
    navigate(dir);
  }
  navDir = dir;
  if (pressed(BTN.A)) activate();
  if (pressed(BTN.B) || pressed(BTN.MENU)) {
    const f = document.activeElement as HTMLElement | null;
    if (f && (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA')) f.blur(); // Esc must reach the window
    tapKey('Escape', 'Escape');
  }
}

/** Where the controls live right now: the topmost dialog, the pit box menu, or the whole screen. */
function scope(): ParentNode {
  const modals = document.querySelectorAll('.modal');
  if (modals.length) return modals[modals.length - 1];
  return document.querySelector('.pit-menu') ?? document;
}

function candidates(): HTMLElement[] {
  return [...scope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if ((el as HTMLButtonElement).disabled) return false;
    // the switch's own label covers it
    if (el.matches('label.switch') && el.closest('label.switch-row')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = window.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && !el.closest('.busy');
  });
}

function focusEl(el: HTMLElement): void {
  if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.tabIndex = -1;
  document.documentElement.classList.add('pad-nav');
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function navigate(dir: string): void {
  const list = candidates();
  if (!list.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || cur === document.body || !list.includes(cur)) {
    focusEl(list[0]);
    return;
  }
  // ←/→ change a dropdown or a slider instead of leaving it
  if (dir === 'left' || dir === 'right') {
    const step = dir === 'right' ? 1 : -1;
    if (cur instanceof HTMLSelectElement) {
      const i = Math.min(cur.options.length - 1, Math.max(0, cur.selectedIndex + step));
      if (i !== cur.selectedIndex) {
        cur.selectedIndex = i;
        cur.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    if (cur instanceof HTMLInputElement && cur.type === 'range') {
      if (step > 0) cur.stepUp();
      else cur.stepDown();
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      cur.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir] as [number, number];
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - ax;
    const dy = r.top + r.height / 2 - ay;
    const along = dx * v[0] + dy * v[1];
    if (along <= 4) continue;
    const across = Math.abs(dx * v[1] - dy * v[0]);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) focusEl(best);
}

function activate(): void {
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || cur === document.body || !candidates().includes(cur)) {
    const first = candidates()[0];
    if (first) focusEl(first);
    return;
  }
  if (cur instanceof HTMLInputElement && cur.type !== 'range') return; // a text field: type on the keyboard
  if (cur instanceof HTMLSelectElement) {
    cur.selectedIndex = (cur.selectedIndex + 1) % cur.options.length;
    cur.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  cur.click();
}

/* ------------------------------------------------------------- helpers --- */

const KEY_NAMES: Record<string, string> = { Escape: 'Escape', Tab: 'Tab', Space: ' ', Enter: 'Enter' };

function dispatchKey(code: string, key: string, down: boolean): void {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key, bubbles: true, cancelable: true }));
}

function tapKey(code: string, key: string): void {
  dispatchKey(code, key, true);
  dispatchKey(code, key, false);
}

/** Presses or releases the first key bound to an action. */
function pressAction(action: ControlAction, down: boolean): void {
  const code = settings.bindings[action][0];
  if (!code) return;
  dispatchKey(code, KEY_NAMES[code] ?? code.replace(/^Key/, '').toLowerCase(), down);
}

function tapAction(action: ControlAction): void {
  pressAction(action, true);
  pressAction(action, false);
}
