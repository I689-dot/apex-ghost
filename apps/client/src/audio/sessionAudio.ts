import * as THREE from 'three';
import type { CarEntry, TrackData } from '@apex/shared';
import type { Vehicle } from '../physics/vehicle';
import { Ambience, CarSounds, type EngineVoice, type GameAudio } from './audio';
import { engineProfileFor } from './engineProfiles';

/** A car other than yours, as the audio sees it. */
export interface OtherCar {
  key: string;
  entry: CarEntry;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Exact values when this client simulates the car (bots on the host); otherwise estimated. */
  rpm?: number;
  load?: number;
  gearRatio?: number;
}

interface OtherVoice {
  voice: EngineVoice;
  prevSpeed: number;
  load: number;
  gear: number;
}

const MAX_OTHERS = 4;
/** Audio parameters change smoothly anyway (setTargetAtTime): 30 updates a second are plenty. */
const UPDATE_S = 1 / 30;
const HEAR_M = 220;
const SOUND_SPEED = 343;
const _d = new THREE.Vector3();

/**
 * Everything audible in a race: your engine (in the cockpit, or positioned while the cinematic camera is
 * elsewhere), the nearest other cars' engines (positioned, with Doppler), your chassis noises and the
 * circuit ambience.
 */
export class SessionAudio {
  private mine: EngineVoice | null = null;
  private car: CarSounds;
  private amb: Ambience;
  private others = new Map<string, OtherVoice>();
  private crowdT = 0;
  private crowd = 0;
  private grandstands: THREE.Vector3[] = [];
  private lastGear = 1;
  private acc = 0;

  constructor(
    private readonly a: GameAudio,
    private readonly myEntry: CarEntry,
    track: TrackData,
  ) {
    this.car = new CarSounds(a);
    this.amb = new Ambience(a);
    // grandstands line the start/finish straight and the Mercedes Arena (first ~1.2 km)
    const cl = track.centerline;
    const n = cl.length / 3;
    for (let i = 0; i < n; i += 6) {
      const s = track.cumS[i];
      if (s < 1200 || s > track.length - 450) this.grandstands.push(new THREE.Vector3(cl[i * 3], cl[i * 3 + 1], cl[i * 3 + 2]));
    }
  }

  update(
    dt: number,
    o: {
      listener: THREE.Vector3;
      right: THREE.Vector3;
      inCockpit: boolean;
      myPos: THREE.Vector3;
      myVel: THREE.Vector3;
      vehicle: Vehicle;
      others: OtherCar[];
      rain: number;
      day: number;
    },
  ): void {
    const a = this.a;
    if (!a.settled) return;
    const v = o.vehicle;
    const tel = v.telemetry;
    // gear changes are caught every frame (the ignition-cut bap is short); the rest at 30 Hz
    if (this.mine && tel.gear !== this.lastGear) {
      if (tel.gear > 0 && this.lastGear > 0) {
        this.mine.shift();
        if (o.inCockpit) a.burst('highpass', 3500, 0.8, 0.03, 0.12);
      }
      this.lastGear = tel.gear;
    }
    this.acc += dt;
    if (this.acc < UPDATE_S) return;
    dt = this.acc;
    this.acc = 0;
    // ---- my engine
    this.mine ??= a.createEngine(engineProfileFor(this.myEntry));
    if (this.mine) {
      const ratio = Math.abs(v.drivetrain.ratio());
      if (o.inCockpit) this.mine.set(tel.rpm, v.pedals.throttle, ratio, 0.95, 0);
      else {
        const p = this.place(o.myPos, o.myVel, o);
        this.mine.set(tel.rpm, v.pedals.throttle, ratio, p.gain, p.pan, p.doppler);
      }
    }
    // ---- chassis noises
    let slip = 0;
    let kerb = 0;
    let gravel = 0;
    let grass = 0;
    const tp = v.tire.p;
    for (const w of v.wheels) {
      if (!w.contact) continue;
      if (w.surface === 'asphalt' || w.surface === 'curb') {
        const s = Math.max(Math.abs(w.slipRatio) / tp.kappaPeak, Math.abs(w.slipAngle) / tp.alphaPeak);
        slip = Math.max(slip, s - 0.85);
      }
      if (w.surface === 'curb') kerb += 0.25;
      else if (w.surface === 'gravel' || w.surface === 'sand') gravel += 0.25;
      else if (w.surface === 'grass') grass += 0.25;
    }
    this.car.update(tel.speed, Math.max(0, slip), kerb, gravel, grass, o.rain, o.inCockpit);
    // ---- other cars: voices for the nearest few
    const near = o.others
      .map((c) => ({ c, d: c.pos.distanceTo(o.listener) }))
      .filter((x) => x.d < HEAR_M && 1 / (1 + Math.pow(x.d / 14, 1.5)) > 0.015)
      .sort((x, y) => x.d - y.d)
      // main-thread fallback engines cost frame time: fewer of them
      .slice(0, a.workletOk ? MAX_OTHERS : 2);
    const keep = new Set(near.map((x) => x.c.key));
    for (const [k, ov] of this.others) {
      if (!keep.has(k)) {
        ov.voice.stop();
        this.others.delete(k);
      }
    }
    for (const { c } of near) {
      let ov = this.others.get(c.key);
      if (!ov) {
        const voice = a.createEngine(engineProfileFor(c.entry));
        if (!voice) continue;
        ov = { voice, prevSpeed: c.vel.length(), load: 0.3, gear: 1 };
        this.others.set(c.key, ov);
      }
      const speed = c.vel.length();
      const p = this.place(c.pos, c.vel, o);
      let rpm = c.rpm;
      let load = c.load;
      let ratio = c.gearRatio;
      if (rpm === undefined || load === undefined || ratio === undefined) {
        const est = estimateRpm(c.entry, speed, ov.gear);
        ov.gear = est.gear;
        rpm = est.rpm;
        ratio = est.ratio;
        const acc = (speed - ov.prevSpeed) / Math.max(1e-3, dt);
        ov.load += ((acc > 0.6 ? 1 : acc < -2 ? 0 : 0.35) - ov.load) * Math.min(1, dt * 6);
        load = ov.load;
      }
      ov.prevSpeed = speed;
      ov.voice.set(rpm, load, ratio, p.gain * 0.9, p.pan, p.doppler);
    }
    // ---- ambience
    this.crowdT -= dt;
    if (this.crowdT <= 0) {
      this.crowdT = 0.25;
      let d = Infinity;
      for (const g of this.grandstands) d = Math.min(d, g.distanceTo(o.listener));
      this.crowd = THREE.MathUtils.clamp(1 - (d - 40) / 260, 0, 1);
    }
    const quiet = o.inCockpit ? 1 - Math.min(1, tel.speed / 20) : 1;
    this.amb.update(this.crowd, o.day, o.rain, quiet);
  }

