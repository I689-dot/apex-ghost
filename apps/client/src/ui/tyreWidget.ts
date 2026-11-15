import { COMPOUNDS, type CompoundId } from '../physics/tyres';
import { t } from '../i18n';
import { h } from './dom';
import { tyreColour } from './carStatus';

const NS = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A part's damage as the dash shows it: white when whole, then yellow, orange, red. */
function partColour(d: number): string {
  return d < 0.05 ? 'rgba(255,255,255,0.75)' : d < 0.3 ? '#ffd60a' : d < 0.6 ? '#ff9f0a' : '#ff453a';
}

/**
 * The tyre panel beside the dial, as Le Mans Ultimate's: the car's four tyres from above, each in the colour of its
 * temperature against the compound's window (blue cold, green in the window, orange / red hot) with the tread left as
 * a bar inside it and its temperature beside it; the front and rear wings as arcs in the colour of their damage; and
 * under it the engine's water and oil temperatures. Only writes to the DOM when a value changes.
 */
export class TyreWidget {
  readonly el = h('div.tyre-widget');
  private tyres: SVGRectElement[] = [];
  private treads: SVGRectElement[] = [];
  private temps: SVGTextElement[] = [];
  private brakes: SVGRectElement[] = [];
  private front = el('path', { d: 'M27 16 Q50 4 73 16', class: 'tw-wing' });
  private rear = el('path', { d: 'M30 96 L70 96', class: 'tw-wing' });
  private chassis = el('path', { d: 'M42 14 L58 14 L60 30 L60 82 L56 94 L44 94 L40 82 L40 30 Z', class: 'tw-chassis' });
  private water = h('b', { text: '--' });
  private oil = h('b', { text: '--' });
  private key = '';

  constructor() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 104');
    svg.setAttribute('class', 'tw-svg');
    svg.setAttribute('aria-label', t('Tyres'));
    svg.append(this.chassis, el('path', { d: 'M36 31 L64 31 M36 78 L64 78', class: 'tw-axle' }), this.front, this.rear);
    // FL, FR, RL, RR
    const pos: [number, number, 'end' | 'start', number][] = [
      [23, 20, 'end', 19],
      [63, 20, 'start', 81],
      [23, 66, 'end', 19],
      [63, 66, 'start', 81],
    ];
    for (const [x, y, anchor, tx] of pos) {
      const r = el('rect', { x, y, width: 14, height: 24, rx: 3.5, class: 'tw-tyre' });
      const tr = el('rect', { x: x + 4.5, y: y + 4, width: 5, height: 16, rx: 1.5, class: 'tw-tread' });
      const br = el('rect', { x: x < 50 ? x + 15.5 : x - 3.5, y: y + 7, width: 2, height: 10, rx: 1, class: 'tw-brake' });
      const tt = el('text', { x: tx, y: y + 15, 'text-anchor': anchor, class: 'tw-temp' });
      svg.append(r, tr, br, tt);
      this.tyres.push(r);
      this.treads.push(tr);
      this.brakes.push(br);
      this.temps.push(tt);
    }
    const waterIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10"/><path d="M12 3h4M12 7h3M12 11h4"/><circle cx="12" cy="16" r="2.4"/><path d="M4 20c1.6-1 3.2-1 4.8 0s3.2 1 4.8 0 3.2-1 4.8 0"/></svg>';
    const oilIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11h4l2-2h7l5 3-6 5H7l-1-2H3z"/><path d="M21 15c0 1.2-.8 2-1.6 2s-1.6-.8-1.6-2 1.6-3 1.6-3 1.6 1.8 1.6 3z"/></svg>';
    this.el.append(
      svg,
      h('div.tw-row', { title: t('Water temperature') }, h('span.tw-icon', { html: waterIcon }), this.water),
      h('div.tw-row', { title: t('Oil temperature') }, h('span.tw-icon', { html: oilIcon }), this.oil),
    );
  }

  /** Every frame: tyre °C, tread used (0…1), brake °C (FL FR RL RR), damage zones (front, rear, left, right, engine), water and oil °C. */
  update(temps: number[], wear: number[], brakeTemps: number[], compound: CompoundId, zones: ArrayLike<number>, waterC: number, oilC: number): void {
    const opt = COMPOUNDS[compound].optimumC;
    const key = `${temps.map((x) => Math.round(x)).join()}|${wear.map((w) => Math.round(w * 50)).join()}|${brakeTemps.map((b) => Math.round(b / 50)).join()}|${compound}|${Array.from(zones, (z) => Math.round(z * 10)).join()}|${waterC.toFixed(1)}|${oilC.toFixed(1)}`;
    if (key === this.key) return;
    this.key = key;
    for (let i = 0; i < 4; i++) {
      this.tyres[i].setAttribute('fill', tyreColour(temps[i], opt));
      // the tread left, as a bar that shrinks from the top as the tyre wears
      const left = Math.max(0, 1 - wear[i]);
      this.treads[i].setAttribute('height', (16 * left).toFixed(1));
      this.treads[i].setAttribute('y', (Number(this.tyres[i].getAttribute('y')) + 4 + 16 * (1 - left)).toFixed(1));
      this.temps[i].textContent = `${Math.round(temps[i])}°`;
      const b = brakeTemps[i];
      this.brakes[i].setAttribute('fill', b < 150 ? '#3a86ff' : b < 650 ? '#30d158' : b < 850 ? '#ff9f0a' : '#ff453a');
    }
    this.front.setAttribute('stroke', partColour(zones[0] ?? 0));
    this.rear.setAttribute('stroke', partColour(zones[1] ?? 0));
    this.chassis.setAttribute('stroke', partColour(Math.max(zones[2] ?? 0, zones[3] ?? 0, zones[4] ?? 0)));
    this.water.textContent = waterC > 0 ? `${waterC.toFixed(1)}°C` : '--';
    this.oil.textContent = oilC > 0 ? `${oilC.toFixed(1)}°C` : '--';
    this.water.classList.toggle('hot', waterC > 102);
    this.oil.classList.toggle('hot', oilC > 118);
  }
}
