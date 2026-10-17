import { serviceTime, type ServicePlan, type Zones } from '../game/pitService';
import { COMPOUNDS, type CompoundId } from '../physics/tyres';
import { h } from './dom';
import { uiAsset } from './images';
import { t } from '../i18n';

export interface PitMenuInfo {
  current: CompoundId;
  /** FL, FR, RL, RR wear 0..1 and temperatures °C */
  wear: number[];
  temps: number[];
  zones: Zones;
  wetness: number;
  plan: ServicePlan;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * The pit box: choose tyres and repairs, see how long the stop takes, start the service.
 * The session clock keeps running the whole time (as in qualifying).
 * Keys: Enter starts the service, Esc leaves without one, 1–5 pick keep / soft / medium / hard / wet.
 */
export class PitMenu {
  readonly el: HTMLElement;
  private plan: ServicePlan;
  private totalEl: HTMLElement;
  private breakdownEl: HTMLElement;
  private tyreBtns = new Map<CompoundId | 'keep', HTMLButtonElement>();
  private repairBoxes: HTMLInputElement[] = [];
  private clockEl: HTMLElement;
  private progress: HTMLElement | null = null;
  private servicing = false;

  constructor(
    private readonly info: PitMenuInfo,
    private readonly onStart: (plan: ServicePlan, seconds: number) => void,
    private readonly onLeave: () => void,
  ) {
    this.plan = { ...info.plan };
    this.clockEl = h('div.pit-clock');
    this.totalEl = h('div.pit-total');
    this.breakdownEl = h('div.pit-breakdown');
    const c = COMPOUNDS[info.current];
    const avgWear = info.wear.reduce((a, b) => a + b, 0) / 4;
    const tyreRow = h(
      'div.pit-tyres',
      {},
      ...(['keep', 'soft', 'medium', 'hard', 'wet'] as const).map((id, i) => {
        const comp = id === 'keep' ? null : COMPOUNDS[id];
        const b = h(
          'button.pit-tyre',
          {
            onclick: () => this.setTyres(id === 'keep' ? null : id),
            title: comp
              ? t('{name}: grip {dry} % dry / {wet} % wet, wear ×{wear}', {
                  name: t(comp.name),
                  dry: Math.round(comp.grip * 100),
                  wet: Math.round(comp.wetGrip * 100),
                  wear: comp.wear,
                })
              : t('Keep the current set'),
          },
          comp ? h('img', { src: uiAsset(`tyre_${id}.webp`), alt: comp.letter, draggable: 'false' }) : h('i', { text: '↺' }),
          h('span', { text: comp ? comp.name : t('Keep') }),
          h('small', { text: `${i + 1}` }),
        );
        this.tyreBtns.set(id, b);
        return b;
      }),
    );
    const wearList = h(
      'div.pit-wear',
      {},
      ...['FL', 'FR', 'RL', 'RR'].map((k, i) =>
        h(
          'div',
          {},
          h('b', { text: k }),
          h('span', { text: t('{pct} % tread', { pct: Math.round(100 - info.wear[i] * 100) }) }),
          h('em', { text: `${Math.round(info.temps[i])} °C` }),
        ),
      ),
    );
    const z = info.zones;
    const repair = (label: string, dmg: number, key: 'body' | 'suspension' | 'engine') => {
      const box = h('input', {
        type: 'checkbox',
        checked: this.plan[key],
        disabled: dmg < 0.005,
        onchange: () => {
          this.plan[key] = box.checked;
          this.refresh();
        },
      });
      this.repairBoxes.push(box);
      return h(
        'label.pit-repair',
        {},
        box,
        h('span', { text: label }),
        h(`em.${dmg > 0.6 ? 'bad' : dmg > 0.3 ? 'warn' : dmg > 0.005 ? 'ok' : 'none'}`, {
          text: dmg > 0.005 ? t('{pct} damaged', { pct: pct(dmg) }) : t('no damage'),
        }),
      );
    };
    const wetHint =
      info.wetness > 0.35 && info.current !== 'wet'
        ? t('Wet track: wet tyres recommended')
        : info.wetness < 0.15 && info.current === 'wet'
          ? t('Dry track: wets will overheat and wear fast')
          : t(`Track ${info.wetness > 0.3 ? 'wet' : info.wetness > 0.05 ? 'damp' : 'dry'}`);
    this.el = h(
      'div.pit-menu',
      {},
      h(
        'div.pit-card',
        {},
        h('div.pit-head', {}, h('h2', { text: t('PIT BOX') }), this.clockEl),
        h('p.muted', { text: t('The session clock keeps running. Your next lap after the pit exit is an out lap.') }),
        h('h3', { text: t('Tyres · fitted: {name}, {pct} tread', { name: t(c.name), pct: pct(1 - avgWear) }) }),
        wearList,
        tyreRow,
        h('div.pit-hint', { text: wetHint }),
        h('h3', { text: t('Repairs') }),
        repair(t('Bodywork & aero'), Math.max(z[0], z[1], z[2], z[3]), 'body'),
        repair(t('Suspension'), z[5], 'suspension'),
        repair(t('Engine'), z[4], 'engine'),
        this.breakdownEl,
        this.totalEl,
        h(
          'div.pit-actions',
          {},
          h('button.primary', { text: t('Start service (Enter)'), onclick: () => this.start() }),
          h('button', { text: t('Leave the box (Esc)'), onclick: () => this.leave() }),
        ),
      ),
    );
    window.addEventListener('keydown', this.onKey, true);
    this.refresh();
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.servicing) return;
    const keys: Record<string, CompoundId | 'keep'> = { Digit1: 'keep', Digit2: 'soft', Digit3: 'medium', Digit4: 'hard', Digit5: 'wet' };
    if (e.code === 'Enter') this.start();
    else if (e.code === 'Escape') this.leave();
    else if (keys[e.code]) this.setTyres(keys[e.code] === 'keep' ? null : (keys[e.code] as CompoundId));
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  private setTyres(id: CompoundId | null): void {
    this.plan.tyres = id;
    this.refresh();
  }

