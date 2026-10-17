/**
 * Live delta to your personal best lap (the "+0.234 / −0.120" bar of F1 and GT games).
 * Records the lap time at every few metres of the lap; the delta is the current lap time minus the best
 * lap's time at the same distance, interpolated.
 */
export class LapDelta {
  private readonly bin: number;
  private cur: Float32Array;
  private best: Float32Array | null = null;

  constructor(trackLength: number, binM = 5) {
    this.bin = binM;
    this.cur = new Float32Array(Math.ceil(trackLength / binM) + 2).fill(NaN);
  }

  /** A new lap starts. */
  start(): void {
    this.cur.fill(NaN);
  }

  record(lapDistM: number, lapMs: number): void {
    const b = Math.floor(lapDistM / this.bin);
    if (b < 0 || b >= this.cur.length) return;
    if (Number.isNaN(this.cur[b])) this.cur[b] = lapMs;
  }

  /** The lap that just ended is the new reference. Call before `start()`. */
  commitBest(): void {
    this.best = this.cur.slice();
  }

  get hasReference(): boolean {
    return this.best !== null;
  }

  /** Current lap time minus the best lap's time at this distance (ms), or null without a reference. */
  delta(lapDistM: number, lapMs: number): number | null {
    const best = this.best;
    if (!best) return null;
    const x = lapDistM / this.bin;
    const i = Math.floor(x);
    if (i < 0 || i + 1 >= best.length) return null;
    const a = best[i];
    const b = best[i + 1];
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return lapMs - (a + (b - a) * (x - i));
  }
}
