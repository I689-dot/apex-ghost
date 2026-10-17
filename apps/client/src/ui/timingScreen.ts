import type { Standing } from '@apex/shared';
import { fmtTime, h } from './dom';

export interface TimingRowInfo {
  nick: string;
  car: string;
  colour: string;
  bot: boolean;
}

/**
 * Full timing screen (hold Tab), like a qualifying monitor: position, driver, car, best lap and gap, last lap,
 * best sectors (purple = fastest of the session), laps and the current status (out lap, pits, invalid, finished).
 */
export class TimingScreen {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private key = '';

  constructor() {
    this.body = h('tbody');
    this.el = h(
      'div.timing',
      {},
      h(
        'div.timing-card',
        {},
        h('div.timing-head', {}, h('h2', { text: 'Timing' }), h('span.muted', { text: 'Best valid lap counts · release Tab to close' })),
        h(
          'table',
          {},
          h(
            'thead',
            {},
            h('tr', {}, ...['Pos', 'Driver', 'Car', 'Best lap', 'Gap', 'Last lap', 'S1', 'S2', 'S3', 'Laps', 'Status'].map((t) => h('th', { text: t }))),
          ),
          this.body,
        ),
      ),
    );
  }

  set visible(v: boolean) {
    this.el.classList.toggle('show', v);
  }

  get visible(): boolean {
    return this.el.classList.contains('show');
  }

  update(list: Standing[], me: string, info: (id: string) => TimingRowInfo): void {
    const key = list.map((r) => `${r.id}${r.position}${r.bestLapMs}${r.lastLapMs}${r.laps}${r.inPit}${r.outLap}${r.lapInvalid}${r.finishedMs}`).join('|');
    if (key === this.key) return;
    this.key = key;
    // fastest sector of the session (purple)
    const best = [Infinity, Infinity, Infinity];
    for (const r of list) r.bestSectors.forEach((s, i) => (best[i] = Math.min(best[i], s)));
    this.body.replaceChildren(
      ...list.map((r) => {
        const i = info(r.id);
        const status = r.dnf
          ? 'DNF'
          : r.finishedMs !== null
            ? 'FINISHED'
            : r.inPit
              ? 'IN PITS'
              : r.outLap
                ? 'OUT LAP'
                : r.lapInvalid
                  ? 'INVALID LAP'
                  : 'ON TIMED LAP';
        return h(
          `tr${r.id === me ? '.me' : ''}`,
          {},
          h('td.pos', { text: r.bestLapMs === null ? '–' : String(r.position) }),
          h('td.driver', {}, h('i.swatch', { style: `background:${i.colour}` }), i.nick, i.bot ? h('small', { text: ' AI' }) : null),
          h('td.muted', { text: i.car }),
          h(`td.mono${r.position === 1 && r.bestLapMs !== null ? '.purple' : ''}`, { text: r.bestLapMs === null ? 'no time' : fmtTime(r.bestLapMs) }),
          h('td.mono.muted', { text: r.bestLapMs === null || r.position === 1 || r.gapMs === null ? '' : `+${(r.gapMs / 1000).toFixed(3)}` }),
          h('td.mono', { text: r.lastLapMs === null ? '' : fmtTime(r.lastLapMs) }),
          ...[0, 1, 2].map((k) => {
            const s = r.bestSectors[k];
            return h(`td.mono.sector${s !== undefined && s <= best[k] ? '.purple' : ''}`, { text: s === undefined ? '' : (s / 1000).toFixed(3) });
          }),
          h('td.mono', { text: String(r.laps) }),
          h(`td.status.${status.split(' ')[0].toLowerCase()}`, { text: status }),
        );
      }),
    );
  }
}
