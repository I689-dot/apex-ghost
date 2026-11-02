import {
  ACTION_LABEL,
  CONTROL_ACTIONS,
  DEFAULT_BINDINGS,
  DEFAULT_SETTINGS,
  saveSettings,
  settings,
  type AntiAlias,
  type ControlAction,
  type GraphicsGroup,
  type QualityPreset,
} from '../settings';
import { h } from './dom';
import { ICONS } from './icons';
import { LANGUAGES, setLang, t } from '../i18n';
import { IS_APP } from '../mobile/platform';
import { applyFrameRate, frameRateChoices } from '../mobile/refreshRate';
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

  const general = h(
    'section',
    {},
    h('h3.keep', { text: t('Language') }),
    row(
      'Language / Idioma',
      select(settings.language, LANGUAGES, (v) => {
        settings.language = v;
        setLang(v);
        changed();
      }),
    ),
  );

  general.append(
    h('h3', { text: t('Display') }),
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
    row(
      t('Performance overlay'),
      toggle(settings.showPerf, (v) => {
        settings.showPerf = v;
        changed();
      }),
      t('Frame time, network and draw calls in a corner'),
    ),
    h('h3', { text: t('Race overlays') }),
    row(
      t('Relative'),
      toggle(settings.overlays.relative, (v) => {
        settings.overlays.relative = v;
        changed();
      }),
      t('The cars just ahead and behind on the road, with the time to each'),
    ),
    row(
      t('Delta bar'),
      toggle(settings.overlays.deltaBar, (v) => {
        settings.overlays.deltaBar = v;
        changed();
      }),
      t('Gaining or losing against your best lap, as a bar'),
    ),
    row(
      t('Inputs'),
      toggle(settings.overlays.inputs, (v) => {
        settings.overlays.inputs = v;
        changed();
      }),
      t('Throttle, brake and steering'),
    ),
    row(
      t('Circuit map'),
      toggle(settings.overlays.trackMap, (v) => {
        settings.overlays.trackMap = v;
        changed();
      }),
      t('The whole circuit with numbered corners and cars (off: the map turning with you)'),
    ),
    row(
      t('Spotter'),
      toggle(settings.overlays.spotter, (v) => {
        settings.overlays.spotter = v;
        changed();
      }),
      t('Marks the side of the screen when a car is alongside'),
    ),
  );

  const presetNote = h('p.muted.preset-note', { text: t(PRESET_NOTE[settings.quality]) });
  const detailSelects: HTMLSelectElement[] = [];
  const graphics = h(
    'section',
    {},
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
          // a preset sets everything: the individual settings below go back to it
          settings.graphics = {};
          for (const sel of detailSelects) sel.value = '';
          presetNote.textContent = t(PRESET_NOTE[v]);
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
    ...(IS_APP ? [frameRateRow()] : []),
    presetNote,
    h('h3', { text: t('Graphics in detail') }),
    h('p.muted.preset-note', { text: t('Each setting follows the preset unless you change it here.') }),
    ...graphicsDetailRows(row, detailSelects, changed),
  );

  const fovRange = range(
    settings.fov,
    25,
    95,
    1,
    (v) => `${v}°`,
    (v) => {
      settings.fov = v;
      changed();
    },
  );
  /**
   * The real field of view (iRacing's and ACC's FOV calculators): the screen's height and the eye's distance from it
   * give the angle the screen really covers, vertical FOV = 2·atan(height / 2·distance).
   */
  const fovCalc = () => {
    const size = h('input.auth-input', { type: 'number', min: 10, max: 120, step: 0.5, value: 27 });
    const dist = h('input.auth-input', { type: 'number', min: 20, max: 300, value: 65 });
    const ratio = h('select.auth-input', {}, ...['16:9', '16:10', '21:9', '32:9', '4:3'].map((r) => h('option', { value: r, text: r })));
    const out = h('b.fov-out');
    const use = h('button.ghost', { type: 'button' });
    const calc = () => {
      const [w, hh] = ratio.value.split(':').map(Number);
      const heightCm = (Number(size.value) * 2.54 * hh) / Math.hypot(w, hh);
      const v = Math.round((2 * Math.atan(heightCm / 2 / Math.max(1, Number(dist.value))) * 180) / Math.PI);
      out.textContent = `${v}°`;
      use.textContent = t('Use {n}°', { n: Math.max(25, v) });
      use.onclick = () => {
        settings.fov = Math.max(25, v);
        const input = fovRange.querySelector('input') as HTMLInputElement | null;
        if (input) {
          input.value = String(settings.fov);
          input.dispatchEvent(new Event('input'));
        }
        changed();
      };
    };
    for (const e of [size, dist, ratio]) e.addEventListener('input', calc);
    calc();
    return h(
      'div.fov-calc',
      {},
      h('label', {}, h('span', { text: t('Screen (inches)') }), size),
      h('label', {}, h('span', { text: t('Aspect') }), ratio),
      h('label', {}, h('span', { text: t('Eyes to screen (cm)') }), dist),
      h('div.fov-res', {}, h('span', { text: t('Real FOV') }), out, use),
    );
  };
  const camera = h(
    'section',
    {},
    h('h3', { text: t('Camera') }),
    row(
      t('Rear-view mirror'),
      toggle(settings.mirror, (v) => {
        settings.mirror = v;
        changed();
      }),
      t('What is behind you, at the top of the screen'),
    ),
    row(
      t('Pit stop camera'),
      select(
        settings.pitCamera,
        [
          ['tv', t('TV camera on the crew')],
          ['car', t('Stay in the car')],
        ],
        (v) => {
          settings.pitCamera = v;
          changed();
        },
      ),
    ),
    row(t('Field of view'), fovRange, t('Vertical, as iRacing and ACC count it: lower is more realistic on a desk monitor')),
    fovCalc(),
    row(
      t('Head movement'),
      range(
        settings.headMovement,
        0,
        1,
        0.05,
        (v) => `${Math.round(v * 100)} %`,
        (v) => {
          settings.headMovement = v;
          changed();
        },
      ),
      t('The head thrown by braking, acceleration and corners'),
    ),
    row(
      t('Camera shake'),
      range(
        settings.cameraShake,
        0,
        1,
        0.05,
        (v) => `${Math.round(v * 100)} %`,
        (v) => {
          settings.cameraShake = v;
          changed();
        },
      ),
      t('Kerbs, bumps and a flat-spotted tyre'),
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
    // team radio off for now:
    // row(
    //   t('Team radio'),
    //   range(settings.audio.radio, 0, 1, 0.05, pct, (v) => {
    //     settings.audio.radio = v;
    //     changed();
    //   }),
    //   t('Your race engineer and spotter: gaps, flags, pit calls, cars alongside'),
    // ),
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
    h('h3', { text: t('Steering wheel') }),
    h('p.muted', {
      text: t(
        'Logitech, Thrustmaster, Fanatec, Moza, Simucube and Simagic wheels are recognised. Set the wheel to 900° in its own software and the same here: each car then turns as far as the real one (BMW M4 516°, McLaren 480°, Porsche 800°). Map the pedals with the setup above.',
      ),
    }),
    row(
      t('Device'),
      select(
        settings.wheel.mode,
        [
          ['auto', t('Recognise wheels automatically')],
          ['wheel', t('Always a steering wheel')],
          ['pad', t('Always a gamepad')],
        ],
        (v) => {
          settings.wheel.mode = v;
          changed();
        },
      ),
    ),
    row(
      t('Wheel rotation'),
      range(
        settings.wheel.rotationDeg,
        180,
        1080,
        10,
        (v) => `${Math.round(v)}°`,
        (v) => {
          settings.wheel.rotationDeg = v;
          changed();
        },
      ),
      t("Lock to lock, as set on the wheel base: the car's own lock is used within it"),
    ),
    row(
      t('Brake pedal curve'),
      range(
        settings.wheel.brakeCurve,
        0.6,
        2.4,
        0.1,
        (v) => v.toFixed(1),
        (v) => {
          settings.wheel.brakeCurve = v;
          changed();
        },
      ),
      t('1 = linear; higher = more travel near the locking point (load-cell pedals: about 1)'),
    ),
    h('h3', { text: t('Gamepad') }),
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
      padRow(t('L3 / D-pad →'), t('Change camera')),
      padRow('View', t('Timing screen (hold)')),
      padRow('Menu', t('Pause menu')),
    ),
    h('button.ghost', {
      text: t('Reset controller settings'),
      onclick: () => {
        settings.pad = { ...structuredClone(DEFAULT_SETTINGS.pad), layouts: settings.pad.layouts };
        changed();
        // redrawn with the defaults
        panel.replaceWith(settingsPanel(onClose, onChange));
      },
    }),
  );

  // more options, after F1's, ACC's and iRacing's menus

  const num = (get: () => number, set: (v: number) => void, min: number, max: number, step: number, fmt: (v: number) => string) =>
    range(get(), min, max, step, fmt, (v) => {
      set(v);
      changed();
    });
  const flag = (get: () => boolean, set: (v: boolean) => void) =>
    toggle(get(), (v) => {
      set(v);
      changed();
    });
  const hud = settings.hud;
  general.append(
    h('h3', { text: t('HUD') }),
    row(
      t('HUD size'),
      num(
        () => hud.scale,
        (v) => (hud.scale = v),
        0.7,
        1.4,
        0.05,
        pct,
      ),
    ),
    row(
      t('HUD opacity'),
      num(
        () => hud.opacity,
        (v) => (hud.opacity = v),
        0.3,
        1,
        0.05,
        pct,
      ),
    ),
    row(
      t('Timing tower'),
      flag(
        () => hud.timing,
        (v) => (hud.timing = v),
      ),
    ),
    row(
      t('Lap and position'),
      flag(
        () => hud.lapInfo,
        (v) => (hud.lapInfo = v),
      ),
      t('Lap, position and the lap times'),
    ),
    row(
      t('Tyres and damage'),
      flag(
        () => hud.tyres,
        (v) => (hud.tyres = v),
      ),
    ),
    row(
      t('Shift lights'),
      flag(
        () => hud.revLights,
        (v) => (hud.revLights = v),
      ),
    ),
    row(
      t('On-screen messages'),
      flag(
        () => hud.messages,
        (v) => (hud.messages = v),
      ),
      t('Flags, penalties and lap messages'),
    ),
    row(
      t('Track map'),
      flag(
        () => hud.map,
        (v) => (hud.map = v),
      ),
    ),
    h('h3', { text: t('Picture') }),
    row(
      t('Brightness'),
      num(
        () => settings.brightness,
        (v) => (settings.brightness = v),
        0.6,
        1.5,
        0.05,
        pct,
      ),
    ),
  );
  camera.append(
    h('h3', { text: t('Chase camera') }),
    row(
      t('Distance'),
      num(
        () => settings.chase.distance,
        (v) => (settings.chase.distance = v),
        0.7,
        1.6,
        0.05,
        pct,
      ),
    ),
    row(
      t('Height'),
      num(
        () => settings.chase.height,
        (v) => (settings.chase.height = v),
        0.5,
        2,
        0.05,
        pct,
      ),
    ),
    row(
      t('Camera lag'),
      num(
        () => settings.chase.lag,
        (v) => (settings.chase.lag = v),
        0.3,
        2.5,
        0.05,
        pct,
      ),
      t('More: the car turns more in the frame before the camera follows'),
    ),
    row(
      t('Look to apex'),
      num(
        () => settings.lookToApex,
        (v) => (settings.lookToApex = v),
        0,
        2,
        0.1,
        pct,
      ),
      t('The cockpit view turns into corners with the steering'),
    ),
  );
  assists.append(
    h('h3', { text: t('AI drivers') }),
    row(
      t('AI difficulty'),
      num(
        () => settings.ai.difficulty,
        (v) => (settings.ai.difficulty = v),
        0.8,
        1.06,
        0.01,
        pct,
      ),
      t('Their pace in the races you play solo or host (from the next session)'),
    ),
  );
  sound.append(
    h('h3', { text: t('Mix') }),
    row(
      t('Opponents'),
      num(
        () => settings.audio.opponents,
        (v) => (settings.audio.opponents = v),
        0,
        1,
        0.05,
        pct,
      ),
      t("The other cars' engines"),
    ),
    row(
      t('Tyres and surfaces'),
      num(
        () => settings.audio.tyres,
        (v) => (settings.audio.tyres = v),
        0,
        1,
        0.05,
        pct,
      ),
      t('Squeal, kerbs, gravel, grass, scrapes'),
    ),
    row(
      t('Chimes and beeps'),
      flag(
        () => settings.audio.chimes,
        (v) => (settings.audio.chimes = v),
      ),
      t('Lap chimes and the start beeps'),
    ),
  );
  if (!IS_APP)
    controls.append(
      h('h3', { text: t('Keyboard') }),
      row(
        t('Throttle ramp'),
        num(
          () => settings.keyboard.throttleRamp,
          (v) => (settings.keyboard.throttleRamp = v),
          0.05,
          1.5,
          0.05,
          (v) => `${v.toFixed(2)} s`,
        ),
        t('Time from nothing to full throttle: longer, a tap gives part throttle'),
      ),
      row(
        t('Brake ramp'),
        num(
          () => settings.keyboard.brakeRamp,
          (v) => (settings.keyboard.brakeRamp = v),
          0.05,
          1.5,
          0.05,
          (v) => `${v.toFixed(2)} s`,
        ),
        t('Time from nothing to full brake'),
      ),
      row(
        t('Steering speed'),
        num(
          () => settings.keyboard.steerSpeed,
          (v) => (settings.keyboard.steerSpeed = v),
          0.5,
          1.6,
          0.05,
          pct,
        ),
      ),
    );
  const p = settings.pad;
  pad.append(
    h('h3', { text: t('Pedals') }),
    row(
      t('Pedals on'),
      select(
        p.pedals,
        [
          ['triggers', t('Triggers')],
          ['rightStick', t('Right stick (up / down)')],
        ],
        (v) => {
          p.pedals = v;
          changed();
        },
      ),
    ),
    row(
      t('Throttle dead zone'),
      num(
        () => p.throttleDeadzone,
        (v) => (p.throttleDeadzone = v),
        0,
        0.3,
        0.01,
        pct,
      ),
    ),
    row(
      t('Throttle saturation'),
      num(
        () => p.throttleSaturation,
        (v) => (p.throttleSaturation = v),
        0.5,
        1,
        0.01,
        pct,
      ),
      t('Where the trigger reaches 100 %'),
    ),
    row(
      t('Throttle curve'),
      num(
        () => p.throttleCurve,
        (v) => (p.throttleCurve = v),
        0.6,
        2.5,
        0.1,
        (v) => v.toFixed(1),
      ),
      t('1 = linear; higher = finer at the start'),
    ),
    row(
      t('Brake dead zone'),
      num(
        () => p.brakeDeadzone,
        (v) => (p.brakeDeadzone = v),
        0,
        0.3,
        0.01,
        pct,
      ),
    ),
    row(
      t('Brake saturation'),
      num(
        () => p.brakeSaturation,
        (v) => (p.brakeSaturation = v),
        0.5,
        1,
        0.01,
        pct,
      ),
    ),
    row(
      t('Steering saturation'),
      num(
        () => p.steerSaturation,
        (v) => (p.steerSaturation = v),
        0.6,
        1,
        0.01,
        pct,
      ),
      t('Stick travel for full lock'),
    ),
    row(
      t('On / off triggers ramp'),
      num(
        () => p.digitalRamp,
        (v) => (p.digitalRamp = v),
        0.1,
        2,
        0.05,
        (v) => `${v.toFixed(2)} s`,
      ),
      t('Triggers with no travel (Switch Pro): held, they reach full over this time'),
    ),
  );

  // tabs: one section at a time (the five side by side were a wall of rows, cut off on smaller screens)
  const tabs: [string, string, HTMLElement][] = [
    ['general', t('General'), general],
    ['graphics', t('Graphics'), graphics],
    ['camera', t('Camera'), camera],
    ['driving', t('Driving'), assists],
    ['sound', t('Sound'), sound],
    ['controls', IS_APP ? t('Touch') : t('Controls'), IS_APP ? touchSettingsSection() : controls],
    ['controller', t('Controller'), pad],
  ];
  let current = tabs.some(([k]) => k === lastTab()) ? lastTab() : 'general';
  const body = h('div.settings-body');
  const buttons = new Map<string, HTMLElement>();
  const show = (key: string) => {
    current = key;
    const tab = tabs.find(([k]) => k === key) ?? tabs[0];
    body.replaceChildren(tab[2]);
    for (const [k, b] of buttons) {
      b.classList.toggle('on', k === key);
      b.setAttribute('aria-selected', String(k === key));
    }
    try {
      localStorage.setItem(TAB_KEY, key);
    } catch {
      /* ignore */
    }
  };
  const tabBar = h(
    'div.settings-tabs',
    { role: 'tablist' },
    ...tabs.map(([k, label]) => {
      const b = h('button.settings-tab', { type: 'button', role: 'tab', text: label, onclick: () => show(k) });
      buttons.set(k, b);
      return b;
    }),
  );

  const panel: HTMLElement = h(
    'div.modal',
    { onclick: (e: Event) => e.target === panel && onClose() },
    h(
      'div.modal-card.settings',
      {},
      h('header', {}, h('h2', { text: t('Settings') }), h('button.icon', { html: ICONS.close, title: t('Close'), onclick: onClose })),
      tabBar,
      body,
    ),
  );
  show(current);
  return panel;
}

