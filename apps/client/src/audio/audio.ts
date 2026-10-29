import type { EngineProfile } from './engineProfiles';
import { EngineDSP, SampleEngine, mixEngine } from './engine-worklet.js';
import { loadBank } from './engineBank';
import { ASSET_BASE } from '../config';

/** Mixer levels (0..1), saved with the settings. */
export interface AudioLevels {
  master: number;
  engine: number;
  effects: number;
  ambience: number;
}

const WORKLET_URL = new URL('./engine-worklet.js', import.meta.url).href;

/**
 * Game audio. Engines: real onboard recordings (constant-rpm loop banks, granular playback) over a procedural
 * layer built from each layout's firing pattern (engine-worklet.js); everything else is procedural:
 * tyres, kerbs, gravel, wind, gearbox whine, turbos, impacts, rain, crowd and birds from shaped noise and
 * oscillators. One AudioContext for the whole app, created on the first user gesture (browser rule).
 */
export class GameAudio {
  readonly ctx: AudioContext;
  private master: GainNode;
  readonly engineBus: GainNode;
  readonly sfxBus: GainNode;
  readonly ambBus: GainNode;
  readonly noise: AudioBuffer;
  readonly brown: AudioBuffer;
  private ready: Promise<boolean>;
  workletOk = false;
  /** True once we know whether the worklet loaded (engines wait for this, then use it or the fallback). */
  settled = false;
  private meter: AnalyserNode;
  private meterBuf = new Float32Array(2048);

  constructor(levels: AudioLevels) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(this.ctx.destination);
    // output meter (diagnostics: tools/e2e/smoke.mjs checks that something is audible)
    this.meter = this.ctx.createAnalyser();
    this.meter.fftSize = 2048;
    comp.connect(this.meter);
    this.master = this.gain(1, comp);
    this.engineBus = this.gain(1, this.master);
    this.sfxBus = this.gain(1, this.master);
    this.ambBus = this.gain(1, this.master);
    this.setLevels(levels);
    // 3 s of white noise and of "brown" (integrated) noise, looped by every noise source
    const n = this.ctx.sampleRate * 3;
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    this.brown = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const w = this.noise.getChannelData(0);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    // AudioWorklet exists only in secure contexts (https or localhost). Over plain http on a LAN address the
    // engines fall back to the same DSP on the main thread (ScriptProcessor); everything else is unaffected.
    const worklet = (this.ctx as AudioContext & { audioWorklet?: AudioWorklet }).audioWorklet;
    this.ready = (worklet ? worklet.addModule(WORKLET_URL).then(() => true) : Promise.reject(new Error('AudioWorklet needs https or localhost')))
      .then(() => (this.workletOk = true))
      .catch((e: Error) => {
        console.warn(`[audio] engine worklet unavailable (${e.message}): using the main-thread engine`);
        return false;
      })
      .finally(() => {
        this.settled = true;
      });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** RMS of the mixed output right now. */
  level(): number {
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let s = 0;
    for (const x of this.meterBuf) s += x * x;
    return Math.sqrt(s / this.meterBuf.length);
  }

  whenReady(): Promise<boolean> {
    return this.ready;
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setLevels(l: AudioLevels): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(l.master * l.master, t, 0.05);
    this.engineBus.gain.setTargetAtTime(l.engine * l.engine, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(l.effects * l.effects, t, 0.05);
    this.ambBus.gain.setTargetAtTime(l.ambience * l.ambience * 0.8, t, 0.05);
  }

  gain(v: number, to?: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (to) g.connect(to);
    return g;
  }

  filter(type: BiquadFilterType, f: number, q = 0.7, to?: AudioNode): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (to) b.connect(to);
    return b;
  }

