/**
 * NTP-style clock sync. For each ping we know the client send time (c0), the server
 * time when it answered (s) and the client receive time (c1):
 *   rtt    = c1 - c0
 *   offset = s - (c0 + c1) / 2          (serverTime ≈ clientTime + offset)
 * Samples with the lowest RTT are the least affected by queueing, so we keep the best
 * half and take the median offset of those.
 */
export interface ClockSample {
  offset: number;
  rtt: number;
}

export function makeSample(c0: number, s: number, c1: number): ClockSample {
  return { offset: s - (c0 + c1) / 2, rtt: Math.max(0, c1 - c0) };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const a = values.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function estimateOffset(samples: readonly ClockSample[]): { offset: number; rtt: number } {
  if (samples.length === 0) return { offset: 0, rtt: 0 };
  const sorted = samples.slice().sort((a, b) => a.rtt - b.rtt);
  const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  return { offset: median(best.map((s) => s.offset)), rtt: median(best.map((s) => s.rtt)) };
}
