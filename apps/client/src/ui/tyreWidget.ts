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
function partColour(d: number, frame = false): string {
  return d < 0.05 ? (frame ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.8)') : d < 0.3 ? '#ffd60a' : d < 0.6 ? '#ff9f0a' : '#ff453a';
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
  private brakes: SVGPathElement[] = [];
  // Le Mans Ultimate's schematic: square-cornered tyres on a straight frame (axles and two rails), the front wing an
  // arc over the front tyres, the rear wing a bar behind; each tyre's brake a small arrow pointing in
  private front = el('path', { d: 'M24 12 Q50 1 76 12', class: 'tw-wing' });
  private rear = el('path', { d: 'M34 96 L66 96', class: 'tw-wing' });
  private chassis = el('path', { d: 'M38 30 L62 30 M38 76 L62 76 M44 30 L44 76 M56 30 L56 76', class: 'tw-chassis' });
  private water = h('b', { text: '--' });
  private oil = h('b', { text: '--' });
  private key = '';

  constructor() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 104');
    svg.setAttribute('class', 'tw-svg');
    svg.setAttribute('aria-label', t('Tyres'));
    svg.append(this.chassis, this.front, this.rear);
    // FL, FR, RL, RR: tyres 16 × 28, just outside the frame
    const pos: [number, number, 'end' | 'start', number][] = [
      [22, 16, 'end', 18],
      [62, 16, 'start', 82],
      [22, 62, 'end', 18],
      [62, 62, 'start', 82],
    ];
    for (const [x, y, anchor, tx] of pos) {
      const left = x < 50;
      const r = el('rect', { x, y, width: 16, height: 28, rx: 2, class: 'tw-tyre' });
      // the tread left: a darker band growing down from the top as the tyre wears
      const tr = el('rect', { x: x + 1, y: y + 1, width: 14, height: 0, rx: 1.5, class: 'tw-tread' });
      // the brake: an arrow inside the tyre pointing towards the car (▷ on the left, ◁ on the right)
      const cx = x + 8;
      const cy = y + 14;
      const br = el('path', {
        d: left ? `M${cx - 3} ${cy - 4} L${cx + 3} ${cy} L${cx - 3} ${cy + 4}` : `M${cx + 3} ${cy - 4} L${cx - 3} ${cy} L${cx + 3} ${cy + 4}`,
        class: 'tw-brake',
      });
      const tt = el('text', { x: tx, y: y + 17, 'text-anchor': anchor, class: 'tw-temp' });
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
      // the worn part, darker, from the top
      this.treads[i].setAttribute('height', (26 * Math.min(1, Math.max(0, wear[i]))).toFixed(1));
      this.temps[i].textContent = `${Math.round(temps[i])}°`;
      const b = brakeTemps[i];
      this.brakes[i].setAttribute('stroke', b < 150 ? '#cfe3ff' : b < 650 ? '#ffffff' : b < 850 ? '#ffd60a' : '#ff453a');
    }
    this.front.setAttribute('stroke', partColour(zones[0] ?? 0));
    this.rear.setAttribute('stroke', partColour(zones[1] ?? 0));
    this.chassis.setAttribute('stroke', partColour(Math.max(zones[2] ?? 0, zones[3] ?? 0, zones[4] ?? 0), true));
    this.water.textContent = waterC > 0 ? `${waterC.toFixed(1)}°C` : '--';
    this.oil.textContent = oilC > 0 ? `${oilC.toFixed(1)}°C` : '--';
    this.water.classList.toggle('hot', waterC > 102);
    this.oil.classList.toggle('hot', oilC > 118);
  }
}
