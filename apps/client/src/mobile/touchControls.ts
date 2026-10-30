import { h } from '../ui/dom';
import { ICONS } from '../ui/icons';
import { t } from '../i18n';
import { settings, type ControlAction } from '../settings';
import { touchInput } from '../physics/input';
import { onTouchPrefs, touchPrefs } from './touchSettings';

/**
 * On-screen driving controls of the mobile app. They sit over the race UI and drive the game through the
 * existing input path, so the session code does not know about touch at all:
 *  - steering and pedals write `touchInput` (physics/input.ts), which the InputSmoother merges with the keys;
 *    the physics-step filters (keyboardDriver.ts) then apply the same rate limits, speed-sensitive steering
 *    and slip-based limit as for the keyboard, so a full tilt at 250 km/h is a lane change, not a spin;
 *  - the buttons (gears, look back, reset, pause, timing, handbrake) press the bound keys with synthetic
 *    keyboard events, exactly like a key press.
 * The overlay shows itself whenever a race UI is on screen (polled, no hooks in session.ts / app.ts).
 */
export class TouchControls {
  readonly el: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private steerPad: HTMLElement;
  private knob: HTMLElement;
  private tiltBar: HTMLElement;
  private brake: HTMLElement;
  private throttle: HTMLElement;
  private skip: HTMLElement;
  private gearboxBtn: HTMLElement;
  private steerPointers = new Map<number, number>();
  private sliderOrigin = new Map<number, number>();
  private tiltRaw = 0;
  private tiltOn = false;
  private visible = false;

