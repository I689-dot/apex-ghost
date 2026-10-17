import { ACTION_LABEL, CONTROL_ACTIONS, DEFAULT_BINDINGS, saveSettings, settings, type ControlAction, type QualityPreset } from '../settings';
import { h } from './dom';

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  Escape: 'Esc',
};
const keyName = (c: string) => KEY_NAMES[c] ?? c.replace(/^(Key|Digit)/, '');

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
    h('h3', { text: 'Graphics' }),
    row(
      'Quality preset',
      select<QualityPreset>(
        settings.quality,
        [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
          ['ultra', 'Ultra'],
        ],
        (v) => {
          settings.quality = v;
          changed();
        },
      ),
    ),
    row(
      'Resolution scale',
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
      'Dynamic resolution',
      toggle(settings.dynamicResolution, (v) => {
        settings.dynamicResolution = v;
        changed();
      }),
      'Lowers resolution briefly to stay above 45 fps',
    ),
    row(
      'Field of view',
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
      'Seat height',
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
      'Raise the cockpit camera to see more road',
    ),
    row(
      'Seat position',
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
      'Forward / back',
    ),
    row(
      'Performance overlay',
      toggle(settings.showPerf, (v) => {
        settings.showPerf = v;
        changed();
      }),
    ),
  );

  const assists = h(
    'section',
    {},
    h('h3', { text: 'Driving' }),
    row(
      'ABS',
      toggle(settings.assists.abs, (v) => {
        settings.assists.abs = v;
        changed();
      }),
    ),
    row(
      'Traction control',
      select(
        String(settings.assists.tc) as '0' | '1' | '2',
        [
          ['0', 'Off'],
          ['1', 'Low'],
          ['2', 'High'],
        ],
        (v) => {
          settings.assists.tc = Number(v) as 0 | 1 | 2;
          changed();
        },
      ),
    ),
    row(
      'Stability control',
      toggle(settings.assists.stability, (v) => {
        settings.assists.stability = v;
        changed();
      }),
    ),
    row(
      'Steering assist',
      toggle(settings.assists.steering, (v) => {
        settings.assists.steering = v;
        changed();
      }),
      'Automatic counter-steer',
    ),
    row(
      'Racing line',
      select(
        settings.racingLine,
        [
          ['off', 'Off'],
          ['corners', 'Braking zones'],
          ['full', 'Full lap'],
        ],
        (v) => {
          settings.racingLine = v;
          changed();
        },
      ),
      'Red: brake · yellow: lift · green: throttle',
    ),
    row(
      'Best-lap ghost',
      toggle(settings.ghost, (v) => {
        settings.ghost = v;
        changed();
      }),
      'Your best valid lap replayed as a ghost car',
    ),
    row(
      'Manual gearbox',
      toggle(settings.manualGearbox, (v) => {
        settings.manualGearbox = v;
        changed();
      }),
    ),
    row(
      'Speed units',
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
    h('h3', { text: 'Sound' }),
    row(
      'Master volume',
      range(settings.audio.master, 0, 1, 0.05, pct, (v) => {
        settings.audio.master = v;
        changed();
      }),
    ),
    row(
      'Engines',
      range(settings.audio.engine, 0, 1, 0.05, pct, (v) => {
        settings.audio.engine = v;
        changed();
      }),
      'Your car and the cars around you',
    ),
    row(
      'Effects',
      range(settings.audio.effects, 0, 1, 0.05, pct, (v) => {
        settings.audio.effects = v;
        changed();
      }),
      'Tyres, kerbs, wind, impacts, beeps',
    ),
    row(
      'Ambience',
      range(settings.audio.ambience, 0, 1, 0.05, pct, (v) => {
        settings.audio.ambience = v;
        changed();
      }),
      'Crowd, birds, wind in the trees, thunder',
    ),
  );

  const controls = h('section', {}, h('h3', { text: 'Controls' }), h('p.muted', { text: 'Click a key to rebind it, then press the new key. Esc cancels.' }));
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
      controls.append(row(ACTION_LABEL[a], keys));
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
    text: 'Reset controls',
    onclick: () => {
      settings.bindings = structuredClone(DEFAULT_BINDINGS);
      changed();
      renderControls();
    },
  });
  controls.append(resetBtn);

  const panel: HTMLElement = h(
    'div.modal',
    { onclick: (e: Event) => e.target === panel && onClose() },
    h(
      'div.modal-card.settings',
      {},
      h('header', {}, h('h2', { text: 'Settings' }), h('button.icon', { text: '✕', title: 'Close', onclick: onClose })),
      h('div.settings-grid', {}, graphics, assists, sound, controls),
    ),
  );
  return panel;
}