  /** A looping noise source started at a random offset (so sources never sound identical). */
  noiseSource(to: AudioNode, brown = false): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = brown ? this.brown : this.noise;
    s.loop = true;
    s.connect(to);
    s.start(0, Math.random() * 2.5);
    return s;
  }

  /* ----------------------------------------------------------- one-shots --- */

  /** Short tone with an envelope (beeps, chimes). */
  tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', when = 0, bus: AudioNode = this.sfxBus): void {
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.gain(0, bus);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.25);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  /** Filtered noise burst. */
  burst(type: BiquadFilterType, f: number, q: number, dur: number, vol: number, bus: AudioNode = this.sfxBus, pan = 0): void {
    const t = this.ctx.currentTime;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(bus);
    const g = this.gain(0, p);
    g.gain.setValueAtTime(vol, t);
    g.gain.setTargetAtTime(0, t + 0.005, dur / 3);
    const flt = this.filter(type, f, q, g);
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.connect(flt);
    s.start(t, Math.random() * 2);
    s.stop(t + dur * 2 + 0.1);
  }

  /** Body impact: a low thump plus crunch, scaled by severity (0..1). */
  impact(severity: number, pan = 0): void {
    const v = Math.min(1, severity);
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = this.gain(0, this.sfxBus);
    g.gain.setValueAtTime(0.9 * v, t);
    g.gain.setTargetAtTime(0, t + 0.02, 0.09);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.6);
    this.burst('lowpass', 1800, 0.7, 0.18 + 0.2 * v, 0.7 * v, this.sfxBus, pan);
    if (v > 0.35) this.burst('bandpass', 3800, 1.5, 0.35, 0.25 * v, this.sfxBus, pan);
  }

  /** Air jacks: the hiss of the lance going in and the car rising (up), or the dump valve (down). */
  airJack(up: boolean, pan = 0): void {
    this.burst('highpass', up ? 2600 : 1800, 0.6, up ? 0.55 : 0.4, up ? 0.32 : 0.42, this.sfxBus, pan);
    this.burst('lowpass', 320, 0.9, 0.18, up ? 0.35 : 0.5, this.sfxBus, pan);
  }

  /** The refuelling rig's coupling: a heavy clunk. */
  clunk(pan = 0): void {
    this.burst('lowpass', 650, 1.1, 0.12, 0.6, this.sfxBus, pan);
  }

  /** Pneumatic wheel gun: a fast rattling whirr. */
  wheelGun(pan = 0): void {
    const t = this.ctx.currentTime;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfxBus);
    const g = this.gain(0, p);
    // rattle: noise amplitude-modulated at ~60 Hz
    const am = this.ctx.createOscillator();
    am.type = 'square';
    am.frequency.value = 62;
    const depth = this.gain(0.25);
    am.connect(depth);
    depth.connect(g.gain);
    g.gain.setValueAtTime(0.3, t);
    g.gain.setValueAtTime(0.3, t + 0.55);
    g.gain.linearRampToValueAtTime(0, t + 0.7);
    const f = this.filter('bandpass', 2200, 1.2, g);
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.connect(f);
    s.start(t, Math.random() * 2);
    s.stop(t + 0.75);
    am.start(t);
    am.stop(t + 0.75);
  }

  countdownBeep(go: boolean): void {
    if (go) this.tone(1320, 0.6, 0.35, 'square');
    else this.tone(880, 0.22, 0.3, 'square');
  }

  chime(kind: 'lap' | 'best' | 'session-best' | 'invalid'): void {
    if (kind === 'invalid') {
      this.tone(196, 0.25, 0.22, 'sawtooth');
      this.tone(147, 0.35, 0.22, 'sawtooth', 0.12);
      return;
    }
    const notes = kind === 'session-best' ? [784, 988, 1175, 1568] : kind === 'best' ? [659, 880, 1175] : [880, 1320];
    notes.forEach((f, i) => this.tone(f, 0.35, 0.16, 'triangle', i * 0.09));
  }

  createEngine(profile: EngineProfile): EngineVoice | null {
    if (!this.settled) return null;
    return new EngineVoice(this, profile);
  }
}

/**
 * One car's engine and drivetrain noises: the worklet engine, turbo whistle and blow-off, straight-cut
 * gearbox whine, hybrid motor whine. Positioned by gain + stereo pan (and a Doppler factor on the pitch).
 */
export class EngineVoice {
  private node: AudioWorkletNode | null = null;
  /** Fallback without AudioWorklet: the same DSP in a ScriptProcessor on the main thread. */
  private sp: ScriptProcessorNode | null = null;
  private fb = { rpm: 1000, load: 0, cut: 0, tRpm: 1000, tLoad: 0 };
  private out: GainNode;
  private pan: StereoPannerNode;
  private turbo: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
  private whine: OscillatorNode;
  private whineGain: GainNode;
  private motor: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private boost = 0;
  private lastLoad = 0;
  private cutUntil = 0;
  private stopped = false;

