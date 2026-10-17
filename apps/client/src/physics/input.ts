import type { ControlAction, KeyBindings } from '../settings';

/** Raw digital key state, updated by DOM events. */
export class Keyboard {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private bindings: KeyBindings;

  constructor(bindings: KeyBindings) {
    this.bindings = bindings;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    // a key released while the tab is hidden never sends keyup: drop everything
    document.addEventListener('visibilitychange', this.onBlur);
  }

  setBindings(b: KeyBindings): void {
    this.bindings = b;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
  }

  private onDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  };

  private onUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onBlur = () => {
    this.down.clear();
  };

  held(a: ControlAction): boolean {
    for (const k of this.bindings[a]) if (this.down.has(k)) return true;
    return false;
  }

  /** True once per key press. Call `endFrame()` after reading. */
  tapped(a: ControlAction): boolean {
    for (const k of this.bindings[a]) if (this.pressed.has(k)) return true;
    return false;
  }

  endFrame(): void {
    this.pressed.clear();
  }
}

export interface Controls {
  throttle: number;
  brake: number;
  /** -1 (right) … +1 (left) */
  steer: number;
  handbrake: number;
  /** Keyboard targets (0/±1): the vehicle filters them every physics step. Bots send analog values. */
  digital?: boolean;
}

/**
 * Reads the keys into digital targets. All smoothing happens inside the physics step
 * (see keyboardDriver.ts), never per render frame.
 */
export class InputSmoother {
  readonly out: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, digital: true };

  update(_dt: number, kb: Keyboard, _speedMs: number, reverse: boolean): Controls {
    const up = kb.held('throttle');
    const down = kb.held('brake');
    // when reversing, the keys swap meaning (S drives backwards, W brakes)
    this.out.throttle = (reverse ? down : up) ? 1 : 0;
    this.out.brake = (reverse ? up : down) ? 1 : 0;
    this.out.handbrake = kb.held('handbrake') ? 1 : 0;
    const left = kb.held('steerLeft');
    const right = kb.held('steerRight');
    this.out.steer = left === right ? 0 : left ? 1 : -1;
    return this.out;
  }

  reset(): void {
    this.out.throttle = this.out.brake = this.out.steer = this.out.handbrake = 0;
  }
}