  private refresh(): void {
    for (const [id, b] of this.tyreBtns) b.classList.toggle('on', (id === 'keep' ? null : id) === this.plan.tyres);
    const st = serviceTime(this.plan, this.info.zones);
    this.breakdownEl.replaceChildren(...st.parts.map((p) => h('div', {}, h('span', { text: p.label }), h('b', { text: `${p.seconds.toFixed(1)} s` }))));
    this.totalEl.textContent =
      st.total > 0 ? t('Stop: {s} s (tyres change while the mechanics repair)', { s: st.total.toFixed(1) }) : t('Nothing to do: drive on');
  }

  /** Remaining session time, shown in the box. */
  setClock(text: string): void {
    this.clockEl.textContent = text;
  }

  private start(): void {
    if (this.servicing) return;
    const st = serviceTime(this.plan, this.info.zones);
    if (st.total <= 0) {
      this.leave();
      return;
    }
    this.servicing = true;
    this.progress = h('div.pit-progress-fill');
    const card = this.el.querySelector('.pit-card') as HTMLElement;
    card.replaceChildren(
      h('div.pit-head', {}, h('h2', { text: t('SERVICE') }), this.clockEl),
      h('div.pit-breakdown', {}, ...st.parts.map((p) => h('div', {}, h('span', { text: p.label }), h('b', { text: `${p.seconds.toFixed(1)} s` })))),
      h('div.pit-progress', {}, this.progress),
      this.totalEl,
    );
    this.onStart(this.plan, st.total);
  }

  /** Service progress 0..1 and seconds left. */
  setProgress(u: number, left: number): void {
    if (this.progress) this.progress.style.transform = `scaleX(${Math.min(1, u)})`;
    this.totalEl.textContent = left > 0 ? `${left.toFixed(1)} s` : t('GO GO GO!');
  }

  private leave(): void {
    this.onLeave();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
  }
}