/** What each preset changes, under the preset menu. */
const PRESET_NOTE: Record<QualityPreset, string> = {
  low: 'Low: no shadows or post-processing, short view distance. For integrated graphics and phones.',
  medium: 'Medium: sun shadows, 3D grass near the track, the full cockpit.',
  high: 'High: soft shadows, ambient occlusion, bloom, reflections on the track, longer view distance.',
  ultra: 'Ultra: everything at its best, regardless of performance: 4K shadows, the densest grass and forest, the farthest view.',
};

/** The tab shown when the panel last closed (a per-browser convenience). */
const TAB_KEY = 'apexghost.settingsTab';
function lastTab(): string {
  try {
    return localStorage.getItem(TAB_KEY) ?? 'general';
  } catch {
    return 'general';
  }
}

/** Phone app: 60 Hz, or the 90 / 120 / 144 Hz modes of the screen (filled in once the phone has answered). */
function frameRateRow(): HTMLElement {
  const sel = h('select', {
    onchange: (e: Event) => {
      settings.refreshRate = Number((e.target as HTMLSelectElement).value);
      saveSettings(settings);
      void applyFrameRate();
    },
  }) as HTMLSelectElement;
  const fill = (rates: number[]) => {
    sel.replaceChildren(...rates.map((hz) => h('option', { value: String(hz), text: `${hz} Hz`, selected: hz === settings.refreshRate })));
    if (!rates.includes(settings.refreshRate)) sel.value = '60';
  };
  fill([60]);
  void frameRateChoices().then(fill);
  return h(
    'div.set-row',
    {},
    h('div', {}, h('span', { text: t('Frame rate') }), h('small', { text: t('90 / 120 / 144 Hz on phones that have it: smoother, uses more battery') })),
    sel,
  );
}