  constructor(
    private readonly a: GameAudio,
    readonly profile: EngineProfile,
  ) {
    const ctx = a.ctx;
    this.pan = ctx.createStereoPanner();
    this.pan.connect(a.engineBus);
    this.out = a.gain(0, this.pan);
    if (a.workletOk) {
      const node = new AudioWorkletNode(ctx, 'engine', { numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { profile } });
      node.connect(this.out);
      this.node = node;
      // the recording takes over once its bank is in (procedural engine until then, and if it fails)
      void loadBank(profile.bank, ctx.sampleRate, ASSET_BASE).then((bank) => {
        if (bank && !this.stopped) node.port.postMessage({ bank });
      });
    } else {
      const dsp = new EngineDSP(ctx.sampleRate, profile);
      let rec: SampleEngine | null = null;
      void loadBank(profile.bank, ctx.sampleRate, ASSET_BASE).then((b) => {
        if (b) rec = new SampleEngine(ctx.sampleRate, b, profile.cyl);
      });
      const fb = this.fb;
      this.sp = ctx.createScriptProcessor(2048, 0, 1);
      this.sp.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);
        const r0 = fb.rpm;
        const l0 = fb.load;
        fb.rpm += (fb.tRpm - fb.rpm) * 0.6;
        fb.load += (fb.tLoad - fb.load) * 0.6;
        mixEngine(dsp, rec, profile, out, out.length, r0, fb.rpm, l0, fb.load, fb.cut);
      };
      this.sp.connect(this.out);
    }
    // straight-cut sequential gearbox: the GT3 whine, loudest off-throttle
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whineGain = a.gain(0, this.out);
    this.whine.connect(this.whineGain);
    this.whine.start();
    if (profile.turbo) {
      this.turbo = ctx.createOscillator();
      this.turbo.type = 'sine';
      this.turboGain = a.gain(0, this.out);
      this.turbo.connect(this.turboGain);
      this.turbo.start();
    }
    if (profile.hybrid) {
      this.motor = ctx.createOscillator();
      this.motor.type = 'sawtooth';
      const lp = a.filter('lowpass', 2500, 0.7, this.out);
      this.motorGain = a.gain(0, lp);
      this.motor.connect(this.motorGain);
      this.motor.start();
    }
  }

  /**
   * @param rpm engine speed; @param load throttle 0..1; @param gearRatio overall ratio of the current gear
   * @param gain distance attenuation 0..1; @param pan −1..1; @param doppler pitch factor
   */
  set(rpm: number, load: number, gearRatio: number, gain: number, pan: number, doppler = 1): void {
    if (this.stopped) return;
    const t = this.a.ctx.currentTime;
    const p = this.profile;
    const r = Math.max(p.idle * 0.8, rpm) * doppler;
    const cut = performance.now() < this.cutUntil ? 1 : 0;
    if (this.node) {
      const prm = this.node.parameters;
      prm.get('rpm')?.setTargetAtTime(r, t, 0.015);
      prm.get('load')?.setTargetAtTime(load, t, 0.03);
      prm.get('cut')?.setTargetAtTime(cut, t, 0.005);
    } else {
      this.fb.tRpm = r;
      this.fb.tLoad = load;
      this.fb.cut = cut;
    }
    this.out.gain.setTargetAtTime(gain, t, 0.05);
    this.pan.pan.setTargetAtTime(pan, t, 0.05);
    const rn = Math.min(1, rpm / p.redline);
    // gearbox whine from the output shaft speed
    if (gearRatio > 0) {
      this.whine.frequency.setTargetAtTime(Math.min(6000, ((rpm / 60) * 38 * doppler) / Math.max(0.6, gearRatio / 3)), t, 0.03);
      this.whineGain.gain.setTargetAtTime((0.012 + 0.03 * (1 - load)) * rn, t, 0.08);
    } else this.whineGain.gain.setTargetAtTime(0, t, 0.05);
    if (this.turbo && this.turboGain) {
      const target = load > 0.5 ? rn : 0;
      this.boost += (target - this.boost) * (target > this.boost ? 0.06 : 0.25);
      this.turbo.frequency.setTargetAtTime((2200 + 9500 * this.boost) * doppler, t, 0.05);
      this.turboGain.gain.setTargetAtTime(0.025 * this.boost * this.boost, t, 0.05);
      // blow-off valve when lifting with boost
      if (this.lastLoad > 0.7 && load < 0.2 && this.boost > 0.45) this.a.burst('highpass', 2600, 0.7, 0.35, 0.16 * gain * this.boost, this.a.engineBus, pan);
    }
    if (this.motor && this.motorGain) {
      this.motor.frequency.setTargetAtTime((rpm / 60) * 7 * doppler, t, 0.03);
      this.motorGain.gain.setTargetAtTime(0.02 * rn * (0.4 + load), t, 0.05);
    }
    this.lastLoad = load;
  }

  /** Ignition cut for a gear change (the crisp "bap" of a sequential box). */
  shift(): void {
    this.cutUntil = performance.now() + 55;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.a.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.08);
    setTimeout(() => {
      this.node?.port.postMessage('stop');
      this.node?.disconnect();
      if (this.sp) {
        this.sp.onaudioprocess = null;
        this.sp.disconnect();
      }
      this.whine.stop();
      this.turbo?.stop();
      this.motor?.stop();
      this.pan.disconnect();
    }, 400);
  }
}

