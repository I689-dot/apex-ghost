/**
 * A lap's telemetry for the website's telemetry page (apps/web: /telemetry): every few metres of the lap (5 m, 10 m
 * on the 25 km layout) the car's position, the lap time, speed, throttle, brake, steering and gear, packed in 11
 * bytes a point (a Spa lap ≈ 15 kB). Uploaded with a personal best set online; the server keeps it only for a lap it
 * recorded itself.
 *
 * Point layout (little-endian): int16 x, int16 z (¼ m), uint16 lap time (1/100 s), uint8 speed (1.25 km/h),
 * uint8 throttle, uint8 brake (0…255), int8 steering (−127 right … 127 left), uint8 gear (0 reverse, 1 neutral, 2 first…).
 */
export const TRACE_POINT_BYTES = 11;

export class LapTrace {
  readonly bin: number;
  private readonly n: number;
  private readonly buf: Uint8Array;
  private readonly dv: DataView;
  private readonly filled: Uint8Array;

  constructor(trackLength: number) {
    this.bin = trackLength > 10_000 ? 10 : 5;
    this.n = Math.ceil(trackLength / this.bin);
    this.buf = new Uint8Array(this.n * TRACE_POINT_BYTES);
    this.dv = new DataView(this.buf.buffer);
    this.filled = new Uint8Array(this.n);
  }

  /** A new lap starts. */
  start(): void {
    this.filled.fill(0);
  }

  /** The car now (the first sample in each stretch of `bin` metres is kept). */
  record(lapDistM: number, lapMs: number, x: number, z: number, speedMs: number, throttle: number, brake: number, steer: number, gear: number): void {
    const b = Math.floor(lapDistM / this.bin);
    if (b < 0 || b >= this.n || this.filled[b]) return;
    const o = b * TRACE_POINT_BYTES;
    const dv = this.dv;
    const i16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
    dv.setInt16(o, i16(x * 4), true);
    dv.setInt16(o + 2, i16(z * 4), true);
    dv.setUint16(o + 4, Math.max(0, Math.min(65535, Math.round(lapMs / 10))), true);
    dv.setUint8(o + 6, Math.max(0, Math.min(255, Math.round((speedMs * 3.6) / 1.25))));
    dv.setUint8(o + 7, Math.max(0, Math.min(255, Math.round(throttle * 255))));
    dv.setUint8(o + 8, Math.max(0, Math.min(255, Math.round(brake * 255))));
    dv.setInt8(o + 9, Math.max(-127, Math.min(127, Math.round(steer * 127))));
    dv.setUint8(o + 10, Math.max(0, Math.min(255, gear + 1)));
    this.filled[b] = 1;
  }

  /** The lap just driven, base64 (gaps filled from the point before), or null when too little of it was seen. */
  encode(): string | null {
    let seen = 0;
    for (let i = 0; i < this.n; i++) seen += this.filled[i];
    if (seen < this.n * 0.9) return null;
    const out = this.buf.slice();
    let last = -1;
    for (let i = 0; i < this.n; i++) {
      if (this.filled[i]) last = i;
      else if (last >= 0) out.copyWithin(i * TRACE_POINT_BYTES, last * TRACE_POINT_BYTES, (last + 1) * TRACE_POINT_BYTES);
    }
    // a gap at the very start: the first point seen
    const first = this.filled.indexOf(1);
    for (let i = 0; i < first; i++) out.copyWithin(i * TRACE_POINT_BYTES, first * TRACE_POINT_BYTES, (first + 1) * TRACE_POINT_BYTES);
    let s = '';
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(s);
  }
}
