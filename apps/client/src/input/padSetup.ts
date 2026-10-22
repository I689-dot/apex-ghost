import { h } from '../ui/dom';
import { t } from '../i18n';
import { saveSettings, settings } from '../settings';
import { activePad, pausePad } from './gamepad';
import { layoutFor, padKey, readPad, STD_BUTTONS, type PadLayout, type PadSource } from './padMap';

/**
 * Settings → Controller: a live view of what the browser reads from the controller, and a button setup that asks
 * for each control in turn. The setup is saved per controller and works for any pad the browser can see, even
 * ones it reports without the standard layout.
 */

type Step = { label: string; button?: number; axis?: number };
const STEPS = (): Step[] => [
  { label: t('Press THROTTLE'), button: 7 },
  { label: t('Press BRAKE'), button: 6 },
  { label: t('Push the steering stick to the RIGHT'), axis: 0 },
  { label: t('Press HANDBRAKE (also "select" in menus)'), button: 0 },
  { label: t('Press BACK in menus (also shift up)'), button: 1 },
  { label: t('Press SHIFT UP'), button: 5 },
  { label: t('Press SHIFT DOWN'), button: 4 },
  { label: t('Press LOOK BACK'), button: 3 },
  { label: t('Press PAUSE'), button: 9 },
  { label: t('Press TIMING SCREEN'), button: 8 },
  { label: t('Press D-pad UP (menus, reset car)'), button: 12 },
  { label: t('Press D-pad DOWN (menus, gearbox)'), button: 13 },
  { label: t('Press D-pad LEFT'), button: 14 },
  { label: t('Press D-pad RIGHT'), button: 15 },
];

const LAYOUT_NAME: Record<string, string> = {
  custom: 'Your setup',
  standard: 'Standard',
  builtin: 'Built-in (Switch Pro type)',
  raw: 'Unknown: set up the buttons below',
};