/** Your car's chassis noises: tyres, road, kerbs, gravel/grass, wind, rain on the car. */
export class CarSounds {
  private squeal: GainNode;
  private squealFilter: BiquadFilterNode;
  private road: GainNode;
  /** Kerb rumble = base level + square LFO of the same depth: chopped at the stripe rate (0 … 2×level). */
  private kerbAm: GainNode;
  private kerbDepth: GainNode;
  private kerbLfo: OscillatorNode;
  private gravel: GainNode;
  private grass: GainNode;
  private wind: GainNode;
  private windFilter: BiquadFilterNode;
  private rain: GainNode;
  private srcs: AudioScheduledSourceNode[] = [];

  constructor(private readonly a: GameAudio) {
    const bus = a.sfxBus;
    this.squeal = a.gain(0, bus);
    this.squealFilter = a.filter('bandpass', 900, 6, this.squeal);
    this.srcs.push(a.noiseSource(this.squealFilter));
    this.road = a.gain(0, bus);
    this.srcs.push(a.noiseSource(a.filter('lowpass', 260, 0.7, this.road), true));
    // kerbs: low rumble chopped at the stripe rate
    this.kerbAm = a.gain(0, bus);
    this.kerbDepth = a.gain(0);
    this.kerbDepth.connect(this.kerbAm.gain);
    this.kerbLfo = a.ctx.createOscillator();
    this.kerbLfo.type = 'square';
    this.kerbLfo.frequency.value = 20;
    this.kerbLfo.connect(this.kerbDepth);
    this.kerbLfo.start();
    this.srcs.push(this.kerbLfo);
    this.srcs.push(a.noiseSource(a.filter('lowpass', 140, 1, this.kerbAm), true));
    this.gravel = a.gain(0, bus);
    this.srcs.push(a.noiseSource(a.filter('bandpass', 2800, 0.8, this.gravel)));
    this.grass = a.gain(0, bus);
    this.srcs.push(a.noiseSource(a.filter('lowpass', 700, 0.7, this.grass)));
    this.wind = a.gain(0, bus);
    this.windFilter = a.filter('bandpass', 500, 0.6, this.wind);
    this.srcs.push(a.noiseSource(this.windFilter));
    this.rain = a.gain(0, bus);
    this.srcs.push(a.noiseSource(a.filter('highpass', 1800, 0.5, a.filter('lowpass', 7000, 0.5, this.rain))));
  }