  constructor() {
    this.knob = h('div.tc-knob');
    this.steerPad = h('div.tc-steer', {}, h('div.tc-arrow.l', { html: ICONS.left }), this.knob, h('div.tc-arrow.r', { html: ICONS.right }));
    this.tiltBar = h('div.tc-tilt', {}, h('i'), h('span', { text: t('TILT') }));
    this.brake = this.pedal('tc-brake', t('BRAKE'), (v) => (touchInput.brake = v));
    this.throttle = this.pedal('tc-throttle', t('GAS'), (v) => (touchInput.throttle = v));
    this.left = h('div.tc-left');
    this.right = h('div.tc-right');
    this.skip = h('button.tc-btn.tc-skip', { text: t('Skip intro') });
    this.skip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dispatchKey('Enter', 'Enter', true);
      dispatchKey('Enter', 'Enter', false);
    });
    this.gearboxBtn = this.tap('tc-gearbox', settings.manualGearbox ? 'MAN' : 'AUTO', 'toggleGearbox', t('Manual / automatic'));
    const top = h(
      'div.tc-top',
      {},
      this.tap('tc-pause', 'II', 'pause', t('Pause menu')),
      this.hold('tc-timing', t('TIMES'), 'timing'),
      this.hold('tc-look', t('BACK'), 'lookBack', t('Look back')),
      this.tap('tc-reset', ICONS.reset, 'resetCar', t('Reset to track')),
      this.tap('tc-cam', 'CAM', 'camera', t('Change camera')),
      this.gearboxBtn,
    );
    const gears = h(
      'div.tc-gears',
      {},
      this.tap('tc-up', '+', 'shiftUp', t('Shift up')),
      this.tap('tc-down', '−', 'shiftDown', t('Shift down')),
      this.hold('tc-hb', t('HB'), 'handbrake', t('Handbrake')),
    );
    const spec = h('div.tc-spec', {}, this.specBtn(ICONS.left, 'ArrowLeft'), this.specBtn(ICONS.right, 'ArrowRight'));
    this.el = h('div.touch-controls', {}, top, this.left, h('div.tc-right-wrap', {}, gears, this.right), this.skip, spec);
    this.bindSteer();
    this.layout();
    onTouchPrefs(() => this.layout());
    document.body.append(this.el);
    window.setInterval(this.poll, 200);
    window.addEventListener('devicemotion', this.onMotion);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.releaseAll);
  }

  /** Puts the steering and pedals where the thumbs are for the chosen steering mode. */
  private layout(): void {
    const mode = touchPrefs.steer;
    this.el.dataset.steer = mode;
    this.el.style.setProperty('--tc-scale', String(touchPrefs.size));
    this.el.style.setProperty('--tc-alpha', String(touchPrefs.opacity));
    this.left.replaceChildren();
    this.right.replaceChildren();
    if (mode === 'tilt') {
      // tilt: brake under the left thumb, throttle under the right, as in mobile racing games
      this.left.append(this.brake, this.tiltBar);
      this.right.append(this.throttle);
      void requestMotionPermission();
    } else {
      this.left.append(this.steerPad);
      this.right.append(this.brake, this.throttle);
    }
    this.releaseAll();
  }

  /* ------------------------------------------------------------ widgets --- */

  private pedal(cls: string, label: string, set: (v: number) => void): HTMLElement {
    const el = h(`div.tc-pedal.${cls}`, {}, h('span', { text: label }));
    const ids = new Set<number>();
    const update = () => {
      set(ids.size ? 1 : 0);
      el.classList.toggle('down', ids.size > 0);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      ids.add(e.pointerId);
      update();
    });
    const up = (e: PointerEvent) => {
      ids.delete(e.pointerId);
      update();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    this.releasers.push(() => {
      ids.clear();
      update();
    });
    return el;
  }

  private releasers: (() => void)[] = [];

  /** A button that taps a bound key once. */
  private tap(cls: string, label: string, action: ControlAction, title?: string): HTMLElement {
    const icon = label.startsWith('<svg');
    const b = h(`button.tc-btn.${cls}`, { [icon ? 'html' : 'text']: label, title, 'aria-label': title ?? (icon ? cls : label) });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pressAction(action, true);
      pressAction(action, false);
      buzz(8);
      b.classList.add('down');
      window.setTimeout(() => b.classList.remove('down'), 120);
    });
    return b;
  }

  /** A button that holds a bound key while touched. */
  private hold(cls: string, label: string, action: ControlAction, title?: string): HTMLElement {
    const icon = label.startsWith('<svg');
    const b = h(`button.tc-btn.${cls}`, { [icon ? 'html' : 'text']: label, title, 'aria-label': title ?? (icon ? cls : label) });
    let held = false;
    const release = () => {
      if (!held) return;
      held = false;
      b.classList.remove('down');
      pressAction(action, false);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      held = true;
      b.classList.add('down');
      pressAction(action, true);
    });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    this.releasers.push(release);
    return b;
  }

  private specBtn(label: string, key: 'ArrowLeft' | 'ArrowRight'): HTMLElement {
    const b = h('button.tc-btn', { html: label });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dispatchKey(key, key, true);
      dispatchKey(key, key, false);
    });
    return b;
  }

  /** Arrow buttons (left / right half of the pad, a thumb can slide across) or the drag slider. */
  private bindSteer(): void {
    const pad = this.steerPad;
    const read = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      if (touchPrefs.steer === 'slider') {
        // drag from where the thumb landed: a fifth of the pad's width either way is full lock
        const x0 = this.sliderOrigin.get(e.pointerId) ?? e.clientX;
        const v = Math.max(-1, Math.min(1, (x0 - e.clientX) / (r.width * 0.32)));
        this.steerPointers.set(e.pointerId, Math.abs(v) < 0.04 ? 0 : v);
      } else this.steerPointers.set(e.pointerId, e.clientX < r.left + r.width / 2 ? 1 : -1);
      this.applySteer();
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      this.sliderOrigin.set(e.pointerId, e.clientX);
      read(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (this.steerPointers.has(e.pointerId)) read(e);
    });
    const up = (e: PointerEvent) => {
      this.steerPointers.delete(e.pointerId);
      this.sliderOrigin.delete(e.pointerId);
      this.applySteer();
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    this.releasers.push(() => {
      this.steerPointers.clear();
      this.sliderOrigin.clear();
      this.applySteer();
    });
  }

  private applySteer(): void {
    if (touchPrefs.steer === 'tilt') return;
    let v = 0;
    for (const s of this.steerPointers.values()) v = s; // the latest thumb wins
    touchInput.steer = v;
    this.steerPad.classList.toggle('left', v > 0);
    this.steerPad.classList.toggle('right', v < 0);
    this.knob.style.transform = `translateX(${(-v * 34).toFixed(1)}%)`;
  }

  /* --------------------------------------------------------------- tilt --- */

  private onMotion = (e: DeviceMotionEvent): void => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null || g.z === null) return;
    // device axes → screen axes for the current rotation (landscape: 90 or 270)
    const a = (((screen.orientation?.angle ?? 0) % 360) * Math.PI) / 180;
    const sx = g.x * Math.cos(a) - g.y * Math.sin(a);
    const sy = g.x * Math.sin(a) + g.y * Math.cos(a);
    // lean of the phone's horizontal axis, stable whether it is held upright or tipped back
    const lean = Math.atan2(sx, Math.hypot(sy, g.z)) * (180 / Math.PI);
    this.tiltRaw += (lean - this.tiltRaw) * 0.35; // ~60 Hz sensor: a light low-pass against hand shake
    this.tiltOn = true;
    if (touchPrefs.steer !== 'tilt') return;
    const dead = 1.5;
    const mag = Math.max(0, Math.abs(this.tiltRaw) - dead) / Math.max(5, touchPrefs.tiltRange - dead);
    const v = Math.min(1, mag) * Math.sign(this.tiltRaw) * (touchPrefs.tiltInvert ? -1 : 1);
    touchInput.steer = v;
    (this.tiltBar.firstChild as HTMLElement).style.transform = `translateX(${(-v * 50).toFixed(1)}%)`;
  };

  /* -------------------------------------------------------------- state --- */

  private poll = (): void => {
    const race = document.querySelector('.race-ui');
    const show = !!race && !document.querySelector('.results');
    if (show !== this.visible) {
      this.visible = show;
      this.el.classList.toggle('on', show);
      touchInput.active = show;
      if (!show) this.releaseAll();
    }
    if (!show) return;
    const cine = race?.querySelector('.cinematic');
    this.el.classList.toggle('cine', !!cine && !cine.classList.contains('out'));
    this.el.classList.toggle('spectating', !!race?.querySelector('.hud.spectating'));
    this.el.classList.toggle('boxed', !!document.querySelector('.pit-menu'));
    this.el.classList.toggle('no-tilt', touchPrefs.steer === 'tilt' && !this.tiltOn);
    const gb = settings.manualGearbox ? 'MAN' : 'AUTO';
    if (this.gearboxBtn.textContent !== gb) this.gearboxBtn.textContent = gb;
    this.el.classList.toggle('manual', settings.manualGearbox);
  };

  private releaseAll = (): void => {
    for (const r of this.releasers) r();
    touchInput.throttle = touchInput.brake = touchInput.handbrake = 0;
    if (touchPrefs.steer !== 'tilt') touchInput.steer = 0;
  };
}

/* ------------------------------------------------------------- helpers --- */

function dispatchKey(code: string, key: string, down: boolean): void {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key, bubbles: true, cancelable: true }));
}

const KEY_NAMES: Record<string, string> = { Escape: 'Escape', Tab: 'Tab', Space: ' ', Enter: 'Enter' };

/** Presses or releases the first key bound to an action. */
function pressAction(action: ControlAction, down: boolean): void {
  const code = settings.bindings[action][0];
  if (!code) return;
  dispatchKey(code, KEY_NAMES[code] ?? code.replace(/^Key/, '').toLowerCase(), down);
}

function buzz(ms: number): void {
  if (!touchPrefs.haptics) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

/** iOS asks before giving motion data (must follow a tap); Android grants it. */
async function requestMotionPermission(): Promise<void> {
  const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  try {
    await DM?.requestPermission?.();
  } catch {
    /* denied or needs a gesture: the tilt indicator shows it is not working */
  }
}
