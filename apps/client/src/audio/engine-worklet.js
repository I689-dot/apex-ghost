/* global AudioWorkletProcessor, sampleRate, registerProcessor -- AudioWorkletGlobalScope */
/**
 * Procedural engine sound (AudioWorklet). No recordings: every car's sound is built from its engine layout.
 *
 * The crank angle runs from 0 to 720° per 4-stroke cycle at the current rpm. Each cylinder fires at its real
 * crank angle; a firing sends an exhaust pulse (an impulse plus a short burst of noise) into the resonators
 * of its exhaust bank. Engine orders therefore emerge naturally: the firing frequency and its harmonics,
 * plus half-orders when a bank fires twice in a row (the cross-plane V8 burble). Load (throttle) makes the
 * pulses stronger and the tone brighter; off-throttle at high rpm, unburnt fuel occasionally pops (crackle).
 *
 * The DSP is a plain class so it can also be rendered offline (tools/sim/engineaudio.ts).
 */

const TAU = Math.PI * 2;

/** RBJ band-pass (constant 0 dB peak gain), transposed direct form II. */
class BandPass {
  constructor(sr, f, q) {
    const w = (TAU * Math.min(f, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
    this.z1 = 0;
    this.z2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = -this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

export class EngineDSP {
  /**
   * @param {number} sr sample rate
   * @param {object} p profile: events [{a: crank angle °, bank}], banks, formants [[f, q, gain]], thump, noise,
   *   noiseMs, bright, drive, sameBank, crackle, redline, idle, level
   */
  constructor(sr, p) {
    this.sr = sr;
    this.p = p;
    this.events = p.events.slice().sort((x, y) => x.a - y.a);
    this.res = [];
    for (let b = 0; b < p.banks; b++) {
      // banks differ by a few % (unequal pipe lengths): adds texture
      const k = 1 + (b - (p.banks - 1) / 2) * 0.06;
      this.res.push(p.formants.map(([f, q, g]) => ({ bp: new BandPass(sr, f * k, q), g })));
    }
    this.pop = new BandPass(sr, 1900, 1.2);
    this.exc = new Float32Array(p.banks);
    this.noiseEnv = new Float32Array(p.banks);
    this.popEnv = 0;
    this.phase = 0; // crank angle 0..720
    this.next = 0; // index of the next event
    this.lastBank = -1;
    this.thumpLp = 0;
    this.toneLp = 0;
    this.dc = 0;
    this.seed = 12345;
    this.noiseDecay = Math.exp(-1 / ((p.noiseMs / 1000) * sr));
    this.popDecay = Math.exp(-1 / (0.006 * sr));
  }

  rand() {
    // xorshift: fast, deterministic noise
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  }

  /**
   * Fill `out` with `n` samples. rpm, load and cut (ignition cut 0..1, gear shifts) interpolate over the block.
   */
  render(out, n, rpm0, rpm1, load0, load1, cut) {
    const p = this.p;
    const sr = this.sr;
    const ev = this.events;
    const red = p.redline;
    // tone filter coefficient once per block (Math.exp per sample was the costliest line)
    const rnBlock = Math.min(1.1, (rpm0 + rpm1) / 2 / red);
    const loadBlock = (load0 + load1) / 2;
    const fc = p.bright * (0.3 + 0.7 * loadBlock) * (0.45 + 0.55 * rnBlock);
    const toneA = 1 - Math.exp((-TAU * fc) / sr);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const rpm = rpm0 + (rpm1 - rpm0) * u;
      const load = load0 + (load1 - load0) * u;
      const rn = Math.min(1.1, rpm / red);
      // advance the crank and fire every cylinder whose angle we passed
      const prev = this.phase;
      this.phase += ((rpm / 60) * 360) / sr; // crank degrees; one 4-stroke cycle = 720°
      let wrapped = false;
      if (this.phase >= 720) {
        this.phase -= 720;
        wrapped = true;
      }
      for (let guard = 0; guard < ev.length; guard++) {
        const e = ev[this.next];
        const crossed = wrapped ? e.a >= prev || e.a < this.phase : e.a >= prev && e.a < this.phase;
        if (!crossed) break;
        this.fire(e.bank, rn, load, cut);
        this.next = (this.next + 1) % ev.length;
      }
      // exhaust: excitation through each bank's resonators
      let y = 0;
      let raw = 0;
      for (let b = 0; b < p.banks; b++) {
        const ne = this.noiseEnv[b];
        const x = ne > 1e-4 ? this.exc[b] + ne * this.rand() : this.exc[b];
        this.exc[b] = 0;
        this.noiseEnv[b] = ne * this.noiseDecay;
        raw += x;
        const rs = this.res[b];
        for (let k = 0; k < rs.length; k++) y += rs[k].bp.run(x) * rs[k].g;
      }
      // the firing "thump": low-passed pulse train
      this.thumpLp += (raw - this.thumpLp) * 0.06;
      y += this.thumpLp * p.thump;
      // overrun pops
      if (this.popEnv > 1e-4) {
        y += this.pop.run(this.popEnv * this.rand()) * 3;
        this.popEnv *= this.popDecay;
      }
      // tone: brighter with load and rpm
      this.toneLp += (y - this.toneLp) * toneA;
      let s = this.toneLp * 0.75 + y * 0.25;
      // remove DC, soft clip
      this.dc += (s - this.dc) * 0.0015;
      s -= this.dc;
      s = Math.tanh(s * p.drive) * p.level;
      out[i] = s;
    }
  }

  fire(bank, rn, load, cut) {
    const p = this.p;
    const same = bank === this.lastBank ? p.sameBank : 0;
    this.lastBank = bank;
    const strength = (0.18 + 0.82 * load) * (0.35 + 0.65 * Math.min(1, rn)) * (1 - 0.85 * cut);
    const amp = strength * (1 + same) * (1 + 0.08 * this.rand());
    this.exc[bank] += amp * 3;
    this.noiseEnv[bank] = Math.max(this.noiseEnv[bank], amp * p.noise);
    // unburnt fuel igniting in the exhaust: off-throttle, high rpm (and on ignition cuts)
    const off = load < 0.08 || cut > 0.5;
    if (off && rn > 0.42 && this.rand() * 0.5 + 0.5 < p.crackle * (0.5 + rn)) this.popEnv = 0.6 + 0.4 * Math.abs(this.rand());
  }
}

/**
 * Recorded engine: a bank of constant-rpm loops cut from a real onboard recording (on-load and off-load, every
 * few hundred rpm; tools/asset-pipeline/engine_bank.py), played by pitch-synchronous granular synthesis
 * (TD-PSOLA). Every grain is two firing periods of a loop, windowed and re-fired at the target firing rate, so
 * the pitch follows the rpm while the exhaust resonances (the engine's "voice") stay where they were
 * recorded: no chipmunk effect above the recorded range. Each grain takes the loop nearest to the rpm, with
 * error diffusion between the two nearest (a smooth statistical crossfade), and blends on/off-load by throttle.
 *
 * bank: { order, cyl, loops: [{ rpm, on: Float32Array, off: Float32Array }] } (loops ascending by rpm)
 */
export class SampleEngine {
  constructor(sr, bank, carCyl) {
    this.sr = sr;
    this.bank = bank;
    this.loops = bank.loops;
    // same firing frequency: a car with a different cylinder count uses the bank at a scaled rpm
    this.rpmScale = carCyl / bank.cyl;
    this.grains = [];
    this.untilNext = 0;
    this.diffuse = 0;
    this.srcTime = 0; // seconds of source "time" (all loops advance together)
  }

  /** Mix `n` samples into `out` with gain `gain` (rpm, load, cut interpolate over the block like EngineDSP). */
  render(out, n, rpm0, rpm1, load0, load1, cut, gain) {
    const order = this.bank.order;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if (this.untilNext <= 0) {
        const rpm = Math.max(300, (rpm0 + (rpm1 - rpm0) * u) * this.rpmScale);
        const load = Math.max(0, Math.min(1, load0 + (load1 - load0) * u) * (1 - cut));
        this.spawn(rpm, load, order);
      }
      this.untilNext--;
      let y = 0;
      const gs = this.grains;
      for (let g = gs.length - 1; g >= 0; g--) {
        const gr = gs[g];
        const p = gr.pos;
        if (p >= gr.len) {
          gs.splice(g, 1);
          continue;
        }
        const w = 0.5 - 0.5 * Math.cos((6.283185307179586 * p) / gr.len);
        let s = 0;
        if (gr.wOn > 0.001) s += read(gr.on, gr.start + p) * gr.wOn;
        if (gr.wOff > 0.001) s += read(gr.off, gr.start + p) * gr.wOff;
        y += s * w * gr.amp;
        gr.pos = p + 1;
      }
      out[i] += y * gain;
    }
  }

  spawn(rpm, load, order) {
    const loops = this.loops;
    // the two loops around this rpm, chosen per grain by error diffusion
    let k = 0;
    while (k < loops.length - 2 && loops[k + 1].rpm < rpm) k++;
    const lo = loops[k];
    const hi = loops[Math.min(k + 1, loops.length - 1)];
    const f = hi === lo ? 0 : Math.max(0, Math.min(1, (rpm - lo.rpm) / (hi.rpm - lo.rpm)));
    this.diffuse += f;
    let L = lo;
    if (this.diffuse >= 0.5) {
      L = hi;
      this.diffuse -= 1;
    }
    const tTarget = this.sr / ((rpm / 60) * order); // output firing period (samples)
    const tSrc = this.sr / ((L.rpm / 60) * order); // the loop's firing period
    const len = Math.round(2 * Math.max(tSrc, tTarget));
    // source position: the pitch mark nearest to the running source time (loops are whole periods long)
    const pos = this.srcTime * this.sr;
    const mark = Math.round(pos / tSrc) * tSrc;
    this.srcTime += tTarget / this.sr;
    if (this.srcTime > 3600) this.srcTime = 0;
    // equal-power on/off-load blend; overrun is quieter and duller than full throttle
    const wOn = Math.sqrt(load);
    const wOff = Math.sqrt(1 - load) * 0.55;
    this.grains.push({ on: L.on, off: L.off, start: mark - len / 2, len, pos: 0, wOn, wOff, amp: (2 * tTarget) / len });
    this.untilNext += tTarget;
  }
}

/**
 * Both engine layers into `out`: the recording (when loaded) carries the sound, the procedural engine stays
 * underneath at `profile.synthMix` for the layout's own firing pattern and the overrun pops.
 */
export function mixEngine(dsp, rec, p, out, n, rpm0, rpm1, load0, load1, cut) {
  dsp.render(out, n, rpm0, rpm1, load0, load1, cut);
  if (!rec) return;
  const k = p.synthMix;
  for (let i = 0; i < n; i++) out[i] *= k;
  rec.render(out, n, rpm0, rpm1, load0, load1, cut, p.sampleGain * Math.min(1.25, 0.45 + 0.6 * ((rpm0 + rpm1) / 2 / p.redline)));
}

/** Linear-interpolated read from a loop, wrapping (also for negative positions). */
function read(buf, x) {
  const n = buf.length;
  let i = Math.floor(x);
  const f = x - i;
  i %= n;
  if (i < 0) i += n;
  const j = i + 1 === n ? 0 : i + 1;
  return buf[i] + (buf[j] - buf[i]) * f;
}

if (typeof registerProcessor !== 'undefined') {
  class EngineProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'rpm', defaultValue: 1000, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
        { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      ];
    }
    constructor(options) {
      super();
      this.profile = options.processorOptions.profile;
      this.dsp = new EngineDSP(sampleRate, this.profile);
      /** @type {SampleEngine | null} the recorded engine, once its bank has arrived */
      this.rec = null;
      this.rpm = 1000;
      this.load = 0;
      this.alive = true;
      this.port.onmessage = (e) => {
        if (e.data === 'stop') this.alive = false;
        else if (e.data && e.data.bank) this.rec = new SampleEngine(sampleRate, e.data.bank, this.profile.cyl);
      };
    }
    process(_inputs, outputs, params) {
      const out = outputs[0][0];
      if (!out) return this.alive;
      const rpm = params.rpm[0];
      const load = params.load[0];
      mixEngine(this.dsp, this.rec, this.profile, out, out.length, this.rpm, rpm, this.load, load, params.cut[0]);
      this.rpm = rpm;
      this.load = load;
      for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
      return this.alive;
    }
  }
  registerProcessor('engine', EngineProcessor);
}