  /**
   * @param slip 0..1 how far past the grip peak the tyres are (asphalt); @param kerb 0..1;
   * @param gravel / grass fraction of wheels on them; @param rain 0..1
   */
  update(speed: number, slip: number, kerb: number, gravel: number, grass: number, rain: number, inCockpit: boolean): void {
    const t = this.a.ctx.currentTime;
    const sp = Math.min(1, speed / 75);
    const near = inCockpit ? 1 : 0.25;
    this.squeal.gain.setTargetAtTime(Math.min(0.32, slip * 0.4) * Math.min(1, speed / 6) * near, t, 0.04);
    this.squealFilter.frequency.setTargetAtTime(750 + 500 * Math.min(1, slip), t, 0.05);
    this.road.gain.setTargetAtTime(0.32 * sp * near, t, 0.1);
    const kl = 0.25 * kerb * Math.min(1, speed / 10) * near;
    this.kerbAm.gain.setTargetAtTime(kl, t, 0.02);
    this.kerbDepth.gain.setTargetAtTime(kl, t, 0.02);
    this.kerbLfo.frequency.setTargetAtTime(Math.max(4, speed / 1.0), t, 0.05);
    this.gravel.gain.setTargetAtTime(0.35 * gravel * Math.min(1, speed / 8) * near, t, 0.05);
    this.grass.gain.setTargetAtTime(0.3 * grass * Math.min(1, speed / 8) * near, t, 0.05);
    this.wind.gain.setTargetAtTime(0.22 * sp * sp * (inCockpit ? 0.7 : 0.15), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(350 + speed * 9, t, 0.1);
    this.rain.gain.setTargetAtTime(0.14 * rain * (inCockpit ? 1 : 0.6), t, 0.3);
  }

  dispose(): void {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const g of [this.squeal, this.road, this.kerbAm, this.gravel, this.grass, this.wind, this.rain]) g.disconnect();
  }
}

/**
 * Circuit ambience: the countryside (wind in the trees, birds by day), the crowd near the grandstands
 * (start/finish straight and the Mercedes Arena), distant thunder in heavy rain.
 */
export class Ambience {
  private bed: GainNode;
  private crowd: GainNode;
  private crowdLfo: OscillatorNode;
  private srcs: AudioScheduledSourceNode[] = [];
  private nextBird = 0;
  private nextThunder = 0;

  constructor(private readonly a: GameAudio) {
    this.bed = a.gain(0, a.ambBus);
    this.srcs.push(a.noiseSource(a.filter('lowpass', 420, 0.5, this.bed), true));
    // crowd: a broad murmur with slow swells
    const swell = a.gain(0.7, a.ambBus);
    this.crowd = a.gain(0, swell);
    this.srcs.push(a.noiseSource(a.filter('bandpass', 750, 0.6, this.crowd)));
    this.crowdLfo = a.ctx.createOscillator();
    this.crowdLfo.frequency.value = 0.13;
    const depth = a.gain(0.3);
    depth.connect(swell.gain);
    this.crowdLfo.connect(depth);
    this.crowdLfo.start();
    this.srcs.push(this.crowdLfo);
  }

  /**
   * @param crowd 0..1 closeness to the grandstands; @param day 0..1; @param rain 0..1
   * @param quiet 0..1 how much the own engine masks the countryside (birds only when it's quiet)
   */
  update(crowd: number, day: number, rain: number, quiet: number): void {
    const a = this.a;
    const t = a.ctx.currentTime;
    this.bed.gain.setTargetAtTime(0.1 + 0.08 * rain, t, 0.5);
    this.crowd.gain.setTargetAtTime(0.16 * crowd * (0.4 + 0.6 * day) * (1 - 0.5 * rain), t, 0.4);
    const now = performance.now();
    if (day > 0.3 && rain < 0.3 && quiet > 0.3 && now > this.nextBird) {
      this.nextBird = now + 900 + Math.random() * 3500;
      this.bird(quiet);
    }
    if (rain > 0.75 && now > this.nextThunder) {
      this.nextThunder = now + 20000 + Math.random() * 40000;
      if (this.nextThunder - now < 59000) this.thunder();
    }
  }

  private bird(vol: number): void {
    const a = this.a;
    const base = 2600 + Math.random() * 2600;
    const notes = 2 + Math.floor(Math.random() * 4);
    const pan = a.ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(a.ambBus);
    for (let i = 0; i < notes; i++) {
      const t = a.ctx.currentTime + i * (0.09 + Math.random() * 0.06);
      const o = a.ctx.createOscillator();
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.4), t + 0.06);
      const g = a.gain(0, pan);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03 * vol, t + 0.01);
      g.gain.setTargetAtTime(0, t + 0.04, 0.02);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.2);
    }
  }

  private thunder(): void {
    const a = this.a;
    a.burst('lowpass', 160, 0.5, 3.5, 0.5, a.ambBus, Math.random() * 1.4 - 0.7);
  }

  dispose(): void {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.bed.disconnect();
    this.crowd.disconnect();
  }
}