/** Settings → Graphics in detail: anti-aliasing, supersampling, and each group from Low to Ultra (or the preset's). */
function graphicsDetailRows(
  row: (label: string, ctrl: HTMLElement, hint?: string) => HTMLElement,
  selects: HTMLSelectElement[],
  changed: () => void,
): HTMLElement[] {
  const levels: [string, string][] = [
    ['', t('Preset')],
    ['low', t('Low')],
    ['medium', t('Medium')],
    ['high', t('High')],
    ['ultra', t('Ultra')],
  ];
  const sel = (value: string, options: [string, string][], set: (v: string) => void) => {
    const s = h(
      'select',
      { onchange: () => set(s.value) },
      ...options.map(([v, l]) => h('option', { value: v, text: l, selected: v === value })),
    ) as HTMLSelectElement;
    selects.push(s);
    return s;
  };
  const g = settings.graphics;
  const group = (key: GraphicsGroup, label: string, hint: string) =>
    row(
      t(label),
      sel(g[key] ?? '', levels, (v) => {
        if (v) g[key] = v as QualityPreset;
        else delete g[key];
        changed();
      }),
      t(hint),
    );
  return [
    row(
      t('Anti-aliasing'),
      sel(
        g.antialias ?? '',
        [
          ['', t('Preset')],
          ['native', t('MSAA (fast)')],
          ['msaa', t('MSAA 4×')],
          ['smaa', t('SMAA')],
          ['taa', t('TAA (smoothest)')],
        ],
        (v) => {
          if (v) g.antialias = v as AntiAlias;
          else delete g.antialias;
          changed();
        },
      ),
      t('TAA smooths jagged distant edges, fences and shimmering textures best'),
    ),
    row(
      t('Supersampling'),
      sel(
        g.superSample ? String(g.superSample) : '',
        [
          ['', t('Preset')],
          ['1', t('Off')],
          ['1.25', '1.25×'],
          ['1.5', '1.5×'],
          ['2', t('2× (4 × the pixels)')],
        ],
        (v) => {
          if (v) g.superSample = Number(v);
          else delete g.superSample;
          changed();
        },
      ),
      t('Renders above your screen resolution and scales down: the sharpest, cleanest picture, at a big cost'),
    ),
    group('shadows', 'Shadows', 'Shadow sharpness and how far they reach'),
    group('ao', 'Ambient occlusion', 'Soft contact shadows in corners and under cars'),
    group('textures', 'Textures and reflections', 'Texture filtering at grazing angles, reflections'),
    group('viewDistance', 'View distance', 'How far buildings, barriers and detailed cars are drawn'),
    group('trees', 'Trees', 'Forest density and distance'),
    group('grass', 'Grass', 'The 3D lawn and grass blades on the verges'),
    group('clouds', 'Clouds', 'Flat, lit, or with deep self-shadowing'),
    group('crowd', 'Spectators', 'People on the grandstands'),
    group('effects', 'Effects', 'Bloom, colour grade and rain'),
  ];
}
