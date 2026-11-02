import type { CarEntry } from '@apex/shared';
import type { DamageState } from '../physics/damage';
import type { TopLines } from '../game/topView';
import { CarLineArt, damageColour } from './carLines';
import { SERVICE } from '../game/pitService';
import { h } from './dom';
import { t } from '../i18n';

/** Green → yellow → orange → red, as F1's damage page and the sims' car diagrams colour a part (ui/carLines.ts). */
const colourOf = damageColour;
/**
 * The damage report, as iRacing's black box draws it: the car's own model as a line drawing from above
 * (topView.ts renderTopLines), every part of it in the colour of its damage (the nose, the tail, the sides, the
 * engine bay, each corner at its wheel), the four tyres below (suspension, punctures), what is lost in figures and
 * how long the repairs would take in the pits. Shown for a few seconds after the damage changes, or while the
 * damage key is held.
 */
export class DamagePanel {
  readonly el = h('div.dmg-panel');
  private art = new CarLineArt();
  private tyres: HTMLElement[] = [];
  private list = h('div.dmg-list');
  private repairEl = h('div.dmg-repair');
  private shownUntil = 0;
  private version = -1;
  private last: DamageState | null = null;

  constructor() {
    this.art.canvas.className = 'dmg-car';
    this.tyres = ['LF', 'RF', 'LR', 'RR'].map((k) => h('div.dmg-tyre', { text: k }));
    this.el.append(
      h('div.dmg-head', { text: t('VEHICLE DAMAGE') }),
      h('div.dmg-body-row', {}, this.art.canvas, this.list),
      h('div.dmg-tyres', {}, ...this.tyres),
      this.repairEl,
    );
    this.el.hidden = true;
  }

  /** The car this panel draws: its line drawing and where its wheels are (once at load). */
  setCar(entry: CarEntry, lines: TopLines | null): void {
    this.art.setCar(entry, lines);
    if (this.last) this.render(this.last);
  }

  /** Every frame: refreshes when the damage changed (and shows itself for 6 s), or while `hold` is down. */
  update(d: DamageState, hold: boolean): void {
    const now = performance.now();
    if (d.version !== this.version) {
      const first = this.version === -1;
      this.version = d.version;
      this.render(d);
      // nothing to report at the start, or after a full repair
      if (!first && this.worst(d) > 0.02) this.shownUntil = now + 6000;
    }
    this.el.hidden = !(hold || now < this.shownUntil);
  }

  /** The line drawing, each part in its damage colour (a glow from the CSS). */
  private drawCar(d: DamageState): void {
    this.art.draw(
      [...d.zones.slice(0, 5)].map(colourOf),
      [0, 1, 2, 3].map((i) => (d.punctured[i] ? '#ff453a' : colourOf(d.corners[i]))),
    );
  }

  private worst(d: DamageState): number {
    return Math.max(...d.zones, ...(d.punctured.some(Boolean) ? [1] : [0]));
  }

  private render(d: DamageState): void {
    this.last = d;
    const z = d.zones;
    this.drawCar(d);
    d.corners.forEach((c, i) => {
      const el = this.tyres[i];
      el.style.setProperty('--sev', d.punctured[i] ? '#ff453a' : colourOf(c));
      el.classList.toggle('flat', d.punctured[i]);
    });
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    const rows: [string, string, number][] = [];
    const front = 1 - d.downforceFront();
    const rear = 1 - d.downforceRear();
    if (front > 0.005) rows.push([t('Front downforce'), `−${pct(front)}`, z[0]]);
    if (rear > 0.005) rows.push([t('Rear downforce'), `−${pct(rear)}`, z[1]]);
    const pull = d.alignment;
    if (Math.abs(pull) > 0.002) rows.push([t('Steering pulls'), pull > 0 ? t('left') : t('right'), z[5]]);
    if (z[4] > 0.01) rows.push([t('Engine power'), `−${pct(1 - d.powerScale)}`, z[4]]);
    const names = [t('Front left'), t('Front right'), t('Rear left'), t('Rear right')];
    d.corners.forEach((c, i) => {
      if (d.punctured[i]) rows.push([names[i], t('PUNCTURE'), 1]);
      else if (c > 0.02) rows.push([names[i], `${t('suspension')} ${pct(c)}`, c]);
    });
    this.list.replaceChildren(
      ...(rows.length ? rows : [[t('No damage'), '', 0] as [string, string, number]]).map(([label, value, sev]) =>
        h('div.dmg-row', { style: `--sev:${colourOf(sev)}` }, h('span', { text: label }), h('b', { text: value })),
      ),
    );
    // what a stop would take to put it right (the pit menu's times)
    const body = Math.max(z[0], z[1], z[2], z[3]) > 0.02 ? SERVICE.body(z) : 0;
    const susp = z[5] > 0.02 ? SERVICE.suspension(z) : 0;
    const eng = z[4] > 0.02 ? SERVICE.engine(z) : 0;
    const total = body + susp + eng;
    this.repairEl.textContent = total > 0.5 ? t('Repairs in the pits: {s} s', { s: total.toFixed(0) }) : '';
  }
}
