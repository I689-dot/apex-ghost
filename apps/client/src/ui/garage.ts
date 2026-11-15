import type { CarEntry } from '@apex/shared';
import { t } from '../i18n';
import { steeringLockDeg } from '../physics/steeringLock';
import { h } from './dom';
import { ICONS } from './icons';
import { heroUrl } from './images';

const hp = (kw: number) => Math.round(kw * 1.341);

export interface GarageOptions {
  /** The car shown first (and marked as yours). */
  current: string | null;
  /** Header kicker and title. */
  kicker: string;
  title: string;
  /** The main button's label ("Race with this car", "Select car"). */
  cta: string;
  onPick: (id: string) => void;
  /** A back / cancel button (modal use). */
  onClose?: () => void;
  /** Other drivers on each car (a lobby: their names on the card; nothing is locked). */
  others?: Record<string, string[]>;
  /** Picking is not possible now (a lobby during a race). */
  disabled?: boolean;
  /** Called with the car under the pointer / selected in the list (a 3D preview elsewhere). */
  onBrowse?: (car: CarEntry) => void;
  /** Kept across re-renders (a lobby redraws on every change): the car shown, the brand filter, the search. */
  state?: { shown: string | null; brand: string; query: string };
}

/**
 * The garage: the car picker of the current sims (Assetto Corsa EVO's car select, Le Mans Ultimate's): the field in
 * a list with the brands to filter by, the car big in the middle, and its numbers as bars against the rest of the
 * GT3 field (power, weight, power to weight, top speed), with the real car's engine, gearbox and team.
 */