export function padSetupBox(): HTMLElement {
  const status = h('p.pad-status');
  const live = h('p.pad-live.muted');
  const prompt = h('p.pad-prompt');
  const startBtn = h('button', { text: t('Set up buttons…') });
  const skipBtn = h('button.ghost', { text: t('Skip') });
  const cancelBtn = h('button.ghost', { text: t('Cancel') });
  const clearBtn = h('button.ghost', { text: t('Remove my setup') });
  const wizard = h('div.pad-wizard', {}, prompt, h('div.pad-wizard-btns', {}, skipBtn, cancelBtn));
  wizard.hidden = true;
  const box = h('div.pad-setup', {}, status, live, h('div.pad-wizard-btns', {}, startBtn, clearBtn), wizard);

  /* ------------------------------------------------------------ wizard --- */
  let steps: Step[] = [];
  let i = -1;
  let layout: PadLayout | null = null;
  let key = '';
  let base: { b: boolean[]; a: number[] } | null = null;
  let waitRelease = true;

  const finish = (save: boolean) => {
    if (save && layout && key) {
      settings.pad.layouts = { ...settings.pad.layouts, [key]: layout };
      saveSettings(settings);
    }
    i = -1;
    wizard.hidden = true;
    startBtn.hidden = false;
    pausePad(false);
  };
  const next = () => {
    i++;
    waitRelease = true;
    still = 0;
    base = null;
    if (i >= steps.length) finish(true);
    else prompt.textContent = `${i + 1}/${steps.length} · ${steps[i].label}`;
  };
  startBtn.onclick = () => {
    const p = activePad();
    if (!p) {
      prompt.textContent = '';
      status.textContent = t('No controller found. Connect it and press any button on it while this page is open.');
      return;
    }
    key = padKey(p.id);
    // skipped steps keep what the pad does now
    const cur = layoutFor(p).layout;
    layout = cur
      ? structuredClone(cur)
      : {
          buttons: Array.from({ length: STD_BUTTONS }, (_, k): PadSource | null => (k < p.buttons.length ? { b: k } : null)),
          axes: [0, 1, 2, 3].map((k) => (k < p.axes.length ? { a: k, dir: 1 as const } : null)),
        };
    steps = STEPS();
    i = -1;
    wizard.hidden = false;
    startBtn.hidden = true;
    pausePad(true);
    next();
  };
  skipBtn.onclick = next;
  cancelBtn.onclick = () => finish(false);
  clearBtn.onclick = () => {
    const p = activePad();
    const k = p ? padKey(p.id) : '';
    const rest = { ...settings.pad.layouts };
    delete rest[k];
    settings.pad.layouts = rest;
    saveSettings(settings);
  };

  /** The control learned last: the next question waits until it is let go. */
  let held: { b: number } | { a: number; from: number } | null = null;
  let still = 0;
  let lastAxes: number[] = [];

  const learn = (p: Gamepad) => {
    const b = p.buttons.map((x) => x.pressed);
    const a = [...p.axes];
    if (waitRelease) {
      // the control just learned is let go, no button is down, and the axes have settled for a moment
      if (held && 'b' in held && b[held.b]) return;
      if (held && 'a' in held && Math.abs(a[held.a] - held.from) < 0.5) return;
      if (b.some(Boolean)) return;
      const moving = a.some((v, k) => Math.abs(v - (lastAxes[k] ?? v)) > 0.05);
      lastAxes = a;
      still = moving ? 0 : still + 1;
      if (still < 6) return;
      // rest: a trigger on an axis rests at ±1, a stick or a hat at 0
      base = { b, a: a.map((v) => (Math.abs(v) > 0.8 ? Math.sign(v) : Math.abs(v) < 0.2 ? 0 : v)) };
      waitRelease = false;
      held = null;
      return;
    }
    if (!base || !layout) return;
    const step = steps[i];
    const pressed = b.findIndex((x, k) => x && !base!.b[k]);
    let moved = -1;
    for (let k = 0; k < a.length; k++)
      if (Math.abs(a[k] - base.a[k]) > 0.6 && (moved < 0 || Math.abs(a[k] - base.a[k]) > Math.abs(a[moved] - base.a[moved]))) moved = k;
    if (step.axis !== undefined) {
      if (moved < 0) return;
      const dir = a[moved] > base.a[moved] ? 1 : -1;
      layout.axes[0] = { a: moved, dir };
      // the vertical axis of the same stick usually follows it
      if (moved + 1 < a.length) layout.axes[1] = { a: moved + 1, dir: 1 };
      held = { a: moved, from: a[moved] };
    } else if (step.button !== undefined) {
      if (pressed >= 0) {
        layout.buttons[step.button] = { b: pressed };
        held = { b: pressed };
      } else if (moved >= 0) {
        layout.buttons[step.button] = { a: moved, dir: a[moved] > base.a[moved] ? 1 : -1, rest: base.a[moved] };
        held = { a: moved, from: a[moved] };
      } else return;
    }
    next();
  };

  /* -------------------------------------------------------- live view --- */
  const tick = () => {
    if (!box.isConnected) {
      if (i >= 0) finish(false);
      return;
    }
    requestAnimationFrame(tick);
    const p = activePad();
    clearBtn.hidden = !p || !settings.pad.layouts[padKey(p.id)];
    if (!p) {
      status.textContent = t('No controller found. Connect it and press any button on it while this page is open.');
      live.textContent = '';
      return;
    }
    if (i >= 0) learn(p);
    const v = readPad(p);
    status.textContent = `${t('Controller')}: ${p.id.slice(0, 60)} · ${t(LAYOUT_NAME[v.layout])}`;
    const rawB = p.buttons.flatMap((x, k) => (x.pressed ? [k] : [])).join(' ') || '–';
    const rawA = p.axes.map((x) => x.toFixed(2)).join(' ');
    live.textContent =
      `${t('Throttle')} ${v.buttons[7].value.toFixed(2)} · ${t('Brake')} ${v.buttons[6].value.toFixed(2)} · ${t('Steer')} ${v.axes[0].toFixed(2)}` +
      ` — ${t('raw buttons')}: ${rawB} · ${t('axes')}: ${rawA}`;
  };
  requestAnimationFrame(tick);
  return box;
}