  /** Distance attenuation, stereo position and Doppler factor of a source for the listener. */
  private place(pos: THREE.Vector3, vel: THREE.Vector3, o: { listener: THREE.Vector3; right: THREE.Vector3 }): { gain: number; pan: number; doppler: number } {
    _d.subVectors(pos, o.listener);
    const dist = Math.max(0.5, _d.length());
    _d.divideScalar(dist);
    const gain = 1 / (1 + Math.pow(dist / 14, 1.5));
    const pan = THREE.MathUtils.clamp(_d.dot(o.right) * 0.85, -0.9, 0.9);
    // source moving towards the listener → higher pitch
    const radial = -vel.dot(_d);
    const doppler = THREE.MathUtils.clamp(SOUND_SPEED / (SOUND_SPEED - radial), 0.75, 1.3);
    return { gain, pan, doppler };
  }

  /** Pit service: air jacks, then the wheel guns if the tyres are changed. */
  /** A moment of the pit stop (pitCrew.stopTimeline): wheel guns, jacks and the fuel coupling, panned to their side
   * of the car (-1 left … 1 right). */
  pitEvent(kind: 'jackUp' | 'jackDown' | 'gunOff' | 'gunOn' | 'fuelOn' | 'fuelOff', pan: number): void {
    const a = this.a;
    if (kind === 'gunOff' || kind === 'gunOn') a.wheelGun(pan);
    else if (kind === 'jackUp' || kind === 'jackDown') a.airJack(kind === 'jackUp', pan);
    else a.clunk(pan);
  }

  impact(severity: number): void {
    this.a.impact(severity);
  }

  beep(go: boolean): void {
    this.a.countdownBeep(go);
  }

  chime(kind: 'lap' | 'best' | 'session-best' | 'invalid'): void {
    this.a.chime(kind);
  }

  dispose(): void {
    this.mine?.stop();
    for (const ov of this.others.values()) ov.voice.stop();
    this.others.clear();
    this.car.dispose();
    this.amb.dispose();
  }
}

/** Remote cars only send their pose: pick the gear an auto box would use at this speed (with hysteresis). */
function estimateRpm(e: CarEntry, speed: number, gear: number): { rpm: number; gear: number; ratio: number } {
  const s = e.specs;
  const r = e.wheels.RL?.radius ?? 0.34;
  const wheelRpm = (speed / (2 * Math.PI * r)) * 60;
  const rpmIn = (g: number) => wheelRpm * s.gears[g - 1] * s.finalDrive;
  let g = Math.min(Math.max(1, gear), s.gears.length);
  while (g < s.gears.length && rpmIn(g) > s.redlineRpm * 0.95) g++;
  while (g > 1 && rpmIn(g - 1) < s.redlineRpm * 0.7) g--;
  const ratio = s.gears[g - 1] * s.finalDrive;
  return { rpm: Math.max(s.idleRpm, rpmIn(g)), gear: g, ratio };
}