export function garagePicker(cars: CarEntry[], o: GarageOptions): HTMLElement {
  const field = cars.filter((c) => c.role !== 'safety');
  const st = o.state ?? { shown: null, brand: '', query: '' };
  let shown = field.find((c) => c.id === (st.shown ?? o.current)) ?? field.find((c) => c.id === o.current) ?? field[0];
  let brand = st.brand;
  let query = st.query;
  const brands = [...new Set(field.map((c) => c.manufacturer))].sort((a, b) => a.localeCompare(b));
  // the field's range of each number, for the bars
  const range = (f: (c: CarEntry) => number) => {
    const v = field.map(f);
    return [Math.min(...v), Math.max(...v)] as const;
  };
  const R = {
    power: range((c) => hp(c.specs.powerKw)),
    mass: range((c) => c.specs.massKg),
    ptw: range((c) => c.specs.massKg / hp(c.specs.powerKw)),
    top: range((c) => c.specs.topSpeedKmh),
  };
  /** A bar 12…100 % across the field's range (better = longer; for weight, lighter is better). */
  const bar = (label: string, value: string, v: number, [lo, hi]: readonly [number, number], lowerBetter = false) => {
    let f = hi > lo ? (v - lo) / (hi - lo) : 1;
    if (lowerBetter) f = 1 - f;
    return h(
      'div.gr-stat',
      {},
      h('div.gr-stat-head', {}, h('span', { text: label }), h('b', { text: value })),
      h('div.gr-bar', {}, h('i', { style: `width:${(12 + f * 88).toFixed(1)}%` })),
    );
  };

  const list = h('div.gr-list', { role: 'listbox', 'aria-label': t('Cars') });
  const stage = h('div.gr-stage');
  const specs = h('div.gr-specs');
  const chips = h('div.gr-brands');
  const search = h('input.gr-search', { type: 'search', placeholder: t('Search cars'), 'aria-label': t('Search cars'), spellcheck: 'false' });
  const ctaBtn = h('button.primary.gr-cta', { type: 'button', disabled: !!o.disabled });
  const count = h('span.gr-count');

  const renderStage = () => {
    const c = shown;
    const mine = c.id === o.current;
    const others = o.others?.[c.id] ?? [];
    stage.replaceChildren(
      h(
        'div.gr-photo',
        {},
        h('img.gr-hero', {
          src: heroUrl(c),
          alt: c.name,
          draggable: 'false',
          onerror: (e: Event) => ((e.target as HTMLImageElement).src = c.thumbnail),
        }),
      ),
      h(
        'div.gr-title',
        {},
        h('span.gr-make', { text: `${c.manufacturer}${c.year ? ` · ${c.year}` : ''}` }),
        h('h2', { text: c.name }),
        h('span.gr-team', { text: c.info ? t(c.info.team) : c.category }),
        mine ? h('span.gr-yours', { html: `${ICONS.check} ${t('Your car')}` }) : null,
        others.length ? h('span.gr-shared', { text: t('Also driven by {names}', { names: others.join(', ') }) }) : null,
      ),
    );
    const ptw = c.specs.massKg / hp(c.specs.powerKw);
    specs.replaceChildren(
      h('h4', { text: t('Performance') }),
      bar(t('Power'), t('{n} hp', { n: hp(c.specs.powerKw) }), hp(c.specs.powerKw), R.power),
      bar(t('Weight (with driver)'), `${c.specs.massKg} kg`, c.specs.massKg, R.mass, true),
      bar(t('Power-to-weight'), `${ptw.toFixed(2)} kg/hp`, ptw, R.ptw, true),
      bar(t('Top speed'), `${c.specs.topSpeedKmh} km/h`, c.specs.topSpeedKmh, R.top),
      h('h4', { text: t('Technical') }),
      h(
        'dl.gr-tech',
        {},
        ...(c.info
          ? [h('dt', { text: t('Engine') }), h('dd', { text: t(c.info.engine) }), h('dt', { text: t('Gearbox') }), h('dd', { text: t(c.info.gearbox) })]
          : []),
        h('dt', { text: t('Drivetrain') }),
        h('dd', { text: c.specs.drivetrain }),
        h('dt', { text: t('Gears') }),
        h('dd', { text: String(c.specs.gears.length) }),
        h('dt', { text: t('Steering lock') }),
        h('dd', { text: `${steeringLockDeg(c.id)}°` }),
        h('dt', { text: t('Class') }),
        h('dd', { text: c.category }),
      ),
    );
    ctaBtn.innerHTML = mine && o.cta === t('Select car') ? `${ICONS.check} ${t('Selected')}` : `${o.cta} ${ICONS.right}`;
  };

  const renderList = () => {
    const q = query.trim().toLowerCase();
    const shownCars = field.filter(
      (c) => (!brand || c.manufacturer === brand) && (!q || `${c.name} ${c.manufacturer} ${c.info?.team ?? ''}`.toLowerCase().includes(q)),
    );
    count.textContent = t('{n} cars', { n: shownCars.length });
    list.replaceChildren(
      ...shownCars.map((c) =>
        h(
          `button.gr-row${c.id === shown.id ? '.on' : ''}${c.id === o.current ? '.mine' : ''}`,
          {
            type: 'button',
            role: 'option',
            'aria-selected': String(c.id === shown.id),
            onclick: () => {
              shown = c;
              st.shown = c.id;
              o.onBrowse?.(c);
              renderList();
              renderStage();
            },
            ondblclick: () => !o.disabled && o.onPick(c.id),
          },
          h('img', { src: c.thumbnail, alt: '', loading: 'lazy', draggable: 'false' }),
          h('span.gr-row-text', {}, h('b', { text: c.name }), h('small', { text: c.info ? t(c.info.team) : c.manufacturer })),
          c.id === o.current ? h('span.gr-row-mine', { html: ICONS.check, title: t('Your car') }) : null,
          o.others?.[c.id]?.length ? h('span.gr-row-n', { text: String(o.others[c.id].length), title: (o.others[c.id] ?? []).join(', ') }) : null,
        ),
      ),
      ...(shownCars.length ? [] : [h('p.muted.gr-empty', { text: t('No car matches.') })]),
    );
  };

  const renderChips = () =>
    chips.replaceChildren(
      ...['', ...brands].map((b) =>
        h(`button.gr-chip${b === brand ? '.on' : ''}`, {
          type: 'button',
          text: b || t('All'),
          onclick: () => {
            brand = b;
            st.brand = b;
            renderChips();
            renderList();
          },
        }),
      ),
    );

  search.value = query;
  search.addEventListener('input', () => {
    query = search.value;
    st.query = query;
    renderList();
  });
  ctaBtn.addEventListener('click', () => o.onPick(shown.id));
  // the keyboard: up / down through the list, Enter picks
  const el = h(
    'section.garage',
    {
      tabindex: -1,
      onkeydown: (e: Event) => {
        const k = (e as KeyboardEvent).key;
        if (k !== 'ArrowDown' && k !== 'ArrowUp') return;
        const rows = [...list.querySelectorAll<HTMLButtonElement>('.gr-row')];
        const at = rows.findIndex((r) => r.classList.contains('on'));
        const next = rows[Math.max(0, Math.min(rows.length - 1, at + (k === 'ArrowDown' ? 1 : -1)))];
        if (next) {
          e.preventDefault();
          next.click();
          next.focus();
          next.scrollIntoView({ block: 'nearest' });
        }
      },
    },
    h(
      'header.gr-head',
      {},
      h('div', {}, h('span.gr-kicker', { text: o.kicker }), h('h1', { text: o.title })),
      o.onClose ? h('button.ghost.gr-back', { type: 'button', html: `${ICONS.left} ${t('Back')}`, onclick: o.onClose }) : null,
    ),
    h('aside.gr-side', {}, h('div.gr-find', {}, h('span.gr-find-icon', { html: ICONS.search }), search), chips, count, list),
    stage,
    h('div.gr-info', {}, specs, ctaBtn),
  );
  renderChips();
  renderList();
  renderStage();
  // the chosen car in view
  requestAnimationFrame(() => list.querySelector('.gr-row.on')?.scrollIntoView({ block: 'nearest' }));
  return el;
}

/** The garage as a full-screen step before a session ("choose your car, then race"). Resolves with the car, or null. */
export function garageModal(cars: CarEntry[], current: string | null, cta: string): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (id: string | null) => {
      document.removeEventListener('keydown', esc, true);
      modal.remove();
      resolve(id);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(null);
      }
    };
    const picker = garagePicker(cars, {
      current,
      kicker: t('Step 1 of 2'),
      title: t('Choose your car'),
      cta,
      onPick: (id) => done(id),
      onClose: () => done(null),
    });
    const modal = h('div.garage-modal', {}, picker);
    document.addEventListener('keydown', esc, true);
    document.body.append(modal);
    picker.focus();
  });
}
