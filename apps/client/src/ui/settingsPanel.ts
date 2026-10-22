import { ACTION_LABEL, CONTROL_ACTIONS, DEFAULT_BINDINGS, DEFAULT_SETTINGS, saveSettings, settings, type ControlAction, type QualityPreset } from '../settings';
import { h } from './dom';
import { LANGUAGES, setLang, t } from '../i18n';
import { IS_APP } from '../mobile/platform';
import { padSetupBox } from '../input/padSetup';
import { touchSettingsSection } from '../mobile/touchSettings';

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  Escape: 'Esc',
};
const keyName = (c: string) => (c === 'Space' ? t('Space') : (KEY_NAMES[c] ?? c.replace(/^(Key|Digit)/, '')));

function arrowName(code: string): string {
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  return keyName(code);
}

/** Settings modal. `onChange` is called after every change (already saved). */
export function settingsPanel(onClose: () => void, onChange: () => void): HTMLElement {
  const changed = () => {
    saveSettings(settings);
    onChange();
  };

  const select = <T extends string>(value: T, options: [T, string][], set: (v: T) => void) => {
    const s = h('select', { onchange: () => set(s.value as T) }, ...options.map(([v, l]) => h('option', { value: v, text: l, selected: v === value })));
    return s;
  };
  const toggle = (value: boolean, set: (v: boolean) => void) => {
    const i = h('input', { type: 'checkbox', checked: value, onchange: () => set(i.checked) });
    return h('label.switch', {}, i, h('span'));
  };
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
      },
    });
    return h('div.range', {}, r, out);
  };
  const row = (label: string, ctrl: HTMLElement, hint?: string) =>
    h('div.set-row', {}, h('div', {}, h('span', { text: label }), hint ? h('small', { text: hint }) : null), ctrl);

  const graphics = h(
    'section',
    {},
    h('h3', { text: t('Language') }),
    row(
      'Language / Idioma',
      select(settings.language, LANGUAGES, (v) => {
        settings.language = v;
        setLang(v);
        changed();
      }),
    ),
    h('h3', { text: t('Graphics') }),
    row(
      t('Quality preset'),
      select<QualityPreset>(
        settings.quality,
        [
          ['low', t('Low')],
          ['medium', t('Medium')],
          ['high', t('High')],
          ['ultra', t('Ultra')],
        ],
        (v) => {
          settings.quality = v;
          changed();
        },
      ),
    ),
    row(
      t('Resolution scale'),
      range(
        settings.resolutionScale,
        0.5,
        1,
        0.05,
        (v) => `${Math.round(v * 100)} %`,
        (v) => {
          settings.resolutionScale = v;
          changed();
        },
      ),
    ),
    row(
      t('Dynamic resolution'),
      toggle(settings.dynamicResolution, (v) => {
        settings.dynamicResolution = v;
        changed();
      }),
      t('Lowers resolution briefly to stay above 45 fps'),
    ),
    row(
      t('Field of view'),
      range(
        settings.fov,
        55,
        95,
        1,
        (v) => `${v}°`,
        (v) => {
          settings.fov = v;
          changed();
        },
      ),
    ),
    row(
      t('Seat height'),
      range(
        settings.seatHeight,
        -0.15,
        0.2,
        0.01,
        (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)} cm`,
        (v) => {
          settings.seatHeight = v;
          changed();
        },
      ),
      t('Raise the cockpit camera to see more road'),
    ),
    row(
      t('Seat position'),
      range(
        settings.seatForward,
        -0.25,
        0.25,
        0.01,
        (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)} cm`,
        (v) => {
          settings.seatForward = v;
          changed();
        },
      ),
      t('Forward / back'),
    ),
    row(
      t('Performance overlay'),
      toggle(settings.showPerf, (v) => {
        settings.showPerf = v;
        changed();
      }),
    ),
  );

  const assists = h(
    'section',
    {},
    h('h3', { text: t('Driving') }),
    row(
      t('ABS'),
      toggle(settings.assists.abs, (v) => {
        settings.assists.abs = v;
        changed();
      }),
    ),
    row(
      t('Traction control'),
      select(
        String(settings.assists.tc) as '0' | '1' | '2',
        [
          ['0', t('Off')],
          ['1', t('Low')],
          ['2', t('High')],
        ],
        (v) => {
          settings.assists.tc = Number(v) as 0 | 1 | 2;
          changed();
        },
      ),
    ),
    row(
      t('Stability control'),
      toggle(settings.assists.stability, (v) => {
        settings.assists.stability = v;
        changed();
      }),
    ),
    row(
      t('Steering assist'),
      toggle(settings.assists.steering, (v) => {
        settings.assists.steering = v;
        changed();
      }),
      t('Automatic counter-steer'),
    ),
    row(
      t('Racing line'),
      select(
        settings.racingLine,
        [
          ['off', t('Off')],
          ['corners', t('Braking zones')],
          ['full', t('Full lap')],
        ],
        (v) => {
          settings.racingLine = v;
          changed();
        },
      ),
      t('Red: brake · yellow: lift · green: throttle'),
    ),
    row(
      t('Best-lap ghost'),
      toggle(settings.ghost, (v) => {
        settings.ghost = v;
        changed();
      }),
      t('Your best valid lap replayed as a ghost car'),
    ),
    row(
      t('Manual gearbox'),
      toggle(settings.manualGearbox, (v) => {
        settings.manualGearbox = v;
        changed();
      }),
    ),
    row(
      t('Speed units'),
      select(
        settings.units,
        [
          ['kmh', 'km/h'],
          ['mph', 'mph'],
        ],
        (v) => {
          settings.units = v;
          changed();
        },
      ),
    ),
  );

  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const sound = h(
    'section',
    {},
    h('h3', { text: t('Sound') }),
    row(
      t('Master volume'),
      range(settings.audio.master, 0, 1, 0.05, pct, (v) => {
        settings.audio.master = v;
        changed();
      }),
    ),
    row(
      t('Engines'),
      range(settings.audio.engine, 0, 1, 0.05, pct, (v) => {
        settings.audio.engine = v;
        changed();
      }),
      t('Your car and the cars around you'),
    ),
    row(
      t('Effects'),
      range(settings.audio.effects, 0, 1, 0.05, pct, (v) => {
        settings.audio.effects = v;
        changed();
      }),
      t('Tyres, kerbs, wind, impacts, beeps'),
    ),
    row(
      t('Ambience'),
      range(settings.audio.ambience, 0, 1, 0.05, pct, (v) => {
        settings.audio.ambience = v;
        changed();
      }),
      t('Crowd, birds, wind in the trees, thunder'),
    ),
  );

  const controls = h(
    'section',
    {},
    h('h3', { text: t('Controls') }),
    h('p.muted', { text: t('Click a key to rebind it, then press the new key. Esc cancels.') }),
  );
  const renderControls = () => {
    controls.querySelectorAll('.set-row').forEach((e) => e.remove());
    for (const a of CONTROL_ACTIONS) {
      const keys = h('div.keys');
      settings.bindings[a].forEach((code, idx) => {
        const b = h('button.key', { text: arrowName(code), onclick: () => capture(a, idx, b) });
        keys.append(b);
      });
      if (settings.bindings[a].length < 2) {
        const b = h('button.key.add', { text: '+', onclick: () => capture(a, settings.bindings[a].length, b) });
        keys.append(b);
      }
      controls.append(row(t(ACTION_LABEL[a]), keys));
    }
  };
  const capture = (a: ControlAction, idx: number, btn: HTMLElement) => {
    btn.textContent = '…';
    btn.classList.add('listening');
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', onKey, true);
      if (e.code !== 'Escape' || a === 'pause') {
        // a key can only do one thing
        for (const other of CONTROL_ACTIONS) settings.bindings[other] = settings.bindings[other].filter((k) => k !== e.code);
        const list = settings.bindings[a].slice();
        list[idx] = e.code;
        settings.bindings[a] = list.filter(Boolean);
        changed();
      }
      renderControls();
    };
    window.addEventListener('keydown', onKey, true);
  };
  renderControls();
  const resetBtn = h('button.ghost', {
    text: t('Reset controls'),
    onclick: () => {
      settings.bindings = structuredClone(DEFAULT_BINDINGS);
      changed();
      renderControls();
    },
  });
  controls.append(resetBtn);

  const padRow = (btn: string, what: string) => h('div.pad-map-row', {}, h('b', { text: btn }), h('span', { text: what }));
  const pad = h(
    'section',
    {},
    h('h3', { text: t('Controller') }),
    h('p.muted', {
      text: t('Plug in or connect a gamepad (Xbox, PlayStation…) and press any button. Menus: D-pad or stick to move, A to select, B to go back.'),
    }),
    padSetupBox(),
    row(
      t('Steering curve'),
      range(
        settings.pad.steerCurve,
        1,
        3,
        0.1,
        (v) => v.toFixed(1),
        (v) => {
          settings.pad.steerCurve = v;
          changed();
        },
      ),
      t('Higher = finer near the centre, same full lock'),
    ),
    row(
      t('Steering speed'),
      range(
        settings.pad.steerSpeed,
        0.5,
        1.6,
        0.05,
        (v) => `${Math.round(v * 100)} %`,
        (v) => {
          settings.pad.steerSpeed = v;
          changed();
        },
      ),
      t('How fast the front wheels follow the stick'),
    ),
    row(
      t('Speed sensitivity'),
      range(
        settings.pad.speedSens,
        0,
        1,
        0.05,
        (v) => `${Math.round(v * 100)} %`,
        (v) => {
          settings.pad.speedSens = v;
          changed();
        },
      ),
      t('Calmer steering at high speed'),
    ),
    row(
      t('Stick dead zone'),
      range(
        settings.pad.deadzone,
        0,
        0.25,
        0.01,
        (v) => `${Math.round(v * 100)} %`,
        (v) => {
          settings.pad.deadzone = v;
          changed();
        },
      ),
      t('Raise it if the car drifts with the stick centred'),
    ),
    row(
      t('Brake curve'),
      range(
        settings.pad.brakeCurve,
        1,
        2.5,
        0.1,
        (v) => v.toFixed(1),
        (v) => {
          settings.pad.brakeCurve = v;
          changed();
        },
      ),
      t('Higher = more trigger travel near the locking point'),
    ),
    row(
      t('Vibration'),
      toggle(settings.pad.vibration, (v) => {
        settings.pad.vibration = v;
        changed();
      }),
    ),
    h(
      'div.pad-map',
      {},
      padRow('RT / LT', t('Throttle / brake')),
      padRow(t('Left stick'), t('Steer')),
      padRow('A', t('Handbrake · skip intro')),
      padRow('RB / B', t('Shift up')),
      padRow('LB / X', t('Shift down')),
      padRow('Y / R3', t('Look back')),
      padRow(t('Right stick'), t('Look left / right')),
      padRow(t('D-pad ↑ / ↓'), t('Reset to track / manual-automatic')),
      padRow('View', t('Timing screen (hold)')),
      padRow('Menu', t('Pause menu')),
    ),
    h('button.ghost', {
      text: t('Reset controller settings'),
      onclick: () => {
        settings.pad = { ...structuredClone(DEFAULT_SETTINGS.pad), layouts: settings.pad.layouts };
        changed();
        pad.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r, i) => {
          r.value = String([settings.pad.steerCurve, settings.pad.steerSpeed, settings.pad.speedSens, settings.pad.deadzone, settings.pad.brakeCurve][i]);
          r.dispatchEvent(new Event('input'));
        });
      },
    }),
  );

  const panel: HTMLElement = h(
    'div.modal',
    { onclick: (e: Event) => e.target === panel && onClose() },
    h(
      'div.modal-card.settings',
      {},
      h('header', {}, h('h2', { text: t('Settings') }), h('button.icon', { text: '✕', title: t('Close'), onclick: onClose })),
      h('div.settings-grid', {}, graphics, assists, sound, IS_APP ? touchSettingsSection() : controls, pad),
    ),
  );
  return panel;
}
